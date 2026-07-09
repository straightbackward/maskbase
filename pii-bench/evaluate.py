"""
Evaluation logic for PII redaction benchmarks.

Computes per-case and aggregate metrics:
  - Detected:  was the PII value removed/replaced in the output?
  - Leaked:    was the PII value still present verbatim in the output?
  - Recall:    fraction of PII items successfully redacted
  - Precision: (estimated) fraction of redactions that correspond to real PII
"""

import re
from typing import Dict, List, Any


# Matches placeholders like [REDACTED_PERSON_1], [PERSON_1], etc.
PLACEHOLDER_RE = re.compile(r"\[(?:REDACTED_)?[A-Z_]+_\d+\]")


def _pii_is_leaked(pii_value: str, redacted_text: str) -> bool:
    """Check if a PII value still appears verbatim in the redacted output."""
    return pii_value in redacted_text


def evaluate_case(
    test_case: Dict[str, Any],
    redacted_text: str,
) -> Dict[str, Any]:
    """
    Evaluate a single test case.

    Returns:
        {
            "id": str,
            "total_pii": int,
            "detected": int,
            "leaked": int,
            "leaked_items": [{"value": ..., "type": ...}, ...],
            "recall": float,          # detected / total_pii
            "placeholder_count": int,  # how many placeholders the model inserted
        }
    """
    pii_items = test_case.get("pii", [])
    total = len(pii_items)

    detected = 0
    leaked = 0
    leaked_items = []

    for item in pii_items:
        value = item["value"]
        if _pii_is_leaked(value, redacted_text):
            leaked += 1
            leaked_items.append(item)
        else:
            detected += 1

    placeholder_count = len(PLACEHOLDER_RE.findall(redacted_text))

    return {
        "id": test_case["id"],
        "total_pii": total,
        "detected": detected,
        "leaked": leaked,
        "leaked_items": leaked_items,
        "recall": detected / total if total > 0 else 1.0,
        "placeholder_count": placeholder_count,
    }


def evaluate_all(
    test_cases: List[Dict[str, Any]],
    redacted_outputs: List[str],
) -> Dict[str, Any]:
    """
    Evaluate all test cases and compute aggregate metrics.

    Returns:
        {
            "per_case": [evaluate_case result, ...],
            "summary": {
                "total_pii": int,
                "total_detected": int,
                "total_leaked": int,
                "overall_recall": float,
                "recall_by_type": {type: float, ...},
                "perfect_cases": int,   # cases with 100% recall
                "total_cases": int,
            }
        }
    """
    per_case = []
    for tc, redacted in zip(test_cases, redacted_outputs):
        per_case.append(evaluate_case(tc, redacted))

    # Aggregate
    total_pii = sum(r["total_pii"] for r in per_case)
    total_detected = sum(r["detected"] for r in per_case)
    total_leaked = sum(r["leaked"] for r in per_case)
    perfect = sum(1 for r in per_case if r["recall"] == 1.0)

    # Recall by PII type
    type_totals: Dict[str, int] = {}
    type_detected: Dict[str, int] = {}
    for tc, result in zip(test_cases, per_case):
        leaked_values = {item["value"] for item in result["leaked_items"]}
        for item in tc.get("pii", []):
            t = item["type"]
            type_totals[t] = type_totals.get(t, 0) + 1
            if item["value"] not in leaked_values:
                type_detected[t] = type_detected.get(t, 0) + 1

    recall_by_type = {}
    for t in sorted(type_totals.keys()):
        recall_by_type[t] = type_detected.get(t, 0) / type_totals[t]

    return {
        "per_case": per_case,
        "summary": {
            "total_pii": total_pii,
            "total_detected": total_detected,
            "total_leaked": total_leaked,
            "overall_recall": total_detected / total_pii if total_pii > 0 else 1.0,
            "recall_by_type": recall_by_type,
            "perfect_cases": perfect,
            "total_cases": len(per_case),
        },
    }

