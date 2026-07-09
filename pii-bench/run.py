#!/usr/bin/env python3
"""
PII Redaction Benchmark Runner
===============================
Runs all test cases through each registered model, evaluates results,
and prints a detailed report.

Usage:
    python run.py                     # run all models
    python run.py --model llm_guard_bert_large_ner   # run one model
    python run.py --verbose           # show redacted text for every case
"""

import argparse
import sys
import time
from typing import List

from tabulate import tabulate

from test_cases import TEST_CASES
from models import MODELS
from evaluate import evaluate_all, PLACEHOLDER_RE


# ── CLI ──────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="PII redaction benchmark")
    p.add_argument(
        "--model",
        choices=list(MODELS.keys()),
        default=None,
        help="Run only this model (default: all)",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Print redacted text for every test case",
    )
    p.add_argument(
        "--case",
        default=None,
        help="Run only this test case id",
    )
    return p.parse_args()


# ── Pretty printing ─────────────────────────────────────────────────

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


def color_pct(value: float) -> str:
    """Color a percentage: green ≥90%, yellow ≥70%, red <70%."""
    pct = f"{value * 100:.1f}%"
    if value >= 0.9:
        return f"{GREEN}{pct}{RESET}"
    elif value >= 0.7:
        return f"{YELLOW}{pct}{RESET}"
    else:
        return f"{RED}{pct}{RESET}"


def print_header(model_name: str):
    width = 70
    print()
    print(f"{BOLD}{'=' * width}{RESET}")
    print(f"{BOLD}{CYAN}  MODEL: {model_name}{RESET}")
    print(f"{BOLD}{'=' * width}{RESET}")
    print()


def print_case_detail(case, result, redacted_text, verbose):
    """Print per-case results."""
    status = f"{GREEN}✓ PASS{RESET}" if result["recall"] == 1.0 else f"{RED}✗ FAIL{RESET}"
    recall_str = color_pct(result["recall"])

    print(f"  {status}  {BOLD}{case['id']}{RESET}  "
          f"[{result['detected']}/{result['total_pii']} detected, "
          f"recall={recall_str}, "
          f"placeholders={result['placeholder_count']}]")

    if result["leaked_items"]:
        for item in result["leaked_items"]:
            print(f"         {RED}⚠ LEAKED:{RESET} {item['type']}: \"{item['value']}\"")

    if verbose:
        # Show a truncated version of redacted output
        preview = redacted_text[:300]
        if len(redacted_text) > 300:
            preview += "..."
        print(f"         {CYAN}Redacted:{RESET} {preview}")
        print()


def print_summary(report):
    """Print aggregate summary tables."""
    s = report["summary"]

    print()
    print(f"{BOLD}── Summary ──────────────────────────────────────────{RESET}")
    print()

    # Overall stats
    rows = [
        ["Total PII items", s["total_pii"]],
        ["Detected (redacted)", f"{s['total_detected']}"],
        ["Leaked (missed)", f"{RED}{s['total_leaked']}{RESET}" if s["total_leaked"] else f"{GREEN}0{RESET}"],
        ["Overall recall", color_pct(s["overall_recall"])],
        ["Perfect cases", f"{s['perfect_cases']}/{s['total_cases']}"],
    ]
    print(tabulate(rows, tablefmt="simple"))
    print()

    # Recall by type
    print(f"{BOLD}── Recall by PII Type ───────────────────────────────{RESET}")
    print()
    type_rows = []
    for pii_type, recall in s["recall_by_type"].items():
        type_rows.append([pii_type, color_pct(recall)])
    type_rows.sort(key=lambda r: r[0])
    print(tabulate(type_rows, headers=["PII Type", "Recall"], tablefmt="simple"))
    print()


# ── Main ─────────────────────────────────────────────────────────────

def run_model(model_name: str, scan_fn, cases: List[dict], verbose: bool):
    """Run a single model against all test cases."""
    print_header(model_name)

    redacted_outputs = []
    total_time = 0.0

    for case in cases:
        t0 = time.time()
        try:
            redacted = scan_fn(case["text"])
        except Exception as e:
            redacted = case["text"]  # treat errors as "nothing redacted"
            print(f"  {RED}ERROR on {case['id']}: {e}{RESET}")
        elapsed = time.time() - t0
        total_time += elapsed
        redacted_outputs.append(redacted)

    report = evaluate_all(cases, redacted_outputs)

    for case, result, redacted in zip(cases, report["per_case"], redacted_outputs):
        print_case_detail(case, result, redacted, verbose)

    print_summary(report)
    print(f"  ⏱  Total scan time: {total_time:.2f}s  "
          f"(avg {total_time / len(cases):.2f}s/case)")
    print()

    return report


def main():
    args = parse_args()

    # Filter models
    if args.model:
        models_to_run = {args.model: MODELS[args.model]}
    else:
        models_to_run = MODELS

    # Filter cases
    if args.case:
        cases = [c for c in TEST_CASES if c["id"] == args.case]
        if not cases:
            print(f"{RED}No test case with id '{args.case}'{RESET}")
            sys.exit(1)
    else:
        cases = TEST_CASES

    print(f"\n{BOLD}PII Redaction Benchmark{RESET}")
    print(f"  {len(cases)} test cases × {len(models_to_run)} model(s)\n")

    all_reports = {}
    for name, scan_fn in models_to_run.items():
        all_reports[name] = run_model(name, scan_fn, cases, args.verbose)

    # ── Cross-model comparison (if multiple) ─────────────────────
    if len(all_reports) > 1:
        print(f"\n{BOLD}{'=' * 70}{RESET}")
        print(f"{BOLD}{CYAN}  CROSS-MODEL COMPARISON{RESET}")
        print(f"{BOLD}{'=' * 70}{RESET}\n")

        comp_rows = []
        for name, report in all_reports.items():
            s = report["summary"]
            comp_rows.append([
                name,
                s["total_pii"],
                s["total_detected"],
                s["total_leaked"],
                color_pct(s["overall_recall"]),
                f"{s['perfect_cases']}/{s['total_cases']}",
            ])
        print(tabulate(
            comp_rows,
            headers=["Model", "Total PII", "Detected", "Leaked", "Recall", "Perfect"],
            tablefmt="simple",
        ))
        print()


if __name__ == "__main__":
    main()

