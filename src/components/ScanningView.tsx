import { motion } from 'framer-motion';
import {
  FileText, Eye, Zap, CheckCircle2, Loader2, AlertTriangle,
  ArrowLeft, ArrowRight, ClipboardCheck,
} from 'lucide-react';
import { useAppStore, canReviewBatch } from '../stores/appStore';
import { BatchFile } from '../types';

interface ScanningViewProps {
  /** Batch mode: jump to another file of the batch. */
  onNavigate?: (index: number) => void;
  /** Batch mode: open the final review-all screen. */
  onReviewAll?: () => void;
}

function BatchFileRow({ file, active, current }: { file: BatchFile; active: boolean; current: number }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-left ${active ? 'bg-slate-800/80 border border-slate-700/50' : ''}`}>
      {file.status === 'ready' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
      {file.status === 'scanning' && <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin flex-shrink-0" />}
      {file.status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
      {file.status === 'pending' && <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-slate-600" /></span>}
      <span className={`text-xs truncate ${active ? 'text-white' : 'text-slate-400'}`}>{file.fileName}</span>
      <span className="ml-auto text-[10px] text-slate-500 flex-shrink-0">
        {file.status === 'ready' ? (file.viewed ? 'reviewed' : 'ready') : file.status === 'scanning' ? `${file.progress}%` : file.status === 'error' ? 'failed' : `#${current}`}
      </span>
    </div>
  );
}

export default function ScanningView({ onNavigate, onReviewAll }: ScanningViewProps) {
  const { scanningFileName, scanProgress, scanStatus, batch, batchIndex } = useAppStore();

  const batchMode = batch.length > 0;
  const item = batchMode ? batch[batchIndex] : null;

  const fileName = item?.fileName ?? scanningFileName;
  const progress = item ? item.progress : scanProgress;
  const failed = item?.status === 'error';
  const status = item
    ? (failed ? (item.error || 'Failed to scan document') : item.statusMessage)
    : scanStatus;
  const isComplete = !failed && progress >= 100;

  const canReview = batchMode && canReviewBatch(batch);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="min-h-screen flex items-center justify-center"
    >
      <div className="max-w-sm w-full mx-4 text-center">
        {batchMode && (
          <p className="mb-4 text-[11px] font-semibold text-emerald-400/90 uppercase tracking-wider">
            Document {batchIndex + 1} of {batch.length}
          </p>
        )}
        {/* File icon with scanning line */}
        <div className="relative mx-auto mb-8 w-24 h-32">
          <div className="w-full h-full rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center overflow-hidden relative">
            <FileText className={`w-10 h-10 ${failed ? 'text-red-400/70' : 'text-slate-500'}`} />

            {/* Scanning line */}
            {!isComplete && !failed && (
              <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan" />
            )}
          </div>

          {/* Eye badge */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
            className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-emerald-500/20 border-2 border-emerald-500/30 flex items-center justify-center"
          >
            <Eye className="w-3.5 h-3.5 text-emerald-400" />
          </motion.div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 rounded-full bg-slate-800/80 overflow-hidden">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: `${failed ? 100 : progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className={`h-full rounded-full ${failed ? 'bg-red-500/60' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs font-mono text-slate-500">{failed ? '—' : `${progress}%`}</span>
            <span className="text-xs text-slate-500 truncate max-w-[200px]">{fileName}</span>
          </div>
        </div>

        {/* Status message */}
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-center gap-2"
        >
          {failed ? (
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          ) : isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
          )}
          <span className={`text-sm ${failed ? 'text-red-300' : isComplete ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
            {status}
          </span>
        </motion.div>

        {/* Batch: the other files keep scanning in the background */}
        {batchMode && (
          <div className="mt-8 text-left space-y-0.5 max-h-[30vh] overflow-y-auto pr-1">
            {batch.map((f, i) => (
              <BatchFileRow key={i} file={f} active={i === batchIndex} current={i + 1} />
            ))}
          </div>
        )}

        {/* Batch navigation (a failed or still-scanning file shouldn't trap the user) */}
        {batchMode && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {batchIndex > 0 && (
              <button onClick={() => onNavigate?.(batchIndex - 1)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white">
                <ArrowLeft className="w-3.5 h-3.5" /> Previous file
              </button>
            )}
            {batchIndex < batch.length - 1 && (
              <button onClick={() => onNavigate?.(batchIndex + 1)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white">
                Next file <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {canReview && (
              <button onClick={onReviewAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-xs font-medium text-white">
                <ClipboardCheck className="w-3.5 h-3.5" /> Review all files
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
