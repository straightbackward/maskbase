import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, FolderDown, Check, MessageSquare, Home, FileText,
  AlertTriangle, Pencil, Loader2, ClipboardCheck,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { BatchFile } from '../types';
import { buildRedactedExport } from '../lib/exportRedacted';
import { pickFolder, saveIntoFolder, isTauri } from '../lib/saveFile';
import { IMAGE_EXTENSIONS } from '../lib/fileTypes';

interface BatchReviewViewProps {
  /** Jump back into a file's redaction review to edit it. */
  onEditFile: (index: number) => void;
  onOpenChat: () => void;
  onDone: () => void;
}

type SaveState = 'saving' | 'saved' | string; // string = error message

function exportLabel(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'redacted PDF';
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'redacted PNG';
  return 'redacted .txt';
}

function redactionSummary(file: BatchFile): string {
  const detected = file.result?.detected_entities;
  if (detected && detected.length > 0) {
    const enabled = detected.filter((e) => e.enabled).length;
    return `${enabled} of ${detected.length} detections redacted`;
  }
  const total = file.result?.total_entities ?? 0;
  return `${total} entit${total === 1 ? 'y' : 'ies'} redacted`;
}

/**
 * Final step of a multi-file batch: every file has been verified one by one;
 * this screen shows them all together so the user can jump back to edit any
 * of them, then save every redacted copy at once into a single folder.
 */
export default function BatchReviewView({ onEditFile, onOpenChat, onDone }: BatchReviewViewProps) {
  const { batch } = useAppStore();
  const [saveStates, setSaveStates] = useState<Record<number, SaveState>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const readyFiles = useMemo(
    () => batch.map((file, index) => ({ file, index })).filter(({ file }) => file.status === 'ready' && file.result),
    [batch]
  );
  const failedCount = batch.length - readyFiles.length;
  const allSaved = readyFiles.length > 0 && readyFiles.every(({ index }) => saveStates[index] === 'saved');

  const handleSaveAll = async () => {
    if (readyFiles.length === 0) return;
    setSaveError('');

    // One folder for the whole batch — a save dialog per file would defeat
    // the point of batch saving. In a plain browser each file just downloads.
    let dir: string | null = null;
    if (isTauri()) {
      try {
        dir = await pickFolder();
      } catch (err: any) {
        setSaveError(err?.message || 'Could not open the folder picker');
        return;
      }
      if (!dir) return; // user cancelled
    }

    setSaving(true);
    for (const { file, index } of readyFiles) {
      setSaveStates((prev) => ({ ...prev, [index]: 'saving' }));
      try {
        const payload = await buildRedactedExport(file.fileName, file.result!);
        await saveIntoFolder(dir, payload.filename, payload.data, payload.mime);
        setSaveStates((prev) => ({ ...prev, [index]: 'saved' }));
      } catch (err: any) {
        setSaveStates((prev) => ({ ...prev, [index]: err?.message || 'Save failed' }));
      }
    }
    setSaving(false);
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
            <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">Batch review</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white leading-tight">
              {readyFiles.length} redacted file{readyFiles.length === 1 ? '' : 's'} ready to save
            </h2>
            <p className="text-xs text-slate-400">
              Everything below has been reviewed — edit any file, or save all redacted copies at once.
              {failedCount > 0 && ` ${failedCount} file${failedCount === 1 ? '' : 's'} failed to scan and will be skipped.`}
            </p>
          </div>
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={handleSaveAll} disabled={saving || readyFiles.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-xs font-semibold hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex-shrink-0">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : allSaved ? <Check className="w-3.5 h-3.5" /> : <FolderDown className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : allSaved ? 'All saved' : 'Save all to folder…'}
        </motion.button>
      </div>

      {saveError && (
        <div className="flex-shrink-0 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          {saveError}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-2">
          {batch.map((file, index) => {
            const failed = file.status !== 'ready' || !file.result;
            const state = saveStates[index];
            return (
              <div key={index}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                  failed ? 'bg-slate-900/40 border-red-500/20' : 'bg-slate-900/60 border-slate-800/40'
                }`}>
                <div className="w-9 h-9 rounded-lg bg-slate-800/80 border border-slate-700/50 flex items-center justify-center flex-shrink-0">
                  {failed
                    ? <AlertTriangle className="w-4 h-4 text-red-400" />
                    : <FileText className="w-4 h-4 text-emerald-400/80" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{file.fileName}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {failed
                      ? (file.error || 'Failed to scan')
                      : <>
                          <ShieldCheck className="w-3 h-3 text-emerald-400/80 inline mr-1 -mt-0.5" />
                          {redactionSummary(file)} · saves as {exportLabel(file.fileName)}
                        </>}
                  </p>
                </div>
                {/* Per-file save outcome */}
                {state === 'saved' && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 flex-shrink-0">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
                {state === 'saving' && <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin flex-shrink-0" />}
                {state && state !== 'saved' && state !== 'saving' && (
                  <span className="text-[11px] text-red-300 max-w-[180px] truncate flex-shrink-0" title={state}>{state}</span>
                )}
                {!failed && (
                  <button onClick={() => onEditFile(index)} disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white flex-shrink-0 disabled:opacity-50">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between flex-shrink-0">
        <button onClick={onDone}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-sm text-slate-300 hover:text-white">
          <Home className="w-4 h-4" /> Done
        </button>
        {readyFiles.length > 0 && (
          <button onClick={onOpenChat}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-slate-800 transition-colors text-sm text-emerald-400">
            <MessageSquare className="w-4 h-4" />
            Ask AI about {readyFiles.length === 1 ? 'this document' : `these ${readyFiles.length} documents`}
          </button>
        )}
      </div>
    </motion.div>
  );
}
