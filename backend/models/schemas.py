from pydantic import BaseModel
from typing import Dict, List, Optional


class EntityGroup(BaseModel):
    type: str
    count: int
    examples: List[str]


class DetectedEntity(BaseModel):
    text: str
    entity_type: str
    start: int
    end: int
    # Persisted review state: False when the user chose to keep this span
    # visible. None (older sessions) means enabled.
    enabled: Optional[bool] = None


class OcrLine(BaseModel):
    """One OCR-detected text line of a scanned image: its bounding box in
    original image pixel coordinates and its character range in original_text."""
    text: str
    start: int
    end: int
    x0: float
    y0: float
    x1: float
    y1: float


class CustomArea(BaseModel):
    """A user-drawn redaction rectangle on an image, in original image pixel
    coordinates. Covers the region visually on export; any OCR text under it
    is also redacted from the text output."""
    x0: float
    y0: float
    x1: float
    y1: float


class ScanStartResponse(BaseModel):
    session_id: str
    status: str  # "processing"


class ScanStatusResponse(BaseModel):
    status: str  # "processing", "complete", "columns_detected", "error"
    progress: int  # 0-100
    message: str
    # Only present when status == "complete"
    original_text: Optional[str] = None
    redacted_text: Optional[str] = None
    entities: Optional[List[EntityGroup]] = None
    total_entities: Optional[int] = None
    page_count: Optional[int] = None
    session_id: Optional[str] = None
    replacement_map: Optional[Dict[str, str]] = None
    detected_entities: Optional[List[DetectedEntity]] = None
    # User-added manual redactions (persisted so edits survive reloads)
    custom_texts: Optional[List[str]] = None
    # Only present for image scans: OCR line boxes for the image review overlay
    ocr_lines: Optional[List[OcrLine]] = None
    # User-drawn area redactions on images (persisted like custom_texts)
    custom_areas: Optional[List[CustomArea]] = None
    # Only present when status == "columns_detected" (CSV/XLSX)
    columns: Optional[List[str]] = None
    # Only present when status == "error"
    error: Optional[str] = None


class ColumnRedactRequest(BaseModel):
    columns: List[str]


class UpdateRedactionRequest(BaseModel):
    included_indices: List[int]
    custom_texts: List[str] = []
    custom_areas: List[CustomArea] = []


class ChatRequest(BaseModel):
    session_ids: List[str]
    chat_id: str
    message: str
    model: Optional[str] = None
    provider: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    redacted_response: str


class HealthResponse(BaseModel):
    status: str


class SettingsRequest(BaseModel):
    provider: str
    api_key: str

class ModelSelectRequest(BaseModel):
    model: str
    provider: Optional[str] = None


class CustomEndpointRequest(BaseModel):
    base_url: str
    api_key: Optional[str] = None


class EngineSelectRequest(BaseModel):
    kind: str                       # "gliner" | "hf_token" | "regex"
    model_id: str = ""              # HF Hub repo id (empty for regex)


class RegexBoostRequest(BaseModel):
    enabled: bool

class ThresholdRequest(BaseModel):
    threshold: float

class IgnorePronounsRequest(BaseModel):
    ignore: bool

class RemoveKeyRequest(BaseModel):
    provider: str


class SavedSessionSummary(BaseModel):
    session_id: str
    filename: str
    total_entities: int
    page_count: int
    scanned_at: str  # ISO timestamp


class PIILabel(BaseModel):
    label: str           # human-readable GLiNER label (e.g. "phone number")
    entity_type: str     # placeholder entity type (e.g. "PHONE_NUMBER")
    enabled: bool
    custom: bool = False # True if user-defined, False for built-in labels


class PIILabelsUpdate(BaseModel):
    labels: List[str]    # list of enabled label names


class CustomPIILabelRequest(BaseModel):
    label: str                          # e.g. "enrollment number"
    entity_type: Optional[str] = None   # e.g. "ENROLLMENT_NUMBER" (auto-derived if omitted)
