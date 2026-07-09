"""MaskBase FastAPI backend — local sidecar for PII detection and AI chat."""

import os
import json
import uuid
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, FileResponse

from backend.models.schemas import (
    ScanStartResponse,
    ScanStatusResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SettingsRequest,
    ModelSelectRequest,
    CustomEndpointRequest,
    EngineSelectRequest,
    RegexBoostRequest,
    ThresholdRequest,
    IgnorePronounsRequest,
    RemoveKeyRequest,
    EntityGroup,
    DetectedEntity,
    SavedSessionSummary,
    PIILabel,
    PIILabelsUpdate,
    CustomPIILabelRequest,
    ColumnRedactRequest,
    UpdateRedactionRequest,
)
from backend.services.parser import parse_document, parse_image_with_lines, is_tabular, is_image, get_tabular_columns, redact_tabular_columns, IMAGE_EXTENSIONS
from backend.services.scanner import (
    create_session,
    get_session,
    restore_session,
    get_all_labels,
    get_enabled_labels,
    set_enabled_labels,
    add_custom_label,
    remove_custom_label,
)
from backend.services import llm
from backend.services import engines

app = FastAPI(title="MaskBase Backend", version="0.1.0")

# CORS — allow the Tauri frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory chat history keyed by chat_id
_chat_histories: Dict[str, List[Dict[str, str]]] = {}

# In-memory scan job tracker
_scan_jobs: Dict[str, Dict[str, Any]] = {}

# Storage directories
SESSIONS_DIR = Path.home() / ".maskbase" / "sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

CHATS_DIR = Path.home() / ".maskbase" / "chats"
CHATS_DIR.mkdir(parents=True, exist_ok=True)

# Load saved API key + model from disk on startup
llm.load_from_disk()

# Pre-load the configured PII engine in a background thread so the server
# starts accepting /health requests immediately, while the model loads.
threading.Thread(target=engines.preload, daemon=True).start()


def _save_session_to_disk(session_id: str, filename: str, job: Dict[str, Any], original_file_path: str | None = None):
    """Persist a completed scan session to ~/.maskbase/sessions/"""
    import shutil

    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    if original_file_path and os.path.exists(original_file_path):
        ext = os.path.splitext(filename)[1].lower()
        shutil.copy2(original_file_path, session_dir / f"original_file{ext}")

    meta = {
        "session_id": session_id,
        "filename": filename,
        "total_entities": job.get("total_entities", 0),
        "page_count": job.get("page_count", 0),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "entities": job.get("entities", []),
        "detected_entities": job.get("detected_entities", []),
        "custom_texts": job.get("custom_texts", []),
        "ocr_lines": job.get("ocr_lines"),
        "custom_areas": job.get("custom_areas"),
    }
    (session_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    (session_dir / "redacted.txt").write_text(job.get("redacted_text", ""))
    (session_dir / "original.txt").write_text(job.get("original_text", ""))
    replacement_map = job.get("replacement_map")
    if replacement_map:
        (session_dir / "replacement_map.json").write_text(json.dumps(replacement_map))


def _save_chat_to_disk(chat_id: str, session_ids: List[str]):
    """Persist chat metadata (linked session_ids) to disk."""
    chat_path = CHATS_DIR / f"{chat_id}.json"
    existing: Dict[str, Any] = {}
    if chat_path.exists():
        try:
            existing = json.loads(chat_path.read_text())
        except Exception:
            pass

    prev_ids = existing.get("session_ids", [])
    merged = list(dict.fromkeys(prev_ids + session_ids))

    filenames = []
    for sid in merged:
        meta_path = SESSIONS_DIR / sid / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                filenames.append(meta.get("filename", sid))
            except Exception:
                filenames.append(sid)
        else:
            filenames.append(sid)

    data = {
        "chat_id": chat_id,
        "session_ids": merged,
        "filenames": filenames,
        "created_at": existing.get("created_at", datetime.now(timezone.utc).isoformat()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    chat_path.write_text(json.dumps(data, indent=2))


def _texts_under_areas(ocr_lines: List[Dict[str, Any]], areas: List[Dict[str, Any]]) -> List[str]:
    """Find the OCR text substrings covered by user-drawn redaction areas.
    A line counts when the area overlaps at least half its height; character
    coverage is interpolated proportionally, like the review overlay."""
    texts: List[str] = []
    for area in areas:
        for line in ocr_lines:
            text = line["text"]
            if not text:
                continue
            line_h = line["y1"] - line["y0"]
            overlap_y = min(area["y1"], line["y1"]) - max(area["y0"], line["y0"])
            if line_h <= 0 or overlap_y < 0.5 * line_h:
                continue
            width = line["x1"] - line["x0"]
            n = len(text)
            covered = [
                area["x0"] <= line["x0"] + ((i + 0.5) / n) * width <= area["x1"]
                for i in range(n)
            ]
            # Contiguous covered runs become custom redaction texts
            start = None
            for i, c in enumerate(covered + [False]):
                if c and start is None:
                    start = i
                elif not c and start is not None:
                    fragment = text[start:i].strip()
                    if len(fragment) >= 2:
                        texts.append(fragment)
                    start = None
    return texts


def _run_scan(session_id: str, tmp_path: str, filename: str):
    """Background worker that parses + anonymizes a document."""
    tabular = is_tabular(filename)
    try:
        _scan_jobs[session_id]["progress"] = 10
        _scan_jobs[session_id]["message"] = (
            "Reading text from image (OCR)…" if is_image(filename) else "Parsing document structure…"
        )

        # For CSV/XLSX: extract columns and let the user choose which to redact
        if tabular:
            columns = get_tabular_columns(tmp_path, filename)
            _scan_jobs[session_id].update(
                status="columns_detected",
                progress=100,
                message="Select columns to redact",
                columns=columns,
                tmp_path=tmp_path,
                filename=filename,
            )
            return  # keep tmp_path alive for /redact-columns

        # Images keep their OCR line boxes so the review UI can overlay
        # clickable highlights on the original image.
        ocr_lines = None
        if is_image(filename):
            text, ocr_lines = parse_image_with_lines(tmp_path)
            page_count = 1
        else:
            text, page_count = parse_document(tmp_path, filename)

        if not text.strip():
            _scan_jobs[session_id].update(
                status="error",
                error=(
                    "No text could be found in the image"
                    if is_image(filename)
                    else "No text could be extracted from the document"
                ),
            )
            return

        _scan_jobs[session_id]["progress"] = 30
        _scan_jobs[session_id]["message"] = "Extracting text layers…"

        session = create_session(session_id)
        session.filename = filename

        _scan_jobs[session_id]["progress"] = 50
        _scan_jobs[session_id]["message"] = "Running PII detection…"

        enabled_labels = get_enabled_labels()
        redacted_text, entities = session.anonymize(text, labels=enabled_labels)

        _scan_jobs[session_id]["progress"] = 90
        _scan_jobs[session_id]["message"] = "Building redaction map…"

        total_entities = sum(e["count"] for e in entities)

        _scan_jobs[session_id].update(
            status="complete",
            progress=100,
            message="Complete ✓",
            original_text=text,
            redacted_text=redacted_text,
            entities=entities,
            total_entities=total_entities,
            page_count=page_count,
            filename=filename,
            replacement_map=dict(session._replacement_map),
            detected_entities=session.detected_spans,
            ocr_lines=ocr_lines,
        )

        _save_session_to_disk(session_id, filename, _scan_jobs[session_id], original_file_path=tmp_path)

    except Exception as e:
        _scan_jobs[session_id].update(status="error", error=str(e))
    finally:
        # Keep temp file for tabular files awaiting column selection
        if not tabular or _scan_jobs.get(session_id, {}).get("status") == "error":
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.get("/health")
async def health_check():
    return {"status": "ok", "model_ready": engines.is_ready(), "engine": engines.get_status()}


@app.post("/scan", response_model=ScanStartResponse)
async def scan_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_extensions = {".pdf", ".docx", ".csv", ".xlsx", ".xls"} | IMAGE_EXTENSIONS
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(allowed_extensions)}",
        )

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    session_id = str(uuid.uuid4())
    _scan_jobs[session_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Starting scan…",
    }

    thread = threading.Thread(
        target=_run_scan, args=(session_id, tmp_path, file.filename), daemon=True
    )
    thread.start()

    return ScanStartResponse(session_id=session_id, status="processing")


@app.get("/scan/{session_id}/status", response_model=ScanStatusResponse)
async def scan_status(session_id: str):
    if session_id not in _scan_jobs:
        raise HTTPException(status_code=404, detail="Scan job not found")

    job = _scan_jobs[session_id]

    if job["status"] == "complete":
        detected = job.get("detected_entities")
        return ScanStatusResponse(
            status="complete",
            progress=100,
            message="Complete ✓",
            original_text=job["original_text"],
            redacted_text=job["redacted_text"],
            entities=[EntityGroup(**e) for e in job["entities"]],
            total_entities=job["total_entities"],
            page_count=job["page_count"],
            session_id=session_id,
            replacement_map=job.get("replacement_map"),
            detected_entities=[DetectedEntity(**e) for e in detected] if detected else None,
            ocr_lines=job.get("ocr_lines"),
            custom_areas=job.get("custom_areas"),
        )
    elif job["status"] == "columns_detected":
        return ScanStatusResponse(
            status="columns_detected",
            progress=100,
            message="Select columns to redact",
            columns=job.get("columns", []),
            session_id=session_id,
        )
    elif job["status"] == "error":
        return ScanStatusResponse(
            status="error",
            progress=0,
            message="Scan failed",
            error=job.get("error", "Unknown error"),
        )
    else:
        return ScanStatusResponse(
            status="processing",
            progress=job.get("progress", 0),
            message=job.get("message", "Processing…"),
        )


@app.post("/scan/{session_id}/redact-columns", response_model=ScanStatusResponse)
async def redact_columns_endpoint(session_id: str, request: ColumnRedactRequest):
    """Apply column-based redaction for a CSV/XLSX scan."""
    if session_id not in _scan_jobs:
        raise HTTPException(status_code=404, detail="Scan job not found")

    job = _scan_jobs[session_id]
    if job.get("status") != "columns_detected":
        raise HTTPException(status_code=400, detail="Not a column-selection scan")

    tmp_path = job["tmp_path"]
    filename = job["filename"]

    try:
        redacted_text, page_count, original_text, replacement_map, entities = (
            redact_tabular_columns(tmp_path, filename, request.columns)
        )

        session = create_session(session_id)
        session.filename = filename
        session.original_text = original_text
        session.redacted_text = redacted_text
        session._replacement_map = replacement_map

        total_entities = sum(e["count"] for e in entities)

        _scan_jobs[session_id].update(
            status="complete",
            progress=100,
            message="Complete ✓",
            original_text=original_text,
            redacted_text=redacted_text,
            entities=entities,
            total_entities=total_entities,
            page_count=page_count,
            filename=filename,
            replacement_map=replacement_map,
        )

        _save_session_to_disk(session_id, filename, _scan_jobs[session_id], original_file_path=tmp_path)

        return ScanStatusResponse(
            status="complete",
            progress=100,
            message="Complete ✓",
            original_text=original_text,
            redacted_text=redacted_text,
            entities=[EntityGroup(**e) for e in entities],
            total_entities=total_entities,
            page_count=page_count,
            session_id=session_id,
            replacement_map=replacement_map,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Column redaction failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/scan/{session_id}/update-redaction", response_model=ScanStatusResponse)
async def update_redaction(session_id: str, request: UpdateRedactionRequest):
    """Re-run redaction with only the user-approved entity spans."""
    if session_id not in _scan_jobs:
        raise HTTPException(status_code=404, detail="Scan job not found")

    job = _scan_jobs[session_id]
    if job.get("status") != "complete":
        raise HTTPException(status_code=400, detail="Scan not complete")

    try:
        session = get_session(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")

    if not hasattr(session, "re_anonymize"):
        raise HTTPException(status_code=400, detail="Session does not support re-anonymization")

    try:
        # Area redactions also redact whatever OCR text they cover, so the
        # text output and chat can never leak what the image visually hides.
        areas = [a.model_dump() for a in request.custom_areas]
        area_texts = _texts_under_areas(job.get("ocr_lines") or [], areas) if areas else []
        merged_customs = list(request.custom_texts)
        merged_customs.extend(t for t in area_texts if t not in merged_customs)

        redacted_text, entities, replacement_map = session.re_anonymize(
            request.included_indices,
            merged_customs,
        )
        total_entities = sum(e["count"] for e in entities)

        # Record the review state on each span so it survives reloads.
        included = set(request.included_indices)
        detected = job.get("detected_entities") or []
        for i, span in enumerate(detected):
            span["enabled"] = i in included

        job.update(
            redacted_text=redacted_text,
            entities=entities,
            total_entities=total_entities,
            replacement_map=replacement_map,
            custom_texts=list(request.custom_texts),
            custom_areas=areas,
        )

        _save_session_to_disk(session_id, job["filename"], job)
        return ScanStatusResponse(
            status="complete",
            progress=100,
            message="Complete ✓",
            original_text=job["original_text"],
            redacted_text=redacted_text,
            entities=[EntityGroup(**e) for e in entities],
            total_entities=total_entities,
            page_count=job["page_count"],
            session_id=session_id,
            replacement_map=replacement_map,
            detected_entities=[DetectedEntity(**e) for e in detected] if detected else None,
            custom_texts=list(request.custom_texts),
            ocr_lines=job.get("ocr_lines"),
            custom_areas=job.get("custom_areas"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Re-redaction failed: {str(e)}")


# ── Session storage ──────────────────────────────────────────────────────


@app.get("/sessions", response_model=List[SavedSessionSummary])
async def list_sessions():
    sessions: List[SavedSessionSummary] = []
    if not SESSIONS_DIR.exists():
        return sessions

    for session_dir in SESSIONS_DIR.iterdir():
        meta_path = session_dir / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
            sessions.append(
                SavedSessionSummary(
                    session_id=meta["session_id"],
                    filename=meta["filename"],
                    total_entities=meta.get("total_entities", 0),
                    page_count=meta.get("page_count", 0),
                    scanned_at=meta.get("scanned_at", ""),
                )
            )
        except Exception:
            continue

    sessions.sort(key=lambda s: s.scanned_at, reverse=True)
    return sessions


@app.get("/sessions/{session_id}/download")
async def download_redacted(session_id: str):
    redacted_path = SESSIONS_DIR / session_id / "redacted.txt"
    if not redacted_path.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    meta_path = SESSIONS_DIR / session_id / "meta.json"
    filename = "redacted.txt"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            base = os.path.splitext(meta.get("filename", "document"))[0]
            filename = f"{base}_redacted.txt"
        except Exception:
            pass

    content = redacted_path.read_text()
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/sessions/{session_id}/export/pdf")
async def export_redacted_pdf(session_id: str):
    """Produce a truly redacted PDF: every redacted value is removed from the
    page content and covered with a black box (PyMuPDF redaction annotations —
    the text underneath is deleted, not just hidden)."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    pdf_path = None
    for f in session_dir.iterdir():
        if f.name.startswith("original_file") and f.suffix.lower() == ".pdf":
            pdf_path = f
            break
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="This session has no PDF original")

    map_path = session_dir / "replacement_map.json"
    replacement_map: Dict[str, str] = {}
    if map_path.exists():
        try:
            replacement_map = json.loads(map_path.read_text())
        except Exception:
            pass

    # Longest-first so container strings win; include per-line fragments for
    # values the PDF wraps across lines.
    values = sorted(
        {v.strip() for v in replacement_map.values() if len(v.strip()) >= 2},
        key=len, reverse=True,
    )

    import fitz

    try:
        doc = fitz.open(str(pdf_path))
        for page in doc:
            added = False
            for value in values:
                needles = {value}
                needles.update(ln.strip() for ln in value.splitlines() if len(ln.strip()) >= 2)
                for needle in needles:
                    for rect in page.search_for(needle):
                        page.add_redact_annot(rect, fill=(0, 0, 0))
                        added = True
            if added:
                page.apply_redactions()
        content = doc.tobytes(garbage=3, deflate=True)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF redaction failed: {e}")

    meta_path = session_dir / "meta.json"
    base = "document"
    if meta_path.exists():
        try:
            base = os.path.splitext(json.loads(meta_path.read_text()).get("filename", "document"))[0]
        except Exception:
            pass

    from fastapi.responses import Response

    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{base}_redacted.pdf"'},
    )


@app.get("/sessions/{session_id}/export/image")
async def export_redacted_image(session_id: str):
    """Export the original image with true black-box redactions burned in.
    Mirrors the PDF export: every redacted value (from the replacement map,
    which reflects the user's review) is located in the OCR lines and covered."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    image_path = None
    for f in session_dir.iterdir():
        if f.name.startswith("original_file") and f.suffix.lower() in IMAGE_EXTENSIONS:
            image_path = f
            break
    if image_path is None:
        raise HTTPException(status_code=404, detail="This session has no image original")

    meta_path = session_dir / "meta.json"
    ocr_lines = []
    custom_areas = []
    base = "document"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            ocr_lines = meta.get("ocr_lines") or []
            custom_areas = meta.get("custom_areas") or []
            base = os.path.splitext(meta.get("filename", "document"))[0]
        except Exception:
            pass
    if not ocr_lines and not custom_areas:
        raise HTTPException(status_code=400, detail="This session has no OCR data to redact from")

    replacement_map: Dict[str, str] = {}
    map_path = session_dir / "replacement_map.json"
    if map_path.exists():
        try:
            replacement_map = json.loads(map_path.read_text())
        except Exception:
            pass

    # Longest-first so container strings win; include per-line fragments for
    # values OCR may have split across lines.
    values = sorted(
        {v.strip() for v in replacement_map.values() if len(v.strip()) >= 2},
        key=len, reverse=True,
    )
    needles = set()
    for value in values:
        needles.add(value)
        needles.update(ln.strip() for ln in value.splitlines() if len(ln.strip()) >= 2)

    from PIL import Image, ImageDraw

    try:
        img = Image.open(str(image_path)).convert("RGB")
        draw = ImageDraw.Draw(img)
        for line in ocr_lines:
            text = line["text"]
            if not text:
                continue
            width = line["x1"] - line["x0"]
            # Character positions are interpolated, not glyph-exact — pad by
            # roughly one character width so edges never leak (over-redacting
            # slightly is fine; under-redacting is not).
            pad_x = width / max(len(text), 1) * 0.8 + 2
            pad_y = (line["y1"] - line["y0"]) * 0.08 + 1
            for needle in needles:
                pos = text.find(needle)
                while pos != -1:
                    # Interpolate the substring's box from character offsets
                    x0 = line["x0"] + (pos / len(text)) * width
                    x1 = line["x0"] + ((pos + len(needle)) / len(text)) * width
                    draw.rectangle(
                        [x0 - pad_x, line["y0"] - pad_y, x1 + pad_x, line["y1"] + pad_y],
                        fill=(0, 0, 0),
                    )
                    pos = text.find(needle, pos + 1)
        # User-drawn area redactions are covered exactly as drawn
        for area in custom_areas:
            draw.rectangle([area["x0"], area["y0"], area["x1"], area["y1"]], fill=(0, 0, 0))
        import io as _io
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        content = buf.getvalue()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image redaction failed: {e}")

    from fastapi.responses import Response

    return Response(
        content=content,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{base}_redacted.png"'},
    )


@app.get("/sessions/{session_id}/original-file")
async def get_original_file(session_id: str):
    """Serve the original uploaded file (PDF, DOCX, etc.)."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    content_types = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
    }

    for f in session_dir.iterdir():
        if f.name.startswith("original_file"):
            return FileResponse(
                path=str(f),
                media_type=content_types.get(f.suffix.lower(), "application/octet-stream"),
            )

    raise HTTPException(status_code=404, detail="Original file not found")


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    import shutil
    shutil.rmtree(session_dir)
    return {"status": "ok"}


@app.post("/sessions/{session_id}/load")
async def load_session_for_chat(session_id: str):
    session_dir = SESSIONS_DIR / session_id
    meta_path = session_dir / "meta.json"
    redacted_path = session_dir / "redacted.txt"
    original_path = session_dir / "original.txt"
    map_path = session_dir / "replacement_map.json"

    if not meta_path.exists() or not redacted_path.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        meta = json.loads(meta_path.read_text())
        redacted_text = redacted_path.read_text()
        original_text = original_path.read_text() if original_path.exists() else redacted_text

        replacement_map: Dict[str, str] | None = None
        if map_path.exists():
            try:
                replacement_map = json.loads(map_path.read_text())
            except Exception:
                pass

        raw_detected = meta.get("detected_entities", [])
        custom_texts = meta.get("custom_texts", [])

        restore_session(
            session_id, original_text, redacted_text,
            filename=meta.get("filename", ""),
            replacement_map=replacement_map,
            detected_spans=raw_detected or None,
        )

        # Register a synthetic scan job so /update-redaction keeps working —
        # a reopened document stays instantly editable.
        if raw_detected:
            _scan_jobs[session_id] = {
                "status": "complete",
                "progress": 100,
                "message": "Loaded from history",
                "filename": meta.get("filename", ""),
                "original_text": original_text,
                "redacted_text": redacted_text,
                "entities": meta.get("entities", []),
                "total_entities": meta.get("total_entities", 0),
                "page_count": meta.get("page_count", 0),
                "replacement_map": replacement_map,
                "detected_entities": raw_detected,
                "custom_texts": custom_texts,
                "ocr_lines": meta.get("ocr_lines"),
                "custom_areas": meta.get("custom_areas"),
            }

        return ScanStatusResponse(
            status="complete",
            progress=100,
            message="Loaded from history",
            original_text=original_text,
            redacted_text=redacted_text,
            entities=[EntityGroup(**e) for e in meta.get("entities", [])],
            total_entities=meta.get("total_entities", 0),
            page_count=meta.get("page_count", 0),
            session_id=session_id,
            replacement_map=replacement_map,
            detected_entities=[DetectedEntity(**e) for e in raw_detected] if raw_detected else None,
            custom_texts=custom_texts or None,
            ocr_lines=meta.get("ocr_lines"),
            custom_areas=meta.get("custom_areas"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session: {str(e)}")


# ── Chats ─────────────────────────────────────────────────────────────────


@app.get("/chats")
async def list_chats():
    chats = []
    if not CHATS_DIR.exists():
        return chats
    for chat_file in CHATS_DIR.glob("*.json"):
        try:
            data = json.loads(chat_file.read_text())
            chats.append({
                "chat_id": data["chat_id"],
                "session_ids": data.get("session_ids", []),
                "filenames": data.get("filenames", []),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            })
        except Exception:
            continue
    chats.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return chats


@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    chat_path = CHATS_DIR / f"{chat_id}.json"
    if chat_path.exists():
        chat_path.unlink()
    _chat_histories.pop(chat_id, None)
    return {"status": "ok"}


# ── Chat & Settings ───────────────────────────────────────────────────────


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Send a message to the AI with context from one or more redacted documents.
    """
    sessions = []
    for sid in request.session_ids:
        try:
            sessions.append(get_session(sid))
        except ValueError:
            raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    if request.chat_id not in _chat_histories:
        _chat_histories[request.chat_id] = []

    history = _chat_histories[request.chat_id]

    merged_redacted = ""
    if sessions:
        merged_redacted = "\n\n---\n\n".join(
            f"[Document: {s.filename or f'doc-{i+1}'}]\n{s.redacted_text}"
            for i, s in enumerate(sessions)
        )

    try:
        ai_response = llm.chat(
            redacted_text=merged_redacted,
            user_message=request.message,
            history=history,
            model_override=request.model,
            provider_override=request.provider,
        )

        history.append({"role": "user", "content": request.message})
        history.append({"role": "assistant", "content": ai_response})

        deanonymized_response = ai_response
        for s in sessions:
            deanonymized_response = s.deanonymize(deanonymized_response)

        if request.session_ids:
            _save_chat_to_disk(request.chat_id, request.session_ids)

        return ChatResponse(
            response=deanonymized_response,
            redacted_response=ai_response,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.get("/settings")
async def get_settings():
    return llm.get_current_settings()


@app.get("/providers")
async def list_providers():
    """Chat-model catalog: configured providers + live-discovered local models."""
    return llm.list_providers()


@app.post("/settings")
async def update_settings(request: SettingsRequest):
    try:
        llm.set_provider_key(request.provider, request.api_key)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Settings update failed: {str(e)}")


@app.post("/settings/model")
async def update_model(request: ModelSelectRequest):
    llm.set_model(request.model, request.provider)
    return {"status": "ok"}


@app.post("/settings/custom-endpoint")
async def update_custom_endpoint(request: CustomEndpointRequest):
    llm.set_custom_endpoint(request.base_url, request.api_key)
    return {"status": "ok"}


@app.post("/settings/threshold")
async def update_threshold(request: ThresholdRequest):
    llm.set_threshold(request.threshold)
    return {"status": "ok"}


@app.post("/settings/ignore-pronouns")
async def update_ignore_pronouns(request: IgnorePronounsRequest):
    llm.set_ignore_pronouns(request.ignore)
    return {"status": "ok"}


@app.post("/settings/remove-key")
async def remove_key(request: RemoveKeyRequest):
    llm.remove_provider_key(request.provider)
    return {"status": "ok"}


# ── PII Label Configuration ─────────────────────────────────────────────


@app.get("/pii-labels", response_model=List[PIILabel])
async def list_pii_labels():
    return [PIILabel(**l) for l in get_all_labels()]


@app.put("/pii-labels")
async def update_pii_labels(request: PIILabelsUpdate):
    set_enabled_labels(request.labels)
    return {"status": "ok"}


@app.post("/pii-labels/custom", response_model=PIILabel)
async def add_pii_label(request: CustomPIILabelRequest):
    try:
        record = add_custom_label(request.label, request.entity_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return PIILabel(**record)


@app.delete("/pii-labels/custom/{label:path}")
async def delete_pii_label(label: str):
    if not remove_custom_label(label):
        raise HTTPException(status_code=404, detail="Custom label not found")
    return {"status": "ok"}


# ── PII Engine selection ─────────────────────────────────────────────────


@app.get("/engines")
async def list_engines():
    """Catalog of redaction engines plus the active engine's load state."""
    return engines.list_catalog()


@app.post("/engines/select")
async def select_engine(request: EngineSelectRequest):
    try:
        return engines.select_engine(request.kind, request.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/engines/regex-boost")
async def set_regex_boost(request: RegexBoostRequest):
    engines.set_regex_boost(request.enabled)
    return {"status": "ok"}
