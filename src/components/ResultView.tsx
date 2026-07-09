import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Download, Copy, Check, MessageSquare,
  Home, FileText, FileType2, Loader2, ArrowRight, ArrowLeft, ClipboardCheck,
} from 'lucide-react';
import { useAppStore, canReviewBatch } from '../stores/appStore';
import { updateRedaction, getPdfExportUrl, getImageExportUrl } from '../services/api';
import { saveBytes, saveText } from '../lib/saveFile';
import RedactedText from './RedactedText';
import ReviewPdfViewer from './ReviewPdfViewer';
import ReviewDocxViewer from './ReviewDocxViewer';
import ReviewImageViewer from './ReviewImageViewer';
import DocumentViewer from './DocumentViewer';
import { IMAGE_EXTENSIONS } from '../lib/fileTypes';

const ENTITY_LABELS: Record<string, string> = {
  PERSON: 'Person', EMAIL_ADDRESS: 'Email', PHONE_NUMBER: 'Phone',
  LOCATION: 'Address', CREDIT_CARD: 'Credit Card', US_SSN: 'SSN',
  DATE_OF_BIRTH: 'Date of Birth', PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License", IP_ADDRESS: 'IP Address',
  URL: 'URL', BANK_ACCOUNT: 'Bank Account', MEDICAL_RECORD: 'Medical Record',
  ORGANIZATION: 'Organization', INSURANCE_ID: 'Insurance',
  ROUTING_NUMBER: 'Routing Number', TAX_ID: 'Tax ID',
  NATIONAL_ID: 'National ID', VEHICLE_REG: 'Vehicle Reg.',
  USERNAME: 'Username', PASSWORD: 'Password', CUSTOM: 'Custom',
};

interface ResultViewProps {
  onOpenChat: () => void;
  onDone: () => void;
  /** Batch mode: show another file of the batch. */
  onNavigate: (index: number) => void;
  /** Batch mode: open the final review-all screen. */
  onReviewAll: () => void;
}

/**
 * The single human-in-the-loop surface: the scanned document with every
 * detection highlighted and directly editable — click a highlight to toggle
 * it, select any text to redact it. Changes auto-apply; no separate
 * review/confirm step.
 */
export default function ResultView({ onOpenChat, onDone, onNavigate, onReviewAll }: ResultViewProps) {
  const {
    pendingScanResult, scanningFileName,
    toggleDetectedEntityIndices, addCustomEntity,
    addCustomArea, removeCustomArea,
    batch, batchIndex,
  } = useAppStore();
  const [copied, setCopied] = useState(false);
  const [savedFile, setSavedFile] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const detected = pendingScanResult?.detected_entities;
  const customAreas = pendingScanResult?.custom_areas;
  const editable = !!(detected && detected.length > 0);

  // Multi-file batch: files verify one by one, then the whole batch is
  // reviewed and saved at once on the review screen.
  const batchMode = batch.length > 0;
  const hasNext = batchMode && batchIndex < batch.length - 1;
  const hasPrev = batchMode && batchIndex > 0;
  const canReview = batchMode && canReviewBatch(batch);

  const lowerName = scanningFileName.toLowerCase();
  const isPdf = lowerName.endsWith('.pdf');
  const isDocx = lowerName.endsWith('.docx');
  const isImage = IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasDocPreview = isPdf || isDocx || isImage;
  const [viewMode, setViewMode] = useState<'document' | 'text'>(hasDocPreview ? 'document' : 'text');

  // Navigating between batch files swaps the whole document under this view —
  // reset the preview mode to whatever suits the incoming file type.
  useEffect(() => {
    setViewMode(hasDocPreview ? 'document' : 'text');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanningFileName]);

  // ── Auto-apply: whenever the user toggles a highlight or adds a custom
  // redaction, push the new span set to the backend (debounced) so the
  // redacted text, export and replacement map stay current. When the shown
  // document changes (batch navigation), the effect just re-arms for the new
  // session instead of writing one file's spans to another's.
  const lastSessionRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runApply = async (result: import('../types').ScanResult) => {
    setApplying(true);
    setApplyError('');
    try {
      const included: number[] = [];
      const custom: string[] = [];
      (result.detected_entities ?? []).forEach((e, i) => {
        if (!e.enabled) return;
        if (e.is_custom) custom.push(e.text);
        else included.push(i);
      });
      const updated = await updateRedaction(result.session_id, included, custom, result.custom_areas ?? []);
      // Route to wherever this session lives now (the user may have
      // navigated to another batch file while the request was in flight),
      // keeping the freshest toggle list.
      useAppStore.getState().applyUpdatedResult(result.session_id, updated);
      dirtyRef.current = false;
    } catch (err: any) {
      setApplyError(err?.message || 'Failed to apply changes');
    } finally {
      setApplying(false);
    }
  };

  /** Push any not-yet-applied edits immediately — called before exporting or
   * leaving this file, so the debounce window can't drop the final toggles. */
  const flushPendingApply = async () => {
    if (!dirtyRef.current) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const result = useAppStore.getState().pendingScanResult;
    if (result) await runApply(result);
  };

  useEffect(() => {
    const sid = pendingScanResult?.session_id ?? null;
    if (!sid) return;
    if (lastSessionRef.current !== sid) { lastSessionRef.current = sid; return; }
    // Areas can exist without any auto-detected spans (e.g. a photo-only image)
    if (!detected && !customAreas?.length) return;
    dirtyRef.current = true;
    const timer = setTimeout(() => {
      const result = useAppStore.getState().pendingScanResult;
      if (result?.session_id === sid) runApply(result);
    }, 500);
    timerRef.current = timer;
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, customAreas]);

  const enabledCount = useMemo(() => (detected || []).filter((e) => e.enabled).length, [detected]);
  const totalCount = detected?.length ?? 0;

  const previewDocument = useMemo(() => {
    if (!pendingScanResult) return null;
    return {
      sessionId: pendingScanResult.session_id,
      fileName: scanningFileName,
      scanResult: pendingScanResult,
    };
  }, [pendingScanResult, scanningFileName]);

  if (!pendingScanResult) return null;
  const result = pendingScanResult;
  const baseName = scanningFileName.replace(/\.[^.]+$/, '') || 'document';

  /** Leave this file (batch navigation / review screen) with edits applied. */
  const handleLeaveTo = async (go: () => void) => {
    await flushPendingApply();
    go();
  };

  const handleCopy = async () => {
    try {
      await flushPendingApply();
      const latest = useAppStore.getState().pendingScanResult ?? result;
      await navigator.clipboard.writeText(latest.redacted_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const handleSave = async () => {
    setSaveError('');
    try {
      await flushPendingApply();
      const latest = useAppStore.getState().pendingScanResult ?? result;
      const ok = await saveText(latest.redacted_text, `${baseName}_redacted.txt`, 'txt', 'text/plain');
      if (!ok) return;
      setSavedFile(true);
      setTimeout(() => setSavedFile(false), 1800);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save the file');
    }
  };

  const handleExportPdf = async () => {
    setSaveError('');
    try {
      await flushPendingApply();
      const resp = await fetch(getPdfExportUrl(result.session_id));
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'PDF export failed' }));
        throw new Error(err.detail || 'PDF export failed');
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ok = await saveBytes(bytes, `${baseName}_redacted.pdf`, 'pdf', 'application/pdf');
      if (!ok) return;
      setSavedFile(true);
      setTimeout(() => setSavedFile(false), 1800);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not export the PDF');
    }
  };

  const handleExportImage = async () => {
    setSaveError('');
    try {
      await flushPendingApply();
      const resp = await fetch(getImageExportUrl(result.session_id));
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Image export failed' }));
        throw new Error(err.detail || 'Image export failed');
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ok = await saveBytes(bytes, `${baseName}_redacted.png`, 'png', 'image/png');
      if (!ok) return;
      setSavedFile(true);
      setTimeout(() => setSavedFile(false), 1800);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not export the image');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed inset-0 flex flex-col pt-6 pb-6 px-6 gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
            {applying
              ? <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
              : <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
            <span className="text-xs font-medium text-emerald-400">{applying ? 'Applying…' : 'Redacted'}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {batchMode && (
                <span className="text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                  File {batchIndex + 1} of {batch.length}
                </span>
              )}
              <h2 className="text-lg font-bold text-white leading-tight truncate">{scanningFileName || 'Document'}</h2>
            </div>
            <p className="text-xs text-slate-400 truncate">
              {editable
                ? <>{enabledCount} / {totalCount} redacted · click a highlight to toggle · {isImage ? 'add custom redactions in Text view' : 'select text to redact it'}</>
                : <>Redacted copy — originals never left this Mac</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy text'}
          </button>
          {(isPdf || isImage) && (
            <button onClick={handleSave} disabled={applying}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white disabled:opacity-50">
              <FileText className="w-3.5 h-3.5" /> Export .txt
            </button>
          )}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={isPdf ? handleExportPdf : isImage ? handleExportImage : handleSave} disabled={applying}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-xs font-semibold hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50">
            {savedFile ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            {savedFile ? 'Saved' : isPdf ? 'Export redacted PDF' : isImage ? 'Export redacted image' : 'Export redacted .txt'}
          </motion.button>
        </div>
      </div>

      {(saveError || applyError) && (
        <div className="flex-shrink-0 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          {saveError || applyError}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Entity summary */}
        <div className="w-60 flex-shrink-0 flex flex-col gap-2 overflow-y-auto pr-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-1">What was redacted</p>
          {result.entities.length === 0 && (
            <div className="px-3 py-3 rounded-xl bg-slate-900/60 border border-slate-800/40 text-xs text-slate-400">
              Nothing is currently redacted.
            </div>
          )}
          {result.entities.map((group) => (
            <div key={group.type} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800/40">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-sm text-white truncate">{ENTITY_LABELS[group.type] || group.type}</span>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex-shrink-0">{group.count}</span>
            </div>
          ))}
          <div className="mt-2 px-3 py-3 rounded-xl bg-slate-900/40 border border-slate-800/30">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {editable
                ? 'Changes apply automatically. The redacted copy is safe to paste into any AI tool — originals never leave this Mac.'
                : 'The redacted copy is safe to paste into any AI tool or share — originals never left this Mac.'}
            </p>
          </div>
        </div>

        {/* Document (interactive) / text preview */}
        <div className="flex-1 min-w-0 rounded-2xl bg-slate-900/60 border border-slate-800/40 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800/50 bg-slate-900/80 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="text-xs text-slate-400 font-mono truncate">
                {viewMode === 'document' && hasDocPreview ? scanningFileName : `${baseName}_redacted.txt`}
              </span>
            </div>
            {hasDocPreview && (
              <div className="flex items-center rounded-lg bg-slate-800/80 border border-slate-700/40 p-0.5 flex-shrink-0">
                <button
                  onClick={() => setViewMode('document')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    viewMode === 'document' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileType2 className="w-3 h-3" /> Document
                </button>
                <button
                  onClick={() => setViewMode('text')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    viewMode === 'text' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3 h-3" /> Text
                </button>
              </div>
            )}
          </div>

          {viewMode === 'document' && hasDocPreview ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              {isImage ? (
                <ReviewImageViewer
                  sessionId={result.session_id}
                  detectedEntities={detected ?? []}
                  ocrLines={result.ocr_lines ?? []}
                  customAreas={customAreas ?? []}
                  onToggleIndices={toggleDetectedEntityIndices}
                  onAddArea={addCustomArea}
                  onRemoveArea={removeCustomArea}
                />
              ) : editable && isPdf ? (
                <ReviewPdfViewer
                  sessionId={result.session_id}
                  detectedEntities={detected!}
                  onToggleIndices={toggleDetectedEntityIndices}
                  onAddCustom={addCustomEntity}
                />
              ) : editable && isDocx ? (
                <ReviewDocxViewer
                  sessionId={result.session_id}
                  detectedEntities={detected!}
                  onToggleIndices={toggleDetectedEntityIndices}
                  onAddCustom={addCustomEntity}
                />
              ) : previewDocument ? (
                // Older sessions without saved spans: read-only preview
                <DocumentViewer document={previewDocument} hideHeader />
              ) : null}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              <RedactedText text={result.redacted_text} replacementMap={result.replacement_map} />
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between flex-shrink-0">
        <button onClick={onDone}
          title={batchMode ? 'Abandons the rest of this batch' : undefined}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-sm text-slate-300 hover:text-white">
          <Home className="w-4 h-4" /> Done
        </button>
        {batchMode ? (
          <div className="flex items-center gap-2">
            {hasPrev && (
              <button onClick={() => handleLeaveTo(() => onNavigate(batchIndex - 1))}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-sm text-slate-300 hover:text-white">
                <ArrowLeft className="w-4 h-4" /> Previous file
              </button>
            )}
            {canReview && (
              <button onClick={() => handleLeaveTo(onReviewAll)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl transition-colors text-sm font-medium ${
                  hasNext
                    ? 'bg-slate-800/60 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-slate-800 text-emerald-400'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                }`}>
                <ClipboardCheck className="w-4 h-4" /> Review all files
              </button>
            )}
            {hasNext && (
              <button onClick={() => handleLeaveTo(() => onNavigate(batchIndex + 1))} disabled={applying}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-sm font-medium text-white disabled:opacity-50">
                Next file
                <span className="text-emerald-100/80 font-normal">
                  {batch[batchIndex + 1].status === 'ready' || batch[batchIndex + 1].status === 'error' ? '' : '(scanning…)'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {!hasNext && !canReview && (
              <span className="text-xs text-slate-500">Review each remaining file to finish the batch</span>
            )}
          </div>
        ) : (
          <button onClick={() => handleLeaveTo(onOpenChat)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-slate-800 transition-colors text-sm text-emerald-400">
            <MessageSquare className="w-4 h-4" />
            Ask AI about this document
          </button>
        )}
      </div>
    </motion.div>
  );
}
