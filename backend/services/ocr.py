"""OCR service — extracts text from images and scanned PDF pages.

Uses RapidOCR (ONNX runtime) so everything stays on-device: no cloud OCR API
and no system binary (e.g. tesseract) is needed. The ONNX models are fetched
once into the package's model directory (the packaged app ships them via
PyInstaller datas), after which OCR runs fully offline.
"""

import threading

_engine = None
_lock = threading.Lock()


def _get_engine():
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                from rapidocr import RapidOCR

                _engine = RapidOCR()
    return _engine


def ocr_image_lines(data: bytes) -> list:
    """Run OCR on encoded image bytes (PNG/JPEG/…) and return the detected
    lines in reading order, each with its bounding box in original image
    pixel coordinates: {"text", "x0", "y0", "x1", "y1"}."""
    result = _get_engine()(data)
    if result is None or not result.txts:
        return []
    lines = []
    for text, box in zip(result.txts, result.boxes):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append(
            {"text": text, "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}
        )
    return lines


def ocr_image_bytes(data: bytes) -> str:
    """Run OCR on encoded image bytes (PNG/JPEG/…) and return the text,
    one detected line per output line, in reading order."""
    return "\n".join(line["text"] for line in ocr_image_lines(data))


def ocr_image_file(file_path: str) -> str:
    """Run OCR on an image file on disk."""
    with open(file_path, "rb") as f:
        return ocr_image_bytes(f.read())
