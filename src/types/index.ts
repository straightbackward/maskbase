export interface DetectedEntity {
  text: string;
  entity_type: string;
  start: number;
  end: number;
  enabled: boolean;
  /** True when added by the user at the review step (not from the initial scan). */
  is_custom?: boolean;
}

/** One OCR-detected text line of a scanned image: bounding box in original
 * image pixel coordinates plus its character range in original_text. */
export interface OcrLine {
  text: string;
  start: number;
  end: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A user-drawn redaction rectangle on an image, in original image pixel
 * coordinates. Covered visually on export; OCR text under it is also
 * redacted from the text output. */
export interface CustomArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScanResult {
  original_text: string;
  redacted_text: string;
  entities: EntityGroup[];
  total_entities: number;
  page_count: number;
  session_id: string;
  columns?: string[];
  replacement_map?: Record<string, string>;
  detected_entities?: DetectedEntity[];
  /** Present for image scans — powers the image review overlay. */
  ocr_lines?: OcrLine[];
  /** User-drawn area redactions on an image. */
  custom_areas?: CustomArea[];
}

export interface EntityGroup {
  type: string;
  count: number;
  examples: string[];
  enabled: boolean;
}

export interface Message {
  role: 'user' | 'ai';
  text: string;
  deanonymizedText?: string;
  timestamp: number;
  attachment?: AttachedFile;
}

export interface AttachedFile {
  name: string;
  size: number;
  type: string;
}

export interface ChatResponse {
  response: string;
  redacted_response: string;
}

export interface HealthResponse {
  status: string;
  model_ready?: boolean;
}

export interface ChatDocument {
  sessionId: string;
  fileName: string;
  scanResult: ScanResult;
}

export interface SavedChat {
  chat_id: string;
  session_ids: string[];
  filenames: string[];
  created_at: string;
  updated_at: string;
}

export type AppStage = 'idle' | 'home' | 'scanning' | 'manifest' | 'result' | 'batch-review' | 'chat';

export type BatchFileStatus = 'pending' | 'scanning' | 'ready' | 'error';

/** One file of a multi-file upload. Files scan in the background while the
 * user reviews earlier ones; the whole batch is saved at once at the end. */
export interface BatchFile {
  fileName: string;
  status: BatchFileStatus;
  progress: number;
  statusMessage: string;
  result: ScanResult | null;
  error: string | null;
  /** The user has opened this file's redaction review at least once. */
  viewed: boolean;
  /** Tabular file still waiting for its column selection. */
  needsColumnPick: boolean;
}
