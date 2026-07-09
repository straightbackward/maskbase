"""Pluggable PII-detection engines.

Three engine kinds, modelled after the MaskBase PII benchmark:
  - "gliner":    zero-shot span extraction (any GLiNER checkpoint on HF Hub)
  - "hf_token":  fixed-vocabulary token classification (any HF token-classification model)
  - "regex":     deterministic patterns for structured PII (offline, instant)

The active engine is persisted to ~/.maskbase/engine.json and loaded in a
background thread so /health can report readiness while weights download.
"""

import json
import re
import threading
from pathlib import Path
from typing import Dict, List, Optional

CONFIG_PATH = Path.home() / ".maskbase" / "engine.json"
MODELS_DIR = Path.home() / ".maskbase" / "models"

DEFAULT_ENGINE = {"kind": "gliner", "model_id": "urchade/gliner_multi_pii-v1"}

ENGINE_CATALOG: List[Dict] = [
    {
        "id": "gliner-multi-pii",
        "kind": "gliner",
        "model_id": "urchade/gliner_multi_pii-v1",
        "label": "GLiNER Multi-PII",
        "description": "Multilingual zero-shot PII model. Best all-round accuracy and supports custom entity types.",
        "size": "~1.2 GB",
        "recommended": True,
    },
    {
        "id": "gliner-small",
        "kind": "gliner",
        "model_id": "urchade/gliner_small-v2.1",
        "label": "GLiNER Small",
        "description": "Compact zero-shot model. Faster and lighter, English-focused, supports custom entity types.",
        "size": "~620 MB",
        "recommended": False,
    },
    {
        "id": "gliner-nvidia-pii",
        "kind": "gliner",
        "model_id": "nvidia/gliner-PII",
        "label": "NVIDIA GLiNER PII",
        "description": "NVIDIA's PII-tuned GLiNER checkpoint. Strong on English PII, supports custom entity types.",
        "size": "~1.2 GB",
        "recommended": False,
    },
    {
        "id": "distilbert-ai4privacy",
        "kind": "hf_token",
        "model_id": "Isotonic/distilbert_finetuned_ai4privacy_v2",
        "label": "DistilBERT AI4Privacy",
        "description": "Fast fixed-vocabulary classifier fine-tuned on the AI4Privacy dataset. No custom entity types.",
        "size": "~270 MB",
        "recommended": False,
    },
    {
        "id": "regex-only",
        "kind": "regex",
        "model_id": "",
        "label": "Pattern matching only",
        "description": "Deterministic patterns for emails, phones, cards, SSNs, IPs, URLs and IBANs. Instant and fully offline, but misses names and addresses.",
        "size": "0 MB",
        "recommended": False,
    },
]


def _safe_dir_name(model_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", model_id)


# ── Download progress ─────────────────────────────────────────────────
# Written by the loading thread, read by /health so the UI can show a
# real progress bar during the first-launch model download.

_progress_lock = threading.Lock()
_progress: Dict = {"stage": None, "downloaded_bytes": 0, "total_bytes": 0}


def _set_progress(stage: Optional[str], downloaded: int = 0, total: int = 0) -> None:
    with _progress_lock:
        _progress["stage"] = stage
        _progress["downloaded_bytes"] = downloaded
        _progress["total_bytes"] = total


def _dir_size(path: Path) -> int:
    try:
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    except OSError:
        return 0


def _download_with_progress(model_id: str, local_dir: Path) -> None:
    """snapshot_download with byte-level progress derived from disk usage.

    Total size comes from the Hub API; if that call fails the download still
    runs, just with an unknown total (the UI falls back to an indeterminate
    bar). Partial downloads resume — snapshot_download skips complete files.
    """
    from huggingface_hub import HfApi, snapshot_download

    total = 0
    try:
        info = HfApi().model_info(model_id, files_metadata=True)
        total = sum(s.size or 0 for s in info.siblings)
    except Exception:
        pass

    _set_progress("downloading", _dir_size(local_dir), total)
    done = threading.Event()

    def _watch() -> None:
        while not done.wait(0.5):
            # Counts .incomplete files too, so resumed downloads start ahead.
            _set_progress("downloading", min(_dir_size(local_dir), total or 1 << 62), total)

    watcher = threading.Thread(target=_watch, daemon=True)
    watcher.start()
    try:
        snapshot_download(model_id, local_dir=str(local_dir))
    finally:
        done.set()
        watcher.join(timeout=2)
    _set_progress("loading", total, total)


# ── Engines ───────────────────────────────────────────────────────────


class RegexEngine:
    """Deterministic detection of structured PII. No model download."""

    kind = "regex"
    zero_shot = False
    needs_chunking = False

    _LUHN_EXEMPT_LEN = 0

    PATTERNS = [
        ("EMAIL_ADDRESS", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
        ("URL", re.compile(r"\bhttps?://[^\s<>\"')\]]+|\bwww\.[A-Za-z0-9-]+\.[^\s<>\"')\]]+")),
        ("IP_ADDRESS", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")),
        ("US_SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
        ("CREDIT_CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
        ("BANK_ACCOUNT", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b")),  # IBAN
        ("PHONE_NUMBER", re.compile(r"(?<![\d.])\+?\(?\d{2,4}\)?(?:[ ./-]?\d{2,4}){2,4}(?![\d.])")),
    ]

    @staticmethod
    def _luhn_ok(digits: str) -> bool:
        total, alt = 0, False
        for ch in reversed(digits):
            d = ord(ch) - 48
            if alt:
                d *= 2
                if d > 9:
                    d -= 9
            total += d
            alt = not alt
        return total % 10 == 0

    def load(self) -> None:
        return None

    def detect(self, text: str, labels: List[str], threshold: float,
               enabled_entity_types: Optional[set] = None) -> List[Dict]:
        spans: List[Dict] = []
        for entity_type, pattern in self.PATTERNS:
            if enabled_entity_types is not None and entity_type not in enabled_entity_types:
                continue
            for m in pattern.finditer(text):
                value = m.group(0)
                digits = re.sub(r"\D", "", value)
                if entity_type == "CREDIT_CARD":
                    if not (13 <= len(digits) <= 19 and self._luhn_ok(digits)):
                        continue
                if entity_type == "PHONE_NUMBER":
                    # Require enough digits and avoid swallowing card-length runs
                    if not (7 <= len(digits) <= 13):
                        continue
                    # Dates (01.02.2026, 31/07/26) match the separator shape —
                    # leave those to the model's date-of-birth detection.
                    if re.fullmatch(r"\d{1,2}[./-]\d{1,2}[./-]\d{2,4}", value.strip()):
                        continue
                spans.append({
                    "start": m.start(),
                    "end": m.end(),
                    "entity_type": entity_type,
                    "score": 1.0,
                })
        return spans


class GlinerEngine:
    """Zero-shot span extraction with any GLiNER checkpoint."""

    kind = "gliner"
    zero_shot = True
    needs_chunking = True

    def __init__(self, model_id: str):
        self.model_id = model_id
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        from gliner import GLiNER

        local_dir = MODELS_DIR / _safe_dir_name(self.model_id)
        # Pre-0.3 releases cached under the bare repo name (no org prefix)
        legacy_dir = MODELS_DIR / self.model_id.split("/")[-1]
        for cache_dir in (local_dir, legacy_dir):
            if cache_dir.exists() and any(cache_dir.iterdir()):
                try:
                    self._model = GLiNER.from_pretrained(str(cache_dir))
                    return
                except Exception:
                    # Partial/corrupt cache (e.g. quit mid-download) — re-fetch;
                    # snapshot_download resumes whatever is already on disk.
                    pass
        _download_with_progress(self.model_id, local_dir)
        self._model = GLiNER.from_pretrained(str(local_dir))

    def detect(self, text: str, labels: List[str], threshold: float,
               enabled_entity_types: Optional[set] = None) -> List[Dict]:
        ents = self._model.predict_entities(text, labels, threshold=threshold)
        return [
            {
                "start": e["start"],
                "end": e["end"],
                "label": e["label"],
                "score": e.get("score", 1.0),
            }
            for e in ents
        ]


# Maps fixed-vocabulary model outputs (BIO groups, AI4Privacy labels, …)
# onto MaskBase entity types. Unknown groups fall through as an upper slug.
HF_GROUP_TO_ENTITY: Dict[str, str] = {
    "PER": "PERSON", "PERSON": "PERSON", "NAME": "PERSON",
    "GIVENNAME": "PERSON", "SURNAME": "PERSON", "FIRSTNAME": "PERSON",
    "LASTNAME": "PERSON", "MIDDLENAME": "PERSON", "PREFIX": "PERSON",
    "EMAIL": "EMAIL_ADDRESS", "EMAIL_ADDRESS": "EMAIL_ADDRESS",
    "TELEPHONENUM": "PHONE_NUMBER", "PHONE_NUMBER": "PHONE_NUMBER",
    "PHONEIMEI": "PHONE_NUMBER",
    "LOC": "LOCATION", "LOCATION": "LOCATION", "ADDRESS": "LOCATION",
    "STREET": "LOCATION", "STREETADDRESS": "LOCATION", "CITY": "LOCATION",
    "STATE": "LOCATION", "ZIPCODE": "LOCATION", "BUILDINGNUM": "LOCATION",
    "SECONDARYADDRESS": "LOCATION",
    "CREDITCARDNUMBER": "CREDIT_CARD", "CREDITCARDCVV": "CREDIT_CARD",
    "SOCIALNUM": "US_SSN", "SSN": "US_SSN",
    "DATEOFBIRTH": "DATE_OF_BIRTH", "DOB": "DATE_OF_BIRTH",
    "PASSPORTNUM": "PASSPORT",
    "DRIVERLICENSENUM": "DRIVERS_LICENSE",
    "IDCARDNUM": "NATIONAL_ID",
    "TAXNUM": "TAX_ID",
    "IP": "IP_ADDRESS", "IPV4": "IP_ADDRESS", "IPV6": "IP_ADDRESS",
    "URL": "URL",
    "ACCOUNTNUM": "BANK_ACCOUNT", "IBAN": "BANK_ACCOUNT",
    "ROUTING_NUMBER": "ROUTING_NUMBER",
    "ORG": "ORGANIZATION", "ORGANIZATION": "ORGANIZATION",
    "COMPANY_NAME": "ORGANIZATION", "COMPANYNAME": "ORGANIZATION",
    "VEHICLEVIN": "VEHICLE_REG", "VEHICLEVRM": "VEHICLE_REG",
    "USERNAME": "USERNAME",
    "PASSWORD": "PASSWORD",
}


class HFTokenEngine:
    """Fixed-vocabulary token classification via transformers pipeline."""

    kind = "hf_token"
    zero_shot = False
    needs_chunking = True

    def __init__(self, model_id: str):
        self.model_id = model_id
        self._pipe = None

    def load(self) -> None:
        if self._pipe is not None:
            return
        from transformers import pipeline

        # Download into our models dir (with progress) rather than the hidden
        # HF cache — also makes is_model_cached() accurate for hf_token models.
        local_dir = MODELS_DIR / _safe_dir_name(self.model_id)
        if local_dir.exists() and any(local_dir.iterdir()):
            try:
                self._pipe = pipeline(
                    "token-classification",
                    model=str(local_dir),
                    aggregation_strategy="simple",
                )
                return
            except Exception:
                # Partial/corrupt cache — re-fetch; snapshot_download resumes.
                pass
        _download_with_progress(self.model_id, local_dir)
        self._pipe = pipeline(
            "token-classification",
            model=str(local_dir),
            aggregation_strategy="simple",
        )

    @staticmethod
    def _normalize_group(group: str) -> str:
        key = re.sub(r"^[BIES]-", "", group).strip().upper().replace(" ", "_")
        if key in HF_GROUP_TO_ENTITY:
            return HF_GROUP_TO_ENTITY[key]
        return re.sub(r"[^A-Z0-9]+", "_", key).strip("_") or "PII"

    def detect(self, text: str, labels: List[str], threshold: float,
               enabled_entity_types: Optional[set] = None) -> List[Dict]:
        spans: List[Dict] = []
        for ent in self._pipe(text):
            score = float(ent.get("score", 0.0))
            if score < threshold:
                continue
            entity_type = self._normalize_group(str(ent.get("entity_group", "PII")))
            # Respect disabled built-in types; keep types we don't track.
            if enabled_entity_types is not None and entity_type not in enabled_entity_types:
                if entity_type in set(HF_GROUP_TO_ENTITY.values()):
                    continue
            start, end = int(ent["start"]), int(ent["end"])
            if end <= start:
                continue
            spans.append({
                "start": start,
                "end": end,
                "entity_type": entity_type,
                "score": score,
            })
        return spans


# ── Active engine state ───────────────────────────────────────────────

_lock = threading.Lock()
_active_engine = None
_active_config: Dict = {}
_state = "not_loaded"   # not_loaded | loading | ready | error
_error: Optional[str] = None
_regex_boost = RegexEngine()


def _load_config() -> Dict:
    cfg = dict(DEFAULT_ENGINE)
    cfg["regex_boost"] = True
    if CONFIG_PATH.exists():
        try:
            saved = json.loads(CONFIG_PATH.read_text())
            if isinstance(saved, dict):
                cfg.update({k: v for k, v in saved.items() if k in ("kind", "model_id", "regex_boost")})
        except Exception:
            pass
    return cfg


def _save_config(cfg: Dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def _build_engine(kind: str, model_id: str):
    if kind == "regex":
        return RegexEngine()
    if kind == "hf_token":
        return HFTokenEngine(model_id)
    return GlinerEngine(model_id)


def _load_active_locked() -> None:
    """Load the configured engine. Caller must hold no lock (we take it)."""
    global _active_engine, _state, _error, _active_config
    with _lock:
        cfg = _load_config()
        _active_config = cfg
        engine = _build_engine(cfg["kind"], cfg.get("model_id", ""))
        _state = "loading"
        _error = None
    _set_progress("loading")
    try:
        engine.load()
        with _lock:
            _active_engine = engine
            _state = "ready"
    except Exception as exc:  # download failure, bad repo id, …
        with _lock:
            _state = "error"
            _error = str(exc)
    finally:
        _set_progress(None)


def preload() -> None:
    """Eagerly load the configured engine (call at startup)."""
    _load_active_locked()


def is_ready() -> bool:
    return _state == "ready"


def get_status() -> Dict:
    cfg = _active_config or _load_config()
    with _progress_lock:
        progress = dict(_progress)
    return {
        "kind": cfg.get("kind", DEFAULT_ENGINE["kind"]),
        "model_id": cfg.get("model_id", DEFAULT_ENGINE["model_id"]),
        "state": _state,
        "error": _error,
        "regex_boost": bool(cfg.get("regex_boost", True)),
        "progress": progress,
    }


def get_engine():
    """Return the loaded engine, loading synchronously if needed."""
    if _state != "ready" or _active_engine is None:
        _load_active_locked()
    if _state != "ready" or _active_engine is None:
        raise RuntimeError(_error or "PII engine is not ready yet")
    return _active_engine


def get_regex_engine() -> RegexEngine:
    return _regex_boost


def regex_boost_enabled() -> bool:
    cfg = _active_config or _load_config()
    return bool(cfg.get("regex_boost", True))


def set_regex_boost(enabled: bool) -> None:
    global _active_config
    cfg = _load_config()
    cfg["regex_boost"] = bool(enabled)
    _save_config(cfg)
    with _lock:
        _active_config = cfg


def select_engine(kind: str, model_id: str) -> Dict:
    """Persist a new engine choice and start loading it in the background."""
    global _state, _error, _active_engine
    if kind not in ("gliner", "hf_token", "regex"):
        raise ValueError(f"Unknown engine kind: {kind}")
    if kind != "regex" and not model_id.strip():
        raise ValueError("A model id is required for this engine kind")

    cfg = _load_config()
    cfg["kind"] = kind
    cfg["model_id"] = model_id.strip()
    _save_config(cfg)

    global _active_config
    with _lock:
        _active_config = cfg
        _active_engine = None
        _state = "loading"
        _error = None
    threading.Thread(target=_load_active_locked, daemon=True).start()
    return get_status()


def is_model_cached(kind: str, model_id: str) -> bool:
    if kind == "regex":
        return True
    for cache_dir in (MODELS_DIR / _safe_dir_name(model_id), MODELS_DIR / model_id.split("/")[-1]):
        if cache_dir.exists() and any(cache_dir.iterdir()):
            return True
    # hf_token models live in the default HF cache; treat as not-yet-known
    return False


def list_catalog() -> Dict:
    cfg = _active_config or _load_config()
    entries = []
    for entry in ENGINE_CATALOG:
        e = dict(entry)
        e["cached"] = is_model_cached(entry["kind"], entry["model_id"])
        e["active"] = (entry["kind"] == cfg.get("kind") and entry["model_id"] == cfg.get("model_id", ""))
        e["zero_shot"] = entry["kind"] == "gliner"
        entries.append(e)

    active_in_catalog = any(e["active"] for e in entries)
    if not active_in_catalog:
        entries.append({
            "id": f"custom:{cfg.get('kind')}:{cfg.get('model_id', '')}",
            "kind": cfg.get("kind"),
            "model_id": cfg.get("model_id", ""),
            "label": cfg.get("model_id", "Custom model"),
            "description": "Custom model id from the Hugging Face Hub.",
            "size": "?",
            "recommended": False,
            "cached": is_model_cached(cfg.get("kind", "gliner"), cfg.get("model_id", "")),
            "active": True,
            "zero_shot": cfg.get("kind") == "gliner",
        })

    return {
        "engines": entries,
        "status": get_status(),
    }
