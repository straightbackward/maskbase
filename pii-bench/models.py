"""
Model configurations for PII redaction benchmarking.

Each model is a callable factory that returns a function:
    scan(text: str) -> str   (returns redacted text)

To add a new model, append to MODELS dict.
"""

import re
from typing import List

from llm_guard.input_scanners import Anonymize
from llm_guard.input_scanners.anonymize_helpers import (
    BERT_LARGE_NER_CONF,
    DEBERTA_AI4PRIVACY_v2_CONF,
    get_regex_patterns,
)
from llm_guard.vault import Vault


# ── llm_guard NER-based scanners ─────────────────────────────────────

def _make_llmguard_scanner(recognizer_conf, language="en", regex_patterns=None, **kwargs):
    """
    Factory: create a scan function for a given llm_guard recognizer config.
    The scanner is created once (lazy) and reused for all calls.
    """
    _scanner = None

    def scan(text: str) -> str:
        nonlocal _scanner
        if _scanner is None:
            _scanner = Anonymize(
                vault=Vault(),
                recognizer_conf=recognizer_conf,
                language=language,
                regex_patterns=regex_patterns,
                **kwargs,
            )
        # Each call still needs a fresh vault for clean placeholder numbering,
        # but the heavy NER model stays loaded. LLM Guard's scan() is stateless
        # w.r.t. the vault for input scanning — vault is only used for de-anonymization.
        sanitized, _is_valid, _risk_score = _scanner.scan(text)
        return sanitized

    return scan


def _make_llmguard_regex_only(language="en"):
    """Factory: llm_guard Anonymize with regex patterns only (no NER model)."""
    _scanner = None

    def scan(text: str) -> str:
        nonlocal _scanner
        if _scanner is None:
            _scanner = Anonymize(
                vault=Vault(),
                recognizer_conf=None,
                language=language,
                regex_patterns=get_regex_patterns(),
            )
        sanitized, _is_valid, _risk_score = _scanner.scan(text)
        return sanitized

    return scan


# ── GLiNER via Presidio ──────────────────────────────────────────────

def _make_gliner_scanner(
    model_name: str = "urchade/gliner_multi_pii-v1",
    labels: List[str] | None = None,
    threshold: float = 0.3,
):
    """
    Factory: GLiNER zero-shot NER → Presidio pipeline.
    Downloads the model on first run, then reuses it.
    """
    _model = None

    BASE_LABELS = [
        "person", "email", "phone number", "address", "credit card number",
        "social security number", "date of birth", "passport number",
        "driver's license number", "ip address", "url", "bank account number",
        "medical record number", "organization",
    ]

    EXPANDED_LABELS = BASE_LABELS + [
        "insurance number", "routing number", "tax identification number",
        "national id number", "vehicle registration number",
    ]

    DEFAULT_LABELS = BASE_LABELS

    # Map GLiNER labels → placeholder entity types
    LABEL_TO_ENTITY = {
        "person": "PERSON",
        "email": "EMAIL_ADDRESS",
        "phone number": "PHONE_NUMBER",
        "address": "LOCATION",
        "credit card number": "CREDIT_CARD",
        "social security number": "US_SSN",
        "date of birth": "DATE_TIME",
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

    used_labels = labels or DEFAULT_LABELS

    def scan(text: str) -> str:
        nonlocal _model

        if _model is None:
            from gliner import GLiNER
            _model = GLiNER.from_pretrained(model_name)

        entities = _model.predict_entities(text, used_labels, threshold=threshold)

        if not entities:
            return text

        # Sort by start position descending so replacements don't shift indices
        entities_sorted = sorted(entities, key=lambda e: e["start"], reverse=True)
        anonymized = text
        counters: dict[str, int] = {}
        for ent in entities_sorted:
            entity_type = LABEL_TO_ENTITY.get(ent["label"], ent["label"].upper())
            counters[entity_type] = counters.get(entity_type, 0) + 1
            placeholder = f"[REDACTED_{entity_type}_{counters[entity_type]}]"
            anonymized = anonymized[:ent["start"]] + placeholder + anonymized[ent["end"]:]

        return anonymized

    return scan


# ── Registry of models to benchmark ─────────────────────────────────
# Key   = human-readable model name
# Value = scan(text) -> redacted_text

MODELS = {
    # Current production model
    "bert_large_ner": _make_llmguard_scanner(BERT_LARGE_NER_CONF),

    # Same BERT model + built-in regex patterns (catches SSN, emails, phones via regex too)
    "bert_large_ner+regex": _make_llmguard_scanner(
        BERT_LARGE_NER_CONF,
        regex_patterns=get_regex_patterns(),
    ),

    # Regex-only baseline (no NER model — pure pattern matching)
    "regex_only": _make_llmguard_regex_only(),

    # DeBERTa fine-tuned on AI4Privacy v2 — richer entity coverage
    "deberta_ai4privacy": _make_llmguard_scanner(DEBERTA_AI4PRIVACY_v2_CONF),

    # DeBERTa + regex patterns combined
    "deberta_ai4privacy+regex": _make_llmguard_scanner(
        DEBERTA_AI4PRIVACY_v2_CONF,
        regex_patterns=get_regex_patterns(),
    ),

    # GLiNER zero-shot PII model (base labels, threshold=0.3)
    "gliner_multi_pii": _make_gliner_scanner(),

    # GLiNER tuned: expanded labels + lower threshold
    "gliner_tuned": _make_gliner_scanner(
        labels=[
            "person", "email", "phone number", "address", "credit card number",
            "social security number", "date of birth", "passport number",
            "driver's license number", "ip address", "url", "bank account number",
            "medical record number", "organization",
            # Expanded labels for niche PII types
            "insurance number", "routing number", "tax identification number",
            "national id number", "vehicle registration number",
        ],
        threshold=0.25,
    ),
}
