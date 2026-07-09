import { create } from 'zustand';
import { AppStage, BatchFile, ScanResult, ChatDocument, DetectedEntity, CustomArea } from '../types';

function generateChatId(): string {
  return crypto.randomUUID();
}

interface AppState {
  stage: AppStage;
  backendReady: boolean;
  showInfo: boolean;
  error: string | null;
  apiKeySet: boolean;
  currentModel: string;
  currentProvider: string;

  updateAvailable: boolean;
  latestVersion: string;
  updateDownloadUrl: string;
  updateDismissed: boolean;

  chatId: string;
  documents: ChatDocument[];

  scanningFileName: string;
  scanProgress: number;
  scanStatus: string;
  pendingScanResult: ScanResult | null;
  selectedColumns: string[];

  /** Multi-file upload batch (empty = single-file flow). */
  batch: BatchFile[];
  /** Index of the batch file currently shown. */
  batchIndex: number;

  setStage: (stage: AppStage) => void;
  setBackendReady: (ready: boolean) => void;
  setShowInfo: (show: boolean) => void;
  setError: (error: string | null) => void;
  setApiKeySet: (set: boolean) => void;
  setCurrentModel: (model: string) => void;
  setCurrentProvider: (provider: string) => void;

  setUpdateAvailable: (version: string, downloadUrl: string) => void;
  dismissUpdate: () => void;

  newChat: () => void;
  setChatId: (id: string) => void;
  addDocument: (doc: ChatDocument) => void;
  setDocuments: (docs: ChatDocument[]) => void;

  startBatch: (fileNames: string[]) => void;
  updateBatchItem: (index: number, patch: Partial<BatchFile>) => void;
  setBatchIndex: (index: number) => void;
  /** Persist the in-progress edits (pendingScanResult) back into the batch
   * item they belong to, marking it as reviewed. */
  syncPendingToBatch: () => void;
  /** Route a freshly applied redaction result to wherever its session lives
   * now (the pending doc, or a batch item the user navigated away from). */
  applyUpdatedResult: (sessionId: string, updated: ScanResult) => void;
  clearBatch: () => void;

  startScanning: (fileName: string) => void;
  setScanProgress: (progress: number) => void;
  setScanStatus: (status: string) => void;
  setPendingScanResult: (result: ScanResult) => void;
  setScanningFileName: (name: string) => void;
  clearPending: () => void;
  confirmScan: () => void;
  toggleEntity: (index: number) => void;
  toggleColumn: (column: string) => void;
  toggleDetectedEntity: (index: number) => void;
  toggleDetectedEntityType: (entityType: string) => void;
  toggleDetectedEntityIndices: (indices: number[]) => void;
  addCustomEntity: (text: string) => void;
  addCustomArea: (area: CustomArea) => void;
  removeCustomArea: (index: number) => void;

  reset: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  stage: 'idle',
  backendReady: false,
  showInfo: false,
  error: null,
  apiKeySet: false,
  currentModel: '',
  currentProvider: '',

  updateAvailable: false,
  latestVersion: '',
  updateDownloadUrl: '',
  updateDismissed: false,

  chatId: generateChatId(),
  documents: [],

  scanningFileName: '',
  scanProgress: 0,
  scanStatus: '',
  pendingScanResult: null,
  selectedColumns: [],

  batch: [],
  batchIndex: 0,

  setStage: (stage) => set({ stage }),
  setBackendReady: (ready) => set({ backendReady: ready }),
  setShowInfo: (show) => set({ showInfo: show }),
  setError: (error) => set({ error }),
  setApiKeySet: (apiKeySet) => set({ apiKeySet }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setCurrentProvider: (currentProvider) => set({ currentProvider }),

  setUpdateAvailable: (version, downloadUrl) => set({ updateAvailable: true, latestVersion: version, updateDownloadUrl: downloadUrl, updateDismissed: false }),
  dismissUpdate: () => set({ updateDismissed: true }),

  newChat: () =>
    set({
      chatId: generateChatId(),
      documents: [],
      scanningFileName: '',
      scanProgress: 0,
      scanStatus: '',
      pendingScanResult: null,
      selectedColumns: [],
      batch: [],
      batchIndex: 0,
      error: null,
    }),

  setChatId: (id) => set({ chatId: id }),

  startBatch: (fileNames) =>
    set({
      batch: fileNames.map((fileName) => ({
        fileName,
        status: 'pending' as const,
        progress: 0,
        statusMessage: 'Waiting…',
        result: null,
        error: null,
        viewed: false,
        needsColumnPick: false,
      })),
      batchIndex: 0,
      pendingScanResult: null,
      selectedColumns: [],
    }),

  updateBatchItem: (index, patch) =>
    set((state) => {
      if (!state.batch[index]) return state;
      const batch = [...state.batch];
      batch[index] = { ...batch[index], ...patch };
      return { batch };
    }),

  setBatchIndex: (index) => set({ batchIndex: index, selectedColumns: [] }),

  syncPendingToBatch: () =>
    set((state) => {
      const { pendingScanResult, batch, batchIndex } = state;
      const item = batch[batchIndex];
      if (!pendingScanResult || !item?.result) return state;
      if (item.result.session_id !== pendingScanResult.session_id) return state;
      const updated = [...batch];
      updated[batchIndex] = { ...item, result: pendingScanResult, viewed: true };
      return { batch: updated };
    }),

  applyUpdatedResult: (sessionId, updated) =>
    set((state) => {
      // Preserve the freshest review state (toggles / custom areas) — the
      // user may have kept editing while the request was in flight.
      const merge = (current: ScanResult | null | undefined): ScanResult => ({
        ...updated,
        detected_entities: current?.detected_entities ?? updated.detected_entities,
        custom_areas: current?.custom_areas ?? updated.custom_areas,
      });
      if (state.pendingScanResult?.session_id === sessionId) {
        return { pendingScanResult: merge(state.pendingScanResult) };
      }
      const idx = state.batch.findIndex((b) => b.result?.session_id === sessionId);
      if (idx < 0) return state;
      const batch = [...state.batch];
      batch[idx] = { ...batch[idx], result: merge(batch[idx].result) };
      return { batch };
    }),

  clearBatch: () => set({ batch: [], batchIndex: 0 }),

  addDocument: (doc) =>
    set((state) => ({ documents: [...state.documents, doc] })),

  setDocuments: (docs) => set({ documents: docs }),

  startScanning: (fileName) =>
    set({ scanningFileName: fileName, scanProgress: 0, scanStatus: 'Uploading document…', pendingScanResult: null, selectedColumns: [] }),

  setScanProgress: (progress) => set({ scanProgress: progress }),
  setScanStatus: (status) => set({ scanStatus: status }),
  setPendingScanResult: (result) => set({ pendingScanResult: result }),
  setScanningFileName: (name) => set({ scanningFileName: name }),

  clearPending: () =>
    set({ pendingScanResult: null, scanningFileName: '', scanProgress: 0, scanStatus: '', selectedColumns: [] }),

  confirmScan: () => {
    const { pendingScanResult, scanningFileName } = get();
    if (!pendingScanResult) return;
    set((state) => ({
      documents: [
        ...state.documents,
        { sessionId: pendingScanResult.session_id, fileName: scanningFileName, scanResult: pendingScanResult },
      ],
      pendingScanResult: null,
      scanningFileName: '',
      scanProgress: 0,
      scanStatus: '',
    }));
  },

  toggleEntity: (index) =>
    set((state) => {
      if (!state.pendingScanResult) return state;
      const entities = [...state.pendingScanResult.entities];
      entities[index] = { ...entities[index], enabled: !entities[index].enabled };
      return { pendingScanResult: { ...state.pendingScanResult, entities } };
    }),

  toggleColumn: (column) =>
    set((state) => {
      const cols = state.selectedColumns.includes(column)
        ? state.selectedColumns.filter((c) => c !== column)
        : [...state.selectedColumns, column];
      return { selectedColumns: cols };
    }),

  toggleDetectedEntity: (index) =>
    set((state) => {
      if (!state.pendingScanResult?.detected_entities) return state;
      const detected = [...state.pendingScanResult.detected_entities];
      detected[index] = { ...detected[index], enabled: !detected[index].enabled };
      return { pendingScanResult: { ...state.pendingScanResult, detected_entities: detected } };
    }),

  toggleDetectedEntityType: (entityType) =>
    set((state) => {
      if (!state.pendingScanResult?.detected_entities) return state;
      const detected = state.pendingScanResult.detected_entities;
      const ofType = detected.filter((e) => e.entity_type === entityType);
      const allEnabled = ofType.every((e) => e.enabled);
      const updated = detected.map((e) =>
        e.entity_type === entityType ? { ...e, enabled: !allEnabled } : e
      );
      return { pendingScanResult: { ...state.pendingScanResult, detected_entities: updated } };
    }),

  toggleDetectedEntityIndices: (indices) =>
    set((state) => {
      if (!state.pendingScanResult?.detected_entities) return state;
      const detected = state.pendingScanResult.detected_entities;
      const targets = new Set(indices);
      const anyEnabled = indices.some((i) => detected[i]?.enabled);
      const target = !anyEnabled;
      const updated = detected.map((e, i) =>
        targets.has(i) ? { ...e, enabled: target } : e
      );
      return { pendingScanResult: { ...state.pendingScanResult, detected_entities: updated } };
    }),

  addCustomEntity: (rawText) =>
    set((state) => {
      if (!state.pendingScanResult) return state;
      const text = rawText.replace(/\s+/g, ' ').trim();
      if (text.length < 2) return state;
      const detected = state.pendingScanResult.detected_entities ?? [];
      // Re-enable an existing custom entity with the same text instead of duplicating.
      const existing = detected.findIndex((e) => e.is_custom && e.text === text);
      if (existing >= 0) {
        if (detected[existing].enabled) return state;
        const updated = detected.map((e, i) => (i === existing ? { ...e, enabled: true } : e));
        return { pendingScanResult: { ...state.pendingScanResult, detected_entities: updated } };
      }
      const entry: DetectedEntity = {
        text,
        entity_type: 'CUSTOM',
        start: -1,
        end: -1,
        enabled: true,
        is_custom: true,
      };
      return {
        pendingScanResult: {
          ...state.pendingScanResult,
          detected_entities: [...detected, entry],
        },
      };
    }),

  addCustomArea: (area) =>
    set((state) => {
      if (!state.pendingScanResult) return state;
      const areas = [...(state.pendingScanResult.custom_areas ?? []), area];
      return { pendingScanResult: { ...state.pendingScanResult, custom_areas: areas } };
    }),

  removeCustomArea: (index) =>
    set((state) => {
      if (!state.pendingScanResult?.custom_areas) return state;
      const areas = state.pendingScanResult.custom_areas.filter((_, i) => i !== index);
      return { pendingScanResult: { ...state.pendingScanResult, custom_areas: areas } };
    }),

  reset: () =>
    set({
      chatId: generateChatId(),
      documents: [],
      scanningFileName: '',
      scanProgress: 0,
      scanStatus: '',
      pendingScanResult: null,
      selectedColumns: [],
      batch: [],
      batchIndex: 0,
      error: null,
    }),
}));

/** All files are accounted for and every readable one has been reviewed —
 * the batch is ready for the final review-and-save screen. */
export function canReviewBatch(batch: BatchFile[]): boolean {
  return (
    batch.length > 0 &&
    batch.every(
      (b) => b.status === 'error' || (b.status === 'ready' && b.viewed && !b.needsColumnPick)
    )
  );
}
