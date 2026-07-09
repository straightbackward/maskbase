import { ScanResult, ChatResponse, HealthResponse, SavedChat } from '../types';

const BASE_URL = 'http://127.0.0.1:22140';

export async function checkHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) throw new Error('Backend not available');
  return response.json();
}

interface ScanStartResponse {
  session_id: string;
  status: string;
}

interface ScanStatusResponse {
  status: string;
  progress: number;
  message: string;
  original_text?: string;
  redacted_text?: string;
  entities?: any[];
  total_entities?: number;
  page_count?: number;
  session_id?: string;
  columns?: string[];
  error?: string;
  replacement_map?: Record<string, string>;
  detected_entities?: Array<{ text: string; entity_type: string; start: number; end: number; enabled?: boolean | null }>;
  custom_texts?: string[];
  ocr_lines?: import('../types').OcrLine[];
}

/** Map backend spans to frontend entities, respecting persisted review state
 *  and re-attaching user-added custom redactions. */
function mapDetected(
  detected?: ScanStatusResponse['detected_entities'],
  customTexts?: string[],
): DetectedEntityWithState[] | undefined {
  if (!detected) return undefined;
  const spans: DetectedEntityWithState[] = detected.map((e) => ({
    ...e,
    enabled: e.enabled ?? true,
  }));
  for (const text of customTexts || []) {
    spans.push({ text, entity_type: 'CUSTOM', start: -1, end: -1, enabled: true, is_custom: true });
  }
  return spans;
}

interface DetectedEntityWithState {
  text: string;
  entity_type: string;
  start: number;
  end: number;
  enabled: boolean;
  is_custom?: boolean;
}

export async function startScan(file: File): Promise<ScanStartResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${BASE_URL}/scan`, { method: 'POST', body: formData });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Scan failed' }));
    throw new Error(error.detail || 'Scan failed');
  }
  return response.json();
}

export async function pollScanStatus(sessionId: string): Promise<ScanStatusResponse> {
  const response = await fetch(`${BASE_URL}/scan/${sessionId}/status`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Status check failed' }));
    throw new Error(error.detail || 'Status check failed');
  }
  return response.json();
}

export async function scanDocument(
  file: File,
  onProgress?: (progress: number, message: string) => void
): Promise<ScanResult> {
  const { session_id } = await startScan(file);
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    const status = await pollScanStatus(session_id);
    if (status.status === 'processing') { onProgress?.(status.progress, status.message); continue; }
    if (status.status === 'error') throw new Error(status.error || 'Scan failed');
    if (status.status === 'columns_detected') {
      onProgress?.(100, 'Select columns to redact');
      return {
        original_text: '',
        redacted_text: '',
        entities: [],
        total_entities: 0,
        page_count: 0,
        session_id: session_id,
        columns: status.columns || [],
      };
    }
    if (status.status === 'complete') {
      onProgress?.(100, 'Complete ✓');
      return {
        original_text: status.original_text!,
        redacted_text: status.redacted_text!,
        entities: (status.entities || []).map((e: any) => ({ ...e, enabled: true })),
        total_entities: status.total_entities!,
        page_count: status.page_count!,
        session_id: session_id,
        replacement_map: status.replacement_map,
        detected_entities: mapDetected(status.detected_entities, status.custom_texts),
        ocr_lines: status.ocr_lines || undefined,
      };
    }
  }
}

export async function submitColumnRedaction(
  sessionId: string,
  columns: string[]
): Promise<ScanResult> {
  const response = await fetch(`${BASE_URL}/scan/${sessionId}/redact-columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Column redaction failed' }));
    throw new Error(error.detail || 'Column redaction failed');
  }
  const data = await response.json();
  return {
    original_text: data.original_text!,
    redacted_text: data.redacted_text!,
    entities: (data.entities || []).map((e: any) => ({ ...e, enabled: true })),
    total_entities: data.total_entities!,
    page_count: data.page_count!,
    session_id: sessionId,
    replacement_map: data.replacement_map,
    detected_entities: data.detected_entities?.map((e: any) => ({ ...e, enabled: true })),
  };
}

export async function updateRedaction(
  sessionId: string,
  includedIndices: number[],
  customTexts: string[] = [],
  customAreas: import('../types').CustomArea[] = []
): Promise<ScanResult> {
  const response = await fetch(`${BASE_URL}/scan/${sessionId}/update-redaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ included_indices: includedIndices, custom_texts: customTexts, custom_areas: customAreas }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Update redaction failed' }));
    throw new Error(error.detail || 'Update redaction failed');
  }
  const data = await response.json();
  return {
    original_text: data.original_text!,
    redacted_text: data.redacted_text!,
    entities: (data.entities || []).map((e: any) => ({ ...e, enabled: true })),
    total_entities: data.total_entities!,
    page_count: data.page_count!,
    session_id: sessionId,
    replacement_map: data.replacement_map,
    detected_entities: mapDetected(data.detected_entities, data.custom_texts),
    ocr_lines: data.ocr_lines || undefined,
    custom_areas: data.custom_areas || undefined,
  };
}

export async function sendChatMessage(
  sessionIds: string[],
  chatId: string,
  message: string,
  model?: string,
  provider?: string
): Promise<ChatResponse> {
  const response = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_ids: sessionIds, chat_id: chatId, message, model: model || undefined, provider: provider || undefined }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Chat failed' }));
    throw new Error(error.detail || 'Chat failed');
  }
  return response.json();
}

// ── Sessions ─────────────────────────────────────────────────────────────

export interface SavedSession {
  session_id: string;
  filename: string;
  total_entities: number;
  page_count: number;
  scanned_at: string;
}

export async function listSessions(): Promise<SavedSession[]> {
  const response = await fetch(`${BASE_URL}/sessions`);
  if (!response.ok) return [];
  return response.json();
}

export function getDownloadUrl(sessionId: string): string {
  return `${BASE_URL}/sessions/${sessionId}/download`;
}

export function getPdfExportUrl(sessionId: string): string {
  return `${BASE_URL}/sessions/${sessionId}/export/pdf`;
}

export function getImageExportUrl(sessionId: string): string {
  return `${BASE_URL}/sessions/${sessionId}/export/image`;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function loadSession(sessionId: string): Promise<ScanResult> {
  const response = await fetch(`${BASE_URL}/sessions/${sessionId}/load`, { method: 'POST' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to load session' }));
    throw new Error(error.detail || 'Failed to load session');
  }
  const data = await response.json();
  return {
    original_text: data.original_text!,
    redacted_text: data.redacted_text!,
    entities: (data.entities || []).map((e: any) => ({ ...e, enabled: true })),
    total_entities: data.total_entities!,
    page_count: data.page_count!,
    session_id: sessionId,
    replacement_map: data.replacement_map,
    detected_entities: mapDetected(data.detected_entities, data.custom_texts),
    ocr_lines: data.ocr_lines || undefined,
    custom_areas: data.custom_areas || undefined,
  };
}

// ── Chats ────────────────────────────────────────────────────────────────

export async function listChats(): Promise<SavedChat[]> {
  const response = await fetch(`${BASE_URL}/chats`);
  if (!response.ok) return [];
  return response.json();
}

export async function deleteChat(chatId: string): Promise<void> {
  await fetch(`${BASE_URL}/chats/${chatId}`, { method: 'DELETE' });
}

// ── PII Labels ───────────────────────────────────────────────────────────

export interface PIILabel {
  label: string;
  entity_type: string;
  enabled: boolean;
  custom?: boolean;
}

export async function getPIILabels(): Promise<PIILabel[]> {
  const response = await fetch(`${BASE_URL}/pii-labels`);
  if (!response.ok) return [];
  return response.json();
}

export async function updatePIILabels(enabledLabels: string[]): Promise<void> {
  await fetch(`${BASE_URL}/pii-labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels: enabledLabels }),
  });
}

export async function addCustomPIILabel(label: string, entityType?: string): Promise<PIILabel> {
  const response = await fetch(`${BASE_URL}/pii-labels/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, entity_type: entityType || null }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to add custom label' }));
    throw new Error(error.detail || 'Failed to add custom label');
  }
  return response.json();
}

export async function removeCustomPIILabel(label: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/pii-labels/custom/${encodeURIComponent(label)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to remove custom label' }));
    throw new Error(error.detail || 'Failed to remove custom label');
  }
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface ProviderKeyInfo {
  set: boolean;
  masked: string | null;
}

export interface LLMSettings {
  api_key_set: boolean;
  api_keys: Record<string, ProviderKeyInfo>;
  model: string;
  provider: string;
  threshold: number;
  ignore_pronouns: boolean;
  custom_base_url: string;
}

export async function getSettings(): Promise<LLMSettings> {
  const response = await fetch(`${BASE_URL}/settings`);
  if (!response.ok) return { api_key_set: false, api_keys: {}, model: 'gpt-5', provider: 'openai', threshold: 0.75, ignore_pronouns: true, custom_base_url: '' };
  return response.json();
}

export interface ProviderInfo {
  id: string;
  label: string;
  models: string[];
  requires_key: boolean;
  key_set: boolean;
  key_masked: string | null;
  available: boolean;
  base_url: string;
}

export interface ProviderCatalog {
  providers: ProviderInfo[];
  model: string;
  provider: string;
}

export async function getProviders(): Promise<ProviderCatalog> {
  const response = await fetch(`${BASE_URL}/providers`);
  if (!response.ok) return { providers: [], model: '', provider: '' };
  return response.json();
}

export async function setCustomEndpoint(baseUrl: string, apiKey?: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings/custom-endpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey ?? null }),
  });
  if (!response.ok) throw new Error('Failed to save custom endpoint');
}

export async function setProviderKey(provider: string, apiKey: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!response.ok) throw new Error('Failed to save key');
}

export async function removeProviderKey(provider: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings/remove-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  if (!response.ok) throw new Error('Failed to remove key');
}

export async function setModel(model: string, provider?: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, provider: provider || undefined }),
  });
  if (!response.ok) throw new Error('Failed to set model');
}

export async function setThreshold(threshold: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings/threshold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold }),
  });
  if (!response.ok) throw new Error('Failed to set threshold');
}

export async function setIgnorePronouns(ignore: boolean): Promise<void> {
  const response = await fetch(`${BASE_URL}/settings/ignore-pronouns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignore }),
  });
  if (!response.ok) throw new Error('Failed to set ignore pronouns');
}

// ── PII Engines ──────────────────────────────────────────────────────────

export interface EngineInfo {
  id: string;
  kind: 'gliner' | 'hf_token' | 'regex';
  model_id: string;
  label: string;
  description: string;
  size: string;
  recommended: boolean;
  cached: boolean;
  active: boolean;
  zero_shot: boolean;
}

export interface EngineStatus {
  kind: string;
  model_id: string;
  state: 'not_loaded' | 'loading' | 'ready' | 'error';
  error: string | null;
  regex_boost: boolean;
}

export interface EngineCatalog {
  engines: EngineInfo[];
  status: EngineStatus;
}

export async function getEngines(): Promise<EngineCatalog> {
  const response = await fetch(`${BASE_URL}/engines`);
  if (!response.ok) return { engines: [], status: { kind: '', model_id: '', state: 'not_loaded', error: null, regex_boost: true } };
  return response.json();
}

export async function selectEngine(kind: string, modelId: string): Promise<EngineStatus> {
  const response = await fetch(`${BASE_URL}/engines/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, model_id: modelId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to select engine' }));
    throw new Error(error.detail || 'Failed to select engine');
  }
  return response.json();
}

export async function setRegexBoost(enabled: boolean): Promise<void> {
  await fetch(`${BASE_URL}/engines/regex-boost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}
