# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the MaskBase Python backend.
Bundles FastAPI + uvicorn + gliner/transformers + pymupdf into a single binary.

Run with:
    pyinstaller --clean backend.spec
"""

from PyInstaller.utils.hooks import collect_all

# ── Collect packages that have dynamic imports / data files ──────────────────

datas_gliner, binaries_gliner, hidden_gliner = collect_all("gliner")
datas_tf, binaries_tf, hidden_tf = collect_all("transformers")
datas_tok, binaries_tok, hidden_tok = collect_all("tokenizers")
datas_st, binaries_st, hidden_st = collect_all("safetensors")
datas_hub, binaries_hub, hidden_hub = collect_all("huggingface_hub")

# pymupdf (imported as fitz)
datas_fitz, binaries_fitz, hidden_fitz = collect_all("fitz")
datas_pymupdf, binaries_pymupdf, hidden_pymupdf = collect_all("pymupdf")

# RapidOCR ships its ONNX models + config yaml as package data
datas_ocr, binaries_ocr, hidden_ocr = collect_all("rapidocr")
datas_ort, binaries_ort, hidden_ort = collect_all("onnxruntime")

# ── Merge all collected data/binaries ────────────────────────────────────────

all_datas = (
    datas_gliner
    + datas_tf
    + datas_tok
    + datas_st
    + datas_hub
    + datas_fitz
    + datas_pymupdf
    + datas_ocr
    + datas_ort
)

all_binaries = (
    binaries_gliner
    + binaries_tf
    + binaries_tok
    + binaries_st
    + binaries_hub
    + binaries_fitz
    + binaries_pymupdf
    + binaries_ocr
    + binaries_ort
)

all_hidden = (
    hidden_gliner
    + hidden_tf
    + hidden_tok
    + hidden_st
    + hidden_hub
    + hidden_fitz
    + hidden_pymupdf
    + hidden_ocr
    + hidden_ort
    # uvicorn internals (not auto-detected)
    + [
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        # fastapi
        "fastapi",
        "fastapi.middleware.cors",
        "fastapi.responses",
        # multipart (file uploads)
        "multipart",
        "python_multipart",
        # backend package
        "backend",
        "backend.main",
        "backend.models",
        "backend.models.schemas",
        "backend.services",
        "backend.services.parser",
        "backend.services.ocr",
        "backend.services.scanner",
        "backend.services.engines",
        "backend.services.llm",
        # misc
        "email_validator",
        "anyio",
        "anyio._backends._asyncio",
        "starlette",
        "starlette.middleware.cors",
        "pydantic",
        "httpx",
        "openai",
    ]
)

# ── Analysis ─────────────────────────────────────────────────────────────────

a = Analysis(
    ["run_backend.py"],
    pathex=["."],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Keep size down — not needed for backend-only binary
        "tkinter",
        "matplotlib",
        "notebook",
        "IPython",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX can break native extensions; keep off
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,       # Keep console=True so uvicorn log output is visible for debugging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,   # None = current machine arch (set via env for cross-compile)
    codesign_identity=None,
    entitlements_file=None,
)
