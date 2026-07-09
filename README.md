# MaskBase

**Open-source, local-first PII redaction for macOS — powered by small language models, with you in the loop.**

MaskBase scans PDF, DOCX, CSV and XLSX files for personally identifiable information using a small language model that runs **entirely on your machine**, shows you every detection for review, and exports a clean redacted copy. No account, no telemetry, no server — your documents and the PII inside them never leave your Mac.

> Need to share a contract with ChatGPT? Hand a dataset to a contractor? Publish a support log? Redact it first — locally.

## How it works

```
┌─────────────────────────── Your Mac ───────────────────────────┐
│                                                                │
│  document ──▶  local SLM scan  ──▶  human review  ──▶  export  │
│  (PDF/DOCX/     (GLiNER & co.,       (toggle, add,     (clean  │
│   CSV/XLSX)      fully offline)       select missed)    copy)  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
            nothing crosses this line unless you say so
```

1. **Scan** — a small language model (default: [GLiNER Multi-PII](https://huggingface.co/urchade/gliner_multi_pii-v1)) detects names, emails, phone numbers, addresses, card numbers, SSNs and 19+ other entity types. A deterministic pattern engine (emails, cards with Luhn check, IBANs, IPs…) can run on top for extra coverage.
2. **Review (human-in-the-loop)** — every detection is highlighted inline in the original PDF/DOCX. Toggle false positives off, select missed text to redact it, add custom entity types ("enrollment number", "patient id", …) on the fly.
3. **Export** — placeholders like `[REDACTED_PERSON_1]` replace the real values. Save or copy the redacted text; the replacement map stays on disk locally so *you* can always restore the originals.

## Choose your own models

**Redaction engines** (Settings → Redaction Engine) — switch between curated engines or paste any Hugging Face model id:

| Engine | Type | Notes |
|---|---|---|
| `urchade/gliner_multi_pii-v1` *(default)* | GLiNER zero-shot | Multilingual, best all-round, supports custom entity types |
| `urchade/gliner_small-v2.1` | GLiNER zero-shot | Lighter and faster |
| `nvidia/gliner-PII` | GLiNER zero-shot | NVIDIA's PII-tuned checkpoint |
| `Isotonic/distilbert_finetuned_ai4privacy_v2` | Token classifier | Fast fixed-vocabulary model (AI4Privacy) |
| Pattern matching only | Regex | Instant, fully offline, structured PII only |
| *any `org/model` from the HF Hub* | GLiNER or token classifier | Bring your own |

**Chat models** (optional) — if you want to ask an AI about a redacted document, only the placeholder text is ever sent, directly to a provider *you* configure:

- Your own API key: OpenAI, Anthropic, Google Gemini
- **Fully local**: [Ollama](https://ollama.com) is auto-detected — chat without anything leaving your machine
- Any **OpenAI-compatible endpoint**: LM Studio, llama.cpp server, vLLM, OpenRouter, …

## Privacy guarantees

- **No telemetry, no analytics, no crash reporting.** The code contains zero calls to any vendor server.
- **No accounts, no license checks.**
- **Update checks are manual** — the app only contacts GitHub Releases when you click "Check for updates".
- **AI chat is opt-in and bring-your-own.** Without a configured provider the app is 100 % offline after the one-time model download from the Hugging Face Hub.
- **No detector is perfect.** That's why the review step exists — always look before you share.

## Development

Prerequisites: Node 18+, Rust (stable), Python 3.11+.

```sh
git clone https://github.com/straightbackward/maskbase.git && cd maskbase

# 1. Python backend (FastAPI sidecar on 127.0.0.1:22140)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python run_backend.py        # terminal 1

# 2. Desktop app (Tauri + React)
npm install
npm run tauri dev                              # terminal 2
```

The first scan downloads the default model (~1.2 GB) into `~/.maskbase/models/` and caches it there.

### Building a DMG

```sh
./build-dmg.sh          # bundles the backend with PyInstaller, then builds the Tauri app
./build-dmg.sh --sign   # optional: codesign + notarize with your own identity
```

### Architecture

- `src/` — React 19 + Tailwind UI (Tauri 2 WebView)
- `src-tauri/` — Rust shell; spawns and supervises the Python sidecar
- `backend/` — FastAPI service: document parsing (PyMuPDF, python-docx, pandas), the pluggable engine registry (`backend/services/engines.py`), redaction sessions, and the optional chat client
- All app data lives in `~/.maskbase/` (models, sessions, settings) — delete it with `./reset-app-data.sh`

## Background

The engine lineup comes out of a master's-thesis benchmark comparing regex, spaCy, fixed-vocabulary transformers, zero-shot GLiNER variants and small generative LLMs on PII-detection datasets (AI4Privacy, SPY). GLiNER-class models offered the best accuracy-per-megabyte for on-device use — and zero-shot labels are what make user-defined entity types possible.

## Contributing

Issues and PRs are welcome. Interesting directions: more engine kinds (spaCy, GLiNER2, llama.cpp-based extraction), redacted-PDF export (true visual redaction), Windows/Linux builds, and benchmark harness integration.

## License

[MIT](LICENSE)
