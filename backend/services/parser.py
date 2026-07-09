"""Document parsing service — extracts text from PDF, DOCX, CSV, XLSX and image files."""

import os
import tempfile
from typing import Dict, List, Tuple

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}


def is_image(original_filename: str) -> bool:
    """Check if a file is an image format (handled via OCR)."""
    ext = os.path.splitext(original_filename)[1].lower()
    return ext in IMAGE_EXTENSIONS


def _read_tabular_dataframe(file_path: str, ext: str, **kwargs):
    """Read CSV/XLSX/XLS data and normalize legacy XLS decode errors."""
    import pandas as pd

    try:
        if ext == ".csv":
            return pd.read_csv(file_path, **kwargs)
        if ext in {".xlsx", ".xls"}:
            engine = "xlrd" if ext == ".xls" else "openpyxl"
            return pd.read_excel(file_path, engine=engine, **kwargs)
    except UnicodeDecodeError as exc:
        if ext == ".xls":
            raise ValueError(
                "This XLS file could not be decoded reliably. Please resave it as .xlsx or .csv and upload it again."
            ) from exc
        raise ValueError(
            f"This spreadsheet could not be decoded. Please resave it as .xlsx or .csv and upload it again."
        ) from exc
    except Exception as exc:
        if ext == ".xls":
            raise ValueError(
                f"Failed to read this XLS file. Please resave it as .xlsx or .csv and try again. Original error: {exc}"
            ) from exc
        raise

    raise ValueError(f"Not a tabular file: {ext}")


def is_tabular(original_filename: str) -> bool:
    """Check if a file is a tabular format (CSV/XLSX)."""
    ext = os.path.splitext(original_filename)[1].lower()
    return ext in {".csv", ".xlsx", ".xls"}


def get_tabular_columns(file_path: str, original_filename: str) -> List[str]:
    """Return column names from a CSV/XLSX file."""
    ext = os.path.splitext(original_filename)[1].lower()
    df = _read_tabular_dataframe(file_path, ext, nrows=0)
    return [str(c) for c in df.columns]


def redact_tabular_columns(
    file_path: str, original_filename: str, columns: List[str]
) -> Tuple[str, int, str, Dict[str, str], List[Dict]]:
    """
    Redact specific columns in a CSV/XLSX file.
    Returns (redacted_text, page_count, original_text, replacement_map, entities).
    """
    import pandas as pd

    ext = os.path.splitext(original_filename)[1].lower()
    df = _read_tabular_dataframe(file_path, ext)

    original_text = df.to_string()
    page_count = max(1, len(df) // 50 + 1)

    replacement_map: Dict[str, str] = {}
    entity_groups: Dict[str, Dict] = {}

    for col in columns:
        if col not in df.columns:
            continue
        col_type = col.upper().replace(" ", "_").replace("-", "_")
        count = 0
        for idx in range(len(df)):
            val = df.iat[idx, df.columns.get_loc(col)]
            if pd.isna(val) or str(val).strip() == "":
                continue
            count += 1
            placeholder = f"[REDACTED_{col_type}_{count}]"
            replacement_map[placeholder] = str(val)
            df.iat[idx, df.columns.get_loc(col)] = placeholder

        if count > 0:
            entity_groups[col_type] = {
                "type": col_type,
                "count": count,
                "examples": [
                    f"[REDACTED_{col_type}_{i}]"
                    for i in range(1, min(count + 1, 6))
                ],
            }

    redacted_text = df.to_string()
    entities = sorted(entity_groups.values(), key=lambda x: x["count"], reverse=True)
    return redacted_text, page_count, original_text, replacement_map, entities


def parse_document(file_path: str, original_filename: str) -> Tuple[str, int]:
    """
    Parse a document and extract text.
    Returns (text, page_count).
    """
    ext = os.path.splitext(original_filename)[1].lower()

    if ext == ".pdf":
        return _parse_pdf(file_path)
    elif ext == ".docx":
        return _parse_docx(file_path)
    elif ext == ".csv":
        return _parse_csv(file_path)
    elif ext in {".xlsx", ".xls"}:
        return _parse_excel(file_path, ext)
    elif ext in IMAGE_EXTENSIONS:
        return _parse_image(file_path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")


def _parse_pdf(file_path: str) -> Tuple[str, int]:
    """Extract text from a PDF file. Pages without a text layer (scans) are
    rasterized and run through OCR so scanned PDFs work too."""
    import pymupdf

    doc = pymupdf.open(file_path)
    pages = []
    for page in doc:
        text = page.get_text()
        if not text.strip():
            from backend.services.ocr import ocr_image_bytes

            pix = page.get_pixmap(dpi=200)
            text = ocr_image_bytes(pix.tobytes("png"))
        pages.append(text)
    doc.close()

    text = "\n".join(pages)
    return text, len(pages)


def _parse_image(file_path: str) -> Tuple[str, int]:
    """Extract text from an image file via OCR."""
    from backend.services.ocr import ocr_image_file

    return ocr_image_file(file_path), 1


def parse_image_with_lines(file_path: str) -> Tuple[str, List[Dict]]:
    """OCR an image file and return (text, lines) where each line carries its
    bounding box (original image pixels) plus its character range within the
    returned text, so entity spans can be mapped back onto the image."""
    from backend.services.ocr import ocr_image_lines

    with open(file_path, "rb") as f:
        lines = ocr_image_lines(f.read())

    offset = 0
    for line in lines:
        line["start"] = offset
        line["end"] = offset + len(line["text"])
        offset = line["end"] + 1  # the "\n" joining lines

    text = "\n".join(line["text"] for line in lines)
    return text, lines


def _parse_docx(file_path: str) -> Tuple[str, int]:
    """Extract text from a DOCX file: body paragraphs, every real table cell
    (handling nested tables and merged-cell layouts), and every section's
    header and footer.

    We walk the raw OOXML tree instead of python-docx's high-level
    `row.cells` helper because the helper fabricates virtual cell wrappers
    for merged-cell grid positions that can reference an unrelated row's
    `<w:tc>` element — dedup-by-`_tc` therefore incorrectly skips real cells
    and we lose most of the table content (e.g. assessor names and thesis
    descriptions that live after a merged header row).

    Covering all text regions matters for two things: the PII scanner sees
    everything it should flag, and user-added CUSTOM selections from the
    review UI can be matched back against `original_text` no matter which
    region they came from (previously selections inside tables/headers were
    silently dropped)."""
    from docx import Document
    from docx.oxml.ns import qn

    W_P = qn('w:p')
    W_TBL = qn('w:tbl')
    W_TR = qn('w:tr')
    W_TC = qn('w:tc')
    W_T = qn('w:t')

    doc = Document(file_path)
    parts: List[str] = []

    def collect_body(element):
        """Iterate direct children of a body-like element (doc body, table
        cell, header, footer). `w:p` and `w:tbl` are the only structural
        children we care about; everything else (section properties, etc.)
        is skipped."""
        for child in element.iterchildren():
            if child.tag == W_P:
                text = "".join((t.text or "") for t in child.iter(W_T))
                if text.strip():
                    parts.append(text)
            elif child.tag == W_TBL:
                for tr in child.iterchildren(W_TR):
                    for tc in tr.iterchildren(W_TC):
                        collect_body(tc)

    collect_body(doc.element.body)
    for section in doc.sections:
        collect_body(section.header._element)
        collect_body(section.footer._element)

    text = "\n".join(parts)

    # Estimate page count (roughly 3000 chars per page)
    page_count = max(1, len(text) // 3000 + 1)
    return text, page_count


def _parse_csv(file_path: str) -> Tuple[str, int]:
    """Extract text from a CSV file."""
    df = _read_tabular_dataframe(file_path, ".csv")
    text = df.to_string()

    # Estimate page count
    page_count = max(1, len(df) // 50 + 1)
    return text, page_count


def _parse_excel(file_path: str, ext: str) -> Tuple[str, int]:
    """Extract text from an XLSX or XLS file."""
    df = _read_tabular_dataframe(file_path, ext)
    text = df.to_string()

    # Estimate page count
    page_count = max(1, len(df) // 50 + 1)
    return text, page_count

