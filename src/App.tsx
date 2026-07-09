import { useEffect, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from './stores/appStore';
import { useChatStore } from './stores/chatStore';
import { checkHealth, getSettings, loadSession, scanDocument, submitColumnRedaction, updateRedaction, SavedSession } from './services/api';
import { openUrl } from '@tauri-apps/plugin-opener';
import FloatingHeader from './components/FloatingHeader';
import HomeView from './components/HomeView';
import ScanningView from './components/ScanningView';
import ManifestView from './components/ManifestView';
import ResultView from './components/ResultView';
import BatchReviewView from './components/BatchReviewView';
import ChatView from './components/ChatView';
import InfoPage from './components/InfoPage';
import SettingsModal from './components/SettingsModal';
import WelcomeModal, { hasSeenWelcome } from './components/TermsModal';
import { SavedChat } from './types';

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export default function App() {
  const { stage, backendReady, setBackendReady, error, setError, setApiKeySet, setCurrentModel, setCurrentProvider, setStage } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsReason, setSettingsReason] = useState<'manual' | 'required'>('manual');
  const [showWelcome, setShowWelcome] = useState(!hasSeenWelcome());

  const loadSettings = useCallback(async () => {
    try {
      const s = await getSettings();
      setApiKeySet(s.api_key_set);
      setCurrentModel(s.model || '');
      setCurrentProvider(s.provider || '');
      return s.api_key_set;
    } catch { return false; }
  }, [setApiKeySet, setCurrentModel, setCurrentProvider]);

  const [loadingMessage, setLoadingMessage] = useState('Starting MaskBase engine…');
  // Download/load progress for the boot screen. null = no bar (spinner only);
  // percent null = indeterminate bar (size unknown or model loading into memory).
  const [bootProgress, setBootProgress] = useState<{ percent: number | null; detail: string | null } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let connectFailures = 0;
    const pollHealth = async () => {
      // Poll indefinitely — a cold-start can take a while (model download on
      // first run, or a slow sidecar boot). Never strand the user on a dead
      // loading screen; just keep reporting what's happening.
      while (!cancelled) {
        try {
          const health = await checkHealth();
          if (cancelled) return;
          connectFailures = 0;
          if (health.model_ready) {
            setBackendReady(true);
            await loadSettings();
            return;
          }
          // Server is up but the PII model is still downloading or loading.
          const engine = health.engine;
          const prog = engine?.progress;
          setBootError(engine?.state === 'error' ? (engine.error || 'The PII model failed to load.') : null);
          if (prog?.stage === 'downloading') {
            setLoadingMessage('Downloading the PII detection model…');
            const percent = prog.total_bytes > 0
              ? Math.min(100, (prog.downloaded_bytes / prog.total_bytes) * 100)
              : null;
            setBootProgress({
              percent,
              detail: percent !== null
                ? `${formatBytes(prog.downloaded_bytes)} of ${formatBytes(prog.total_bytes)} · ${Math.round(percent)}%`
                : formatBytes(prog.downloaded_bytes),
            });
          } else if (engine?.state !== 'error') {
            setLoadingMessage('Loading PII detection model…');
            setBootProgress({ percent: null, detail: null });
          }
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          // Backend not reachable yet (still booting, or not started).
          connectFailures++;
          if (connectFailures > 20) {
            setLoadingMessage('Waiting for the redaction backend to start…');
            setBootProgress(null);
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };
    pollHealth();
    return () => { cancelled = true; };
  }, [setBackendReady, loadSettings]);

  useEffect(() => {
    if (backendReady && stage === 'idle') setStage('home');
  }, [backendReady, stage, setStage]);

  const { updateAvailable, latestVersion, updateDownloadUrl, updateDismissed, dismissUpdate } = useAppStore();

  const handleOpenSettings = () => { setSettingsReason('manual'); setShowSettings(true); };
  const handleCloseSettings = () => { setShowSettings(false); };
  const handleSettingsSaved = async () => {
    await loadSettings();
    setShowSettings(false);
  };

  const handleSelectChat = async (chat: SavedChat) => {
    cancelBatch();
    const store = useAppStore.getState();
    store.setChatId(chat.chat_id);
    store.setDocuments([]);

    const docs = [];
    for (let i = 0; i < chat.session_ids.length; i++) {
      const sid = chat.session_ids[i];
      const filename = chat.filenames[i] || sid;
      try {
        const result = await loadSession(sid);
        docs.push({ sessionId: sid, fileName: filename, scanResult: result });
      } catch { setError(`Failed to load document: ${filename}`); }
    }

    store.setDocuments(docs);
    useChatStore.getState().loadChatMessages(chat.chat_id);
  };

  const handleNewChat = () => {
    batchRunRef.current++; // stop any background batch scans
    useAppStore.getState().newChat();
    useChatStore.getState().reset();
    setStage('chat');
  };

  // Identifies the batch scan loop currently allowed to write to the store;
  // bumping it cancels any loop still running for an abandoned batch.
  const batchRunRef = useRef(0);

  const cancelBatch = () => {
    batchRunRef.current++;
    useAppStore.getState().clearBatch();
  };

  const processFile = async (file: File) => {
    useAppStore.getState().startScanning(file.name);
    setStage('scanning');

    try {
      const result = await scanDocument(file, (progress, message) => {
        useAppStore.getState().setScanProgress(progress);
        useAppStore.getState().setScanStatus(message);
      });

      useAppStore.getState().setScanProgress(100);
      useAppStore.getState().setScanStatus('Complete ✓');
      useAppStore.getState().setPendingScanResult(result);

      // Tabular files need the column picker first; everything else goes
      // straight to the editable document — review happens in place there.
      const needsColumnPick = !!(result.columns && result.columns.length > 0);
      setTimeout(() => setStage(needsColumnPick ? 'manifest' : 'result'), 400);
    } catch (err: any) {
      setError(`${file.name}: ${err.message || 'Failed to scan document'}`);
      setStage('home');
    }
  };

  /** Show one file of the batch: its editable review when the scan is done,
   * otherwise its scan progress. Edits to the file being left are kept. */
  const showBatchItem = (index: number) => {
    const store = useAppStore.getState();
    store.syncPendingToBatch();
    store.setBatchIndex(index);
    const item = useAppStore.getState().batch[index];
    if (!item) return;
    store.setScanningFileName(item.fileName);
    if (item.status === 'ready' && item.result) {
      store.setPendingScanResult(item.result);
      if (item.needsColumnPick) {
        setStage('manifest');
      } else {
        store.updateBatchItem(index, { viewed: true });
        setStage('result');
      }
    } else {
      // Still scanning (or failed) — show its progress; navigation stays available.
      setStage('scanning');
    }
  };

  /** Scan every batch file in the background, one at a time so the local
   * model isn't thrashed. The user reviews file 1 while the rest complete. */
  const runBatchScans = async (files: File[], runId: number) => {
    for (let i = 0; i < files.length; i++) {
      if (batchRunRef.current !== runId) return;
      useAppStore.getState().updateBatchItem(i, { status: 'scanning', statusMessage: 'Uploading document…' });
      try {
        const result = await scanDocument(files[i], (progress, message) => {
          if (batchRunRef.current === runId) {
            useAppStore.getState().updateBatchItem(i, { progress, statusMessage: message });
          }
        });
        if (batchRunRef.current !== runId) return;
        useAppStore.getState().updateBatchItem(i, {
          status: 'ready', progress: 100, statusMessage: 'Complete ✓', result,
          needsColumnPick: !!(result.columns && result.columns.length > 0),
        });
      } catch (err: any) {
        if (batchRunRef.current !== runId) return;
        useAppStore.getState().updateBatchItem(i, { status: 'error', error: err?.message || 'Failed to scan document' });
      }
      // If the user is sitting on this file's scanning screen, reveal it now.
      const st = useAppStore.getState();
      if (st.batch.length > 0 && st.batchIndex === i && st.stage === 'scanning') showBatchItem(i);
    }
  };

  const handleAttachFiles = (files: File[]) => {
    if (files.length === 0) return;
    cancelBatch();
    if (files.length === 1) {
      processFile(files[0]);
      return;
    }
    // Multi-file batch: every file scans in the background while the user
    // verifies them one by one, then reviews and saves the whole set at once.
    const store = useAppStore.getState();
    store.setDocuments([]);
    store.startBatch(files.map((f) => f.name));
    store.setScanningFileName(files[0].name);
    setStage('scanning');
    runBatchScans(files, batchRunRef.current);
  };

  const [isRedacting, setIsRedacting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirmScan = async () => {
    const store = useAppStore.getState();
    const { pendingScanResult } = store;

    if (pendingScanResult?.detected_entities && pendingScanResult.detected_entities.length > 0) {
      const includedIndices: number[] = [];
      const customTexts: string[] = [];
      pendingScanResult.detected_entities.forEach((e, i) => {
        if (!e.enabled) return;
        if (e.is_custom) customTexts.push(e.text);
        else includedIndices.push(i);
      });

      setIsConfirming(true);
      try {
        const updated = await updateRedaction(pendingScanResult.session_id, includedIndices, customTexts);
        // Keep the review list so the user can come back and re-adjust
        store.setPendingScanResult({ ...updated, detected_entities: pendingScanResult.detected_entities });
      } catch (err: any) {
        setError(err.message || 'Failed to update redaction');
        setIsConfirming(false);
        return;
      }
      setIsConfirming(false);
    }

    markBatchColumnPickDone();
    setStage('result');
  };

  /** After a tabular batch file finishes its column step, its result view
   * counts as the redaction review. */
  const markBatchColumnPickDone = () => {
    const store = useAppStore.getState();
    if (store.batch.length === 0) return;
    const item = store.batch[store.batchIndex];
    if (!item) return;
    store.updateBatchItem(store.batchIndex, {
      result: store.pendingScanResult ?? item.result,
      needsColumnPick: false,
      viewed: true,
    });
  };

  const handleColumnRedact = async () => {
    const store = useAppStore.getState();
    const { pendingScanResult, selectedColumns } = store;
    if (!pendingScanResult || selectedColumns.length === 0) return;

    setIsRedacting(true);
    try {
      const result = await submitColumnRedaction(pendingScanResult.session_id, selectedColumns);
      store.setPendingScanResult(result);
      markBatchColumnPickDone();
      setStage('result');
    } catch (err: any) {
      setError(err.message || 'Column redaction failed');
    } finally {
      setIsRedacting(false);
    }
  };

  const handleOpenSession = async (session: SavedSession) => {
    try {
      const result = await loadSession(session.session_id);
      cancelBatch();
      const store = useAppStore.getState();
      store.setPendingScanResult(result);
      store.setScanningFileName(session.filename);
      setStage('result');
    } catch (err: any) {
      setError(err.message || 'Failed to load document');
    }
  };

  const handleResultDone = () => {
    // "Done" mid-batch abandons the remaining files.
    useAppStore.getState().clearPending();
    cancelBatch();
    setStage('home');
  };

  /** Single-file flow: attach the redacted document to a fresh chat. */
  const handleResultChat = async () => {
    useChatStore.getState().reset();
    const store = useAppStore.getState();
    store.setChatId(crypto.randomUUID());
    store.setDocuments([]);
    store.confirmScan();
    const hasKey = await loadSettings();
    setStage('chat');
    if (!hasKey) { setSettingsReason('required'); setShowSettings(true); }
  };

  /** Batch: leave the per-file review for the all-files review screen. */
  const handleReviewAll = () => {
    useAppStore.getState().syncPendingToBatch();
    setStage('batch-review');
  };

  /** Batch review screen: jump back into one file to edit it. */
  const handleEditFile = (index: number) => {
    showBatchItem(index);
  };

  /** Batch review screen: attach every redacted document to a fresh chat. */
  const handleReviewChat = async () => {
    const store = useAppStore.getState();
    const docs = store.batch
      .filter((b) => b.status === 'ready' && b.result)
      .map((b) => ({ sessionId: b.result!.session_id, fileName: b.fileName, scanResult: b.result! }));
    useChatStore.getState().reset();
    store.setChatId(crypto.randomUUID());
    store.setDocuments(docs);
    store.clearPending();
    cancelBatch();
    const hasKey = await loadSettings();
    setStage('chat');
    if (!hasKey) { setSettingsReason('required'); setShowSettings(true); }
  };

  /** Batch review screen: all done, back home. */
  const handleReviewDone = () => {
    useAppStore.getState().clearPending();
    cancelBatch();
    setStage('home');
  };

  const handleGoHome = () => {
    setStage('home');
  };

  return (
    <div className="relative min-h-screen bg-slate-950 overflow-hidden">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <FloatingHeader onOpenSettings={handleOpenSettings} />

      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-2">✕</button>
        </div>
      )}

      {!backendReady && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
              <svg className="w-6 h-6 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-sm text-slate-400">{loadingMessage}</p>
            {bootProgress ? (
              <div className="w-64 mx-auto mt-3">
                <div className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                  {bootProgress.percent !== null ? (
                    <motion.div
                      animate={{ width: `${bootProgress.percent}%` }}
                      transition={{ ease: 'easeOut', duration: 0.5 }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                    />
                  ) : (
                    <motion.div
                      animate={{ x: ['-100%', '300%'] }}
                      transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                      className="h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                    />
                  )}
                </div>
                {bootProgress.detail && (
                  <p className="text-xs font-mono text-slate-500 mt-2">{bootProgress.detail}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-600 mt-1">This may take a moment on first launch</p>
            )}
            {bootError && (
              <p className="text-xs text-red-400 mt-3 max-w-sm mx-auto">{bootError}</p>
            )}
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {stage === 'home' && (
          <HomeView key="home" onAttachFiles={handleAttachFiles} onOpenSettings={handleOpenSettings} onOpenChat={() => setStage('chat')} onOpenSession={handleOpenSession} />
        )}
        {stage === 'scanning' && <ScanningView key="scanning" onNavigate={showBatchItem} onReviewAll={handleReviewAll} />}
        {stage === 'manifest' && <ManifestView key="manifest" onConfirm={handleConfirmScan} onColumnRedact={handleColumnRedact} isRedacting={isRedacting} isConfirming={isConfirming} />}
        {stage === 'result' && (
          <ResultView key="result" onOpenChat={handleResultChat} onDone={handleResultDone} onNavigate={showBatchItem} onReviewAll={handleReviewAll} />
        )}
        {stage === 'batch-review' && (
          <BatchReviewView key="batch-review" onEditFile={handleEditFile} onOpenChat={handleReviewChat} onDone={handleReviewDone} />
        )}
        {stage === 'chat' && (
          <ChatView key="chat" onOpenSettings={handleOpenSettings} onSelectChat={handleSelectChat} onNewChat={handleNewChat} onAttachFiles={handleAttachFiles} onGoHome={handleGoHome} />
        )}
      </AnimatePresence>

      <InfoPage />
      <SettingsModal isOpen={showSettings} onClose={handleCloseSettings} onSaved={handleSettingsSaved} required={settingsReason === 'required'} />
      <WelcomeModal isOpen={showWelcome} onAccept={() => setShowWelcome(false)} />

      <AnimatePresence>
        {updateAvailable && !updateDismissed && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-slate-800/90 border border-emerald-500/30 shadow-lg shadow-emerald-500/5 backdrop-blur-md"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span className="text-sm text-slate-200">
              MaskBase <span className="font-semibold text-emerald-400">v{latestVersion}</span> is available
            </span>
            <button
              onClick={() => updateDownloadUrl && openUrl(updateDownloadUrl)}
              className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
            >
              Download
            </button>
            <button
              onClick={dismissUpdate}
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-slate-700/60 transition-colors text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
