#!/usr/bin/env python3
"""
PyInstaller entry point for the MaskBase backend.
This file is the root script compiled into a standalone binary.
"""
import multiprocessing
import sys


def main() -> None:
    import uvicorn
    from backend.main import app  # noqa: WPS433 – intentional late import for frozen env

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=22140,
        log_level="warning",
    )


if __name__ == "__main__":
    # Required so PyInstaller-frozen binaries work correctly on all platforms
    multiprocessing.freeze_support()
    main()





