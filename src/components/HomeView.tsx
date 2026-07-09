import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  FileUp, FileText, Trash2, Settings, Info, MessageSquare,
  Cpu, Loader2, AlertTriangle, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { listSessions, deleteSession, SavedSession, getEngines, EngineStatus } from '../services/api';
import { MaskSymbol } from './MaskSymbol';
import { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, FILE_ACCEPT, filterAllowedFiles } from '../lib/fileTypes';

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function engineShortName(status: EngineStatus | null): string {
  if (!status) return 'Engine';
  if (status.kind === 'regex') return 'Pattern matching';
  const tail = status.model_id.split('/').pop() || status.model_id;
  return tail.replace(/[-_]/g, ' ');
}

interface HomeViewProps {
  onAttachFiles: (files: File[]) => void;
  onOpenSettings: () => void;
  onOpenChat: () => void;
  onOpenSession: (session: SavedSession) => void;
}

export default function HomeView({ onAttachFiles, onOpenSettings, onOpenChat, onOpenSession }: HomeViewProps) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setShowInfo = useAppStore((s) => s.setShowInfo);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const cat = await getEngines();
        if (cancelled) return;
        setEngineStatus(cat.status);
        if (cat.status.state === 'loading') timer = setTimeout(poll, 2500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterAllowedFiles(e.target.files);
    if (files.length > 0) onAttachFiles(files);
    if (e.target) e.target.value = '';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = filterAllowedFiles(e.dataTransfer.files);
    if (files.length > 0) onAttachFiles(files);
  }, [onAttachFiles]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(sessionId).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  };

  const engineChip = (() => {
    if (!engineStatus) return null;
    if (engineStatus.state === 'ready') {
      return (
        <button onClick={onOpenSettings} title="Redaction engine — change in Settings"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors">
          <Cpu className="w-3 h-3 text-emerald-400" />
          <span className="text-[11px] text-slate-300">{engineShortName(engineStatus)}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </button>
      );
    }
    if (engineStatus.state === 'error') {
      return (
        <button onClick={onOpenSettings} title={engineStatus.error || 'Engine failed to load'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          <span className="text-[11px] text-red-300">Engine error — open Settings</span>
        </button>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/40">
        <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
        <span className="text-[11px] text-slate-300">Loading model…</span>
      </div>
    );
  })();

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
      className="min-h-screen flex flex-col"
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <MaskSymbol size="sm" />
          <div>
            <h1 className="text-sm font-bold text-white leading-none">MaskBase</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">Local PII Redaction</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {engineChip}
          <button onClick={onOpenChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-300 hover:text-white">
            <MessageSquare className="w-3.5 h-3.5" /> AI Chat
          </button>
          <button onClick={() => setShowInfo(true)}
            className="w-8 h-8 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors" title="How it works">
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button onClick={onOpenSettings}
            className="w-8 h-8 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors" title="Settings">
            <Settings className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </header>

      {/* Hero + drop zone */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 }} className="text-center mb-8 max-w-xl">
          <h2 className="text-3xl font-bold text-white mb-3 leading-tight">
            Redact sensitive data <span className="text-emerald-400">before</span> it leaves your Mac
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            A small language model scans your documents on-device. You review every detection,
            then export a clean copy — nothing is ever uploaded.
          </p>
        </motion.div>

        <motion.button
          initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 }}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full max-w-xl rounded-2xl border-2 border-dashed p-10 text-center group cursor-pointer transition-all ${
            isDragging
              ? 'border-emerald-400 bg-emerald-500/10'
              : 'border-slate-700/70 hover:border-emerald-500/40 bg-slate-900/50 hover:bg-emerald-500/5'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
            <FileUp className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-base font-semibold text-white mb-1">
            {isDragging ? 'Drop to scan' : 'Drop documents or images, or click to browse'}
          </p>
          <p className="text-xs text-slate-400 mb-4">Add several at once — each is scanned and redacted locally, with your review before anything is final</p>
          <div className="flex items-center justify-center gap-2">
            {DOCUMENT_EXTENSIONS.map((ext) => (
              <span key={ext} className="px-2.5 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/40 text-[10px] font-mono text-slate-500">{ext}</span>
            ))}
            <span title={IMAGE_EXTENSIONS.join('  ')}
              className="px-2.5 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/40 text-[10px] font-mono text-slate-500">images (OCR)</span>
          </div>
        </motion.button>
        <input ref={fileInputRef} type="file" multiple accept={FILE_ACCEPT} onChange={handleFileSelect} className="hidden" />

        {/* Recent documents */}
        {sessions.length > 0 && (
          <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="w-full max-w-xl mt-8">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Recent documents</p>
            <div className="space-y-1 max-h-[26vh] overflow-y-auto pr-1">
              {sessions.map((s) => (
                <button key={s.session_id} onClick={() => onOpenSession(s)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800/40 hover:bg-slate-800/60 transition-colors group text-left">
                  <FileText className="w-4 h-4 text-emerald-400/80 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{s.filename}</p>
                    <p className="text-[10px] text-slate-500">
                      {s.total_entities} entit{s.total_entities === 1 ? 'y' : 'ies'} redacted · {formatRelativeDate(s.scanned_at)}
                    </p>
                  </div>
                  <span
                    role="button"
                    onClick={(e) => handleDelete(e, s.session_id)}
                    className="w-7 h-7 rounded-md hidden group-hover:flex items-center justify-center hover:bg-red-500/15 transition-colors flex-shrink-0"
                    title="Delete from history"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-center gap-2 pb-4">
        <ShieldCheck className="w-3 h-3 text-slate-600" />
        <span className="text-[11px] text-slate-600">100% local · no telemetry · open source</span>
      </footer>
    </motion.div>
  );
}
