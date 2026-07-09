"""PII detection and anonymization service.

Detection is delegated to the active engine in `backend.services.engines`
(GLiNER zero-shot, HF token classification, or regex), optionally boosted
by the deterministic pattern engine for structured PII.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict

from backend.services import engines

# ── Label configuration ──────────────────────────────────────────────

ALL_LABELS = [
    "person",
    "email",
    "phone number",
    "address",
    "credit card number",
    "social security number",
    "date of birth",
    "passport number",
    "driver's license number",
    "ip address",
    "url",
    "bank account number",
    "medical record number",
    "organization",
    "insurance number",
    "routing number",
    "tax identification number",
    "national id number",
    "vehicle registration number",
]

LABEL_TO_ENTITY: Dict[str, str] = {
    "person": "PERSON",
    "email": "EMAIL_ADDRESS",
    "phone number": "PHONE_NUMBER",
    "address": "LOCATION",
    "credit card number": "CREDIT_CARD",
    "social security number": "US_SSN",
    "date of birth": "DATE_OF_BIRTH",
    "passport number": "PASSPORT",
    "driver's license number": "DRIVERS_LICENSE",
    "ip address": "IP_ADDRESS",
    "url": "URL",
    "bank account number": "BANK_ACCOUNT",
    "medical record number": "MEDICAL_RECORD",
    "organization": "ORGANIZATION",
    "insurance number": "INSURANCE_ID",
    "routing number": "ROUTING_NUMBER",
    "tax identification number": "TAX_ID",
    "national id number": "NATIONAL_ID",
    "vehicle registration number": "VEHICLE_REG",
}

SETTINGS_PATH = Path.home() / ".maskbase" / "pii_labels.json"
CUSTOM_LABELS_PATH = Path.home() / ".maskbase" / "pii_labels_custom.json"


def _derive_entity_type(label: str) -> str:
    """Slug a free-form label into an uppercase entity-type token."""
    slug = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").upper()
    return slug or "CUSTOM"


def _load_custom_labels() -> Dict[str, str]:
    """Load user-defined labels → entity_type map from disk."""
    if not CUSTOM_LABELS_PATH.exists():
        return {}
    try:
        data = json.loads(CUSTOM_LABELS_PATH.read_text())
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _save_custom_labels(labels: Dict[str, str]) -> None:
    CUSTOM_LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_LABELS_PATH.write_text(json.dumps(labels, indent=2))


def _label_to_entity(label: str) -> str | None:
    """Resolve a label (built-in or custom) to its entity_type, or None if unknown."""
    if label in LABEL_TO_ENTITY:
        return LABEL_TO_ENTITY[label]
    custom = _load_custom_labels()
    return custom.get(label)


def get_all_labels() -> List[Dict[str, object]]:
    """Return all available labels (built-in + custom) with their enabled state."""
    enabled = set(_load_enabled_labels())
    custom = _load_custom_labels()
    out: List[Dict[str, object]] = [
        {
            "label": label,
            "entity_type": LABEL_TO_ENTITY[label],
            "enabled": label in enabled,
            "custom": False,
        }
        for label in ALL_LABELS
    ]
    for label, entity_type in custom.items():
        out.append({
            "label": label,
            "entity_type": entity_type,
            "enabled": label in enabled,
            "custom": True,
        })
    return out


def get_enabled_labels() -> List[str]:
    """Return only the currently enabled labels."""
    return _load_enabled_labels()


def set_enabled_labels(labels: List[str]) -> None:
    """Persist which labels are enabled."""
    custom = _load_custom_labels()
    valid = [l for l in labels if l in LABEL_TO_ENTITY or l in custom]
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(valid, indent=2))


def add_custom_label(label: str, entity_type: str | None = None) -> Dict[str, object]:
    """Add (or update) a user-defined PII label. Returns the saved record."""
    label = label.strip().lower()
    if not label:
        raise ValueError("Label cannot be empty")
    if label in LABEL_TO_ENTITY:
        raise ValueError(f"'{label}' is a built-in label")
    et = (entity_type or "").strip().upper() or _derive_entity_type(label)
    custom = _load_custom_labels()
    custom[label] = et
    _save_custom_labels(custom)

    # Auto-enable newly added labels so users don't need a second click.
    enabled = set(_load_enabled_labels())
    if label not in enabled:
        enabled.add(label)
        SETTINGS_PATH.write_text(json.dumps(sorted(enabled), indent=2))
    return {"label": label, "entity_type": et, "enabled": True, "custom": True}


def remove_custom_label(label: str) -> bool:
    """Delete a user-defined label. Returns True if something was removed."""
    label = label.strip().lower()
    custom = _load_custom_labels()
    if label not in custom:
        return False
    del custom[label]
    _save_custom_labels(custom)
    enabled = [l for l in _load_enabled_labels() if l != label]
    SETTINGS_PATH.write_text(json.dumps(enabled, indent=2))
    return True


def _load_enabled_labels() -> List[str]:
    """Load enabled labels from disk. Default: all built-in labels enabled."""
    custom = _load_custom_labels()
    if not SETTINGS_PATH.exists():
        return list(ALL_LABELS) + list(custom.keys())
    try:
        data = json.loads(SETTINGS_PATH.read_text())
        if isinstance(data, list):
            return [l for l in data if l in LABEL_TO_ENTITY or l in custom]
    except Exception:
        pass
    return list(ALL_LABELS) + list(custom.keys())


# ── Scanner session ──────────────────────────────────────────────────


class ScannerSession:
    """Per-session PII scanner using GLiNER."""

    # We fetch the threshold dynamically now
    CHUNK_SIZE = 800       # chars per chunk
    CHUNK_OVERLAP = 200    # overlap between chunks

    def __init__(self):
        self.original_text: str = ""
        self.redacted_text: str = ""
        self.filename: str = ""
        self._replacement_map: Dict[str, str] = {}
        self.detected_spans: List[Dict] = []

    def anonymize(
        self, text: str, labels: List[str] | None = None
    ) -> Tuple[str, List[Dict]]:
        """
        Anonymize text by replacing PII with placeholders.
        Detection runs on the active engine (chunked when the model needs it),
        then name variants and an exhaustive sweep close coverage gaps.
        Returns (redacted_text, entities).
        """
        from backend.services import llm

        self.original_text = text

        if labels is None:
            labels = _load_enabled_labels()

        if not labels:
            self.redacted_text = text
            return text, []

        engine = engines.get_engine()
        threshold = llm.get_threshold()
        ignore_pronouns = llm.get_ignore_pronouns()
        enabled_entity_types = {
            et for et in (_label_to_entity(l) for l in labels) if et
        }

        # ── Detection (chunked for model engines) ────────────────────
        raw_entities = self._run_engine(engine, text, labels, threshold, enabled_entity_types)

        # ── Regex boost: deterministic patterns for structured PII ───
        if engines.regex_boost_enabled() and engine.kind != "regex":
            raw_entities.extend(
                engines.get_regex_engine().detect(text, labels, threshold, enabled_entity_types)
            )

        # ── Normalize: every span carries an entity_type ──────────────
        raw_entities = self._normalize_spans(text, raw_entities)

        if ignore_pronouns:
            raw_entities = self._filter_pronouns(text, raw_entities)

        if not raw_entities:
            self.redacted_text = text
            return text, []

        # ── Name variant expansion ───────────────────────────────────
        # For every detected PERSON "First Last", also find "Last, First"
        raw_entities = self._expand_name_variants(text, raw_entities)

        # ── Exhaustive sweep ─────────────────────────────────────────
        # Chunked detection can miss recurring strings (e.g. a repeated
        # footer email). For every unique detected value, find every other
        # occurrence and mark it with the same type so nothing leaks
        # through to a downstream LLM.
        raw_entities = self._sweep_all_occurrences(text, raw_entities)

        # ── Deduplicate overlapping spans ─────────────────────────────
        raw_entities = self._deduplicate(raw_entities)

        # ── Store detected spans for the review step ──────────────────
        self.detected_spans = [
            {
                "text": text[ent["start"]:ent["end"]],
                "entity_type": ent["entity_type"],
                "start": ent["start"],
                "end": ent["end"],
            }
            for ent in sorted(raw_entities, key=lambda e: e["start"])
        ]

        # ── Replace PII with placeholders ─────────────────────────────
        return self._apply_redaction(text, self.detected_spans)

    @staticmethod
    def _normalize_spans(text: str, spans: List[Dict]) -> List[Dict]:
        """Ensure every span has entity_type/text; drop empty or invalid spans."""
        normalized: List[Dict] = []
        for span in spans:
            start, end = int(span["start"]), int(span["end"])
            if end <= start or start < 0 or end > len(text):
                continue
            entity_type = span.get("entity_type")
            if not entity_type:
                label = span.get("label", "")
                entity_type = _label_to_entity(label) or _derive_entity_type(label)
            normalized.append({
                "start": start,
                "end": end,
                "entity_type": entity_type,
                "score": float(span.get("score", 1.0)),
            })
        return normalized

    PRONOUN_WORDS = {
        "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
        "she", "her", "hers", "we", "us", "our", "they", "them", "their",
        "team", "teams", "company", "organization", "department",
    }

    def _filter_pronouns(self, text: str, spans: List[Dict]) -> List[Dict]:
        import string
        out = []
        for span in spans:
            word = text[span["start"]:span["end"]].strip().lower().strip(string.punctuation)
            if word not in self.PRONOUN_WORDS:
                out.append(span)
        return out

    def re_anonymize(
        self,
        included_indices: List[int],
        custom_texts: List[str] | None = None,
    ) -> Tuple[str, List[Dict], Dict[str, str]]:
        """Re-run redaction with user-selected spans plus any custom text the user flagged."""
        selected = [
            self.detected_spans[i]
            for i in included_indices
            if 0 <= i < len(self.detected_spans)
        ]

        if custom_texts:
            for raw in custom_texts:
                for start, end in self._find_flexible_occurrences(self.original_text, raw):
                    selected.append({
                        "text": self.original_text[start:end],
                        "entity_type": "CUSTOM",
                        "start": start,
                        "end": end,
                    })

        # Dedupe: a custom span may overlap an auto-detected one, or two custom
        # texts may match the same region. _apply_redaction assumes non-overlap.
        selected = self._dedupe_spans(selected)

        redacted_text, entities = self._apply_redaction(self.original_text, selected)
        return redacted_text, entities, dict(self._replacement_map)

    @staticmethod
    def _find_flexible_occurrences(haystack: str, needle: str) -> List[Tuple[int, int]]:
        """Find all occurrences of `needle` in `haystack`, tolerant of whitespace
        differences (PDF text selection often introduces line breaks not in the
        backend's extracted text)."""
        stripped = needle
        for ch in ("\u200b", "\u200c", "\u200d", "\ufeff"):
            stripped = stripped.replace(ch, "")
        stripped = stripped.strip()
        if not stripped or len(stripped) < 2:
            return []
        tokens = re.split(r"\s+", stripped)
        if not tokens:
            return []
        pattern = r"\s*".join(re.escape(t) for t in tokens)
        try:
            return [(m.start(), m.end()) for m in re.finditer(pattern, haystack) if m.end() > m.start()]
        except re.error:
            return []

    @staticmethod
    def _dedupe_spans(spans: List[Dict]) -> List[Dict]:
        """Drop spans that overlap earlier, longer spans. Kept spans never overlap."""
        if not spans:
            return spans
        ordered = sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"])))
        kept: List[Dict] = []
        for span in ordered:
            overlaps = False
            for prev in kept:
                if span["start"] < prev["end"] and span["end"] > prev["start"]:
                    overlaps = True
                    break
            if not overlaps:
                kept.append(span)
        return kept

    def _apply_redaction(
        self, text: str, spans: List[Dict]
    ) -> Tuple[str, List[Dict]]:
        """Replace spans with placeholders and return (redacted_text, entity_groups)."""
        self._replacement_map = {}
        sorted_spans = sorted(spans, key=lambda e: e["start"], reverse=True)
        anonymized = text
        counters: Dict[str, int] = {}

        for span in sorted_spans:
            entity_type = span["entity_type"]
            counters[entity_type] = counters.get(entity_type, 0) + 1
            idx = counters[entity_type]
            placeholder = f"[REDACTED_{entity_type}_{idx}]"
            self._replacement_map[placeholder] = span["text"]
            anonymized = anonymized[:span["start"]] + placeholder + anonymized[span["end"]:]

        self.redacted_text = anonymized
        entities = self._extract_entities(anonymized)
        return anonymized, entities

    def _run_engine(
        self, engine, text: str, labels: List[str], threshold: float,
        enabled_entity_types: set,
    ) -> List[Dict]:
        """Run the engine over the text, chunking when the model needs it."""
        if not engine.needs_chunking or len(text) <= self.CHUNK_SIZE:
            return list(engine.detect(text, labels, threshold, enabled_entity_types))

        all_entities: List[Dict] = []
        start = 0

        while start < len(text):
            end = min(start + self.CHUNK_SIZE, len(text))
            # Try to break at a newline to avoid splitting mid-sentence
            if end < len(text):
                nl = text.rfind("\n", start + self.CHUNK_SIZE - self.CHUNK_OVERLAP, end)
                if nl > start:
                    end = nl + 1

            chunk = text[start:end]
            chunk_ents = engine.detect(chunk, labels, threshold, enabled_entity_types)

            # Offset positions back to full-text coordinates
            for ent in chunk_ents:
                ent["start"] += start
                ent["end"] += start
                all_entities.append(ent)

            # Advance, keeping overlap
            start = end - self.CHUNK_OVERLAP if end < len(text) else len(text)

        return all_entities

    @staticmethod
    def _expand_name_variants(text: str, entities: List[Dict]) -> List[Dict]:
        """
        For every detected person name like 'First Last', also find
        'Last, First' and 'Last , First' variants in the text.
        """
        person_ents = [e for e in entities if e["entity_type"] == "PERSON"]
        extra: List[Dict] = []

        for ent in person_ents:
            name = text[ent["start"]:ent["end"]].strip()
            parts = name.split()
            if len(parts) < 2:
                continue

            # Build variant: "Last, First" and "Last , First"
            first = parts[0]
            last = " ".join(parts[1:])
            variants = [
                f"{last}, {first}",
                f"{last} , {first}",
                f"{last},{first}",
            ]

            for variant in variants:
                # Find all occurrences in the text
                search_start = 0
                while True:
                    idx = text.find(variant, search_start)
                    if idx == -1:
                        break
                    extra.append({
                        "start": idx,
                        "end": idx + len(variant),
                        "entity_type": "PERSON",
                        "score": ent["score"],
                    })
                    search_start = idx + len(variant)

        entities.extend(extra)
        return entities

    @staticmethod
    def _sweep_all_occurrences(text: str, entities: List[Dict]) -> List[Dict]:
        """
        For every unique (value, label) in `entities`, find every other
        occurrence of that exact string in `text` and add it as a span
        with the same label. Prevents coverage gaps from chunked detection
        (e.g. a repeated footer email only flagged on some pages).

        Skips very short purely alphabetic values (≤ 3 chars) to avoid
        matching substring noise like "ou" inside "Youth".
        """
        seen: Dict[Tuple[str, str], float] = {}
        for ent in entities:
            value = text[ent["start"]:ent["end"]]
            if not value.strip():
                continue
            if len(value.strip()) <= 3 and value.strip().isalpha():
                continue
            key = (value, ent["entity_type"])
            if key not in seen or ent.get("score", 0) > seen[key]:
                seen[key] = ent.get("score", 1.0)

        extra: List[Dict] = []
        for (value, entity_type), score in seen.items():
            search_start = 0
            while True:
                idx = text.find(value, search_start)
                if idx == -1:
                    break
                extra.append({
                    "start": idx,
                    "end": idx + len(value),
                    "entity_type": entity_type,
                    "score": score,
                })
                search_start = idx + len(value)

        entities.extend(extra)
        return entities

    @staticmethod
    def _deduplicate(entities: List[Dict]) -> List[Dict]:
        """Remove overlapping entity spans, keeping the longest/highest-score."""
        if not entities:
            return entities

        # Sort by start position, then by span length descending
        entities.sort(key=lambda e: (e["start"], -(e["end"] - e["start"])))

        deduped: List[Dict] = []
        for ent in entities:
            # Check if this overlaps with an already-kept entity
            overlaps = False
            for kept in deduped:
                if ent["start"] < kept["end"] and ent["end"] > kept["start"]:
                    overlaps = True
                    break
            if not overlaps:
                deduped.append(ent)

        return deduped

    def deanonymize(self, text: str) -> str:
        """Replace placeholders in AI response with real values."""
        result = text
        for placeholder in sorted(self._replacement_map.keys(), key=len, reverse=True):
            result = result.replace(placeholder, self._replacement_map[placeholder])
        return result

    def _extract_entities(self, redacted_text: str) -> List[Dict]:
        """Extract entity groups from redacted text by finding placeholder patterns."""
        pattern = r"\[(REDACTED_([A-Z_]+?)_(\d+))\]"
        matches = re.findall(pattern, redacted_text)

        entity_map: Dict[str, Dict] = defaultdict(
            lambda: {"count": 0, "examples": set()}
        )

        for full_match, entity_type, number in matches:
            placeholder = f"[{full_match}]"
            entity_map[entity_type]["count"] = max(
                entity_map[entity_type]["count"], int(number)
            )
            entity_map[entity_type]["examples"].add(placeholder)

        entities = []
        for entity_type, data in entity_map.items():
            entities.append(
                {
                    "type": entity_type,
                    "count": data["count"],
                    "examples": sorted(list(data["examples"]))[:5],
                }
            )

        return sorted(entities, key=lambda x: x["count"], reverse=True)


class RestoredSession:
    """
    A lightweight session restored from disk.
    Uses a pre-built replacement map for deanonymization instead of GLiNER.
    """

    def __init__(
        self,
        original_text: str,
        redacted_text: str,
        filename: str = "",
        replacement_map: Dict[str, str] | None = None,
    ):
        self.original_text = original_text
        self.redacted_text = redacted_text
        self.filename: str = filename
        self._replacement_map: Dict[str, str] = replacement_map or {}

    def deanonymize(self, text: str) -> str:
        """Replace placeholders in AI response with real values."""
        result = text
        for placeholder in sorted(self._replacement_map.keys(), key=len, reverse=True):
            result = result.replace(placeholder, self._replacement_map[placeholder])
        return result


# ── Session registry ─────────────────────────────────────────────────

_sessions: Dict[str, object] = {}


def create_session(session_id: str) -> ScannerSession:
    """Create a new scanner session."""
    session = ScannerSession()
    _sessions[session_id] = session
    return session


def restore_session(
    session_id: str,
    original_text: str,
    redacted_text: str,
    filename: str = "",
    replacement_map: Dict[str, str] | None = None,
    detected_spans: List[Dict] | None = None,
):
    """Restore a session from saved original + redacted text.

    When the saved detected spans are available, restore a full
    ScannerSession so the redaction stays editable (re_anonymize works);
    otherwise fall back to a read-only RestoredSession.
    """
    if detected_spans:
        session = ScannerSession()
        session.original_text = original_text
        session.redacted_text = redacted_text
        session.filename = filename
        session._replacement_map = dict(replacement_map or {})
        session.detected_spans = [
            {
                "text": s["text"],
                "entity_type": s["entity_type"],
                "start": s["start"],
                "end": s["end"],
            }
            for s in detected_spans
        ]
        _sessions[session_id] = session
        return session

    session = RestoredSession(
        original_text, redacted_text,
        filename=filename,
        replacement_map=replacement_map,
    )
    _sessions[session_id] = session
    return session


def get_session(session_id: str):
    """Get an existing session (ScannerSession or RestoredSession)."""
    if session_id not in _sessions:
        raise ValueError(f"Session {session_id} not found")
    return _sessions[session_id]
