import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, PanelRightClose } from 'lucide-react';
import ChatSidebar from './ChatSidebar';
import ChatPanel from './ChatPanel';
import DocumentViewer from './DocumentViewer';
import { useAppStore } from '../stores/appStore';
import { SavedChat } from '../types';

interface ChatViewProps {
  onOpenSettings: () => void;
  onSelectChat: (chat: SavedChat) => void;
  onNewChat: () => void;
  onAttachFiles: (files: File[]) => void;
  onGoHome: () => void;
}

export default function ChatView({ onOpenSettings, onSelectChat, onNewChat, onAttachFiles, onGoHome }: ChatViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [docPanelCollapsed, setDocPanelCollapsed] = useState(false);
  const [docPanelWidth, setDocPanelWidth] = useState(480);
  const [activeDocIndex, setActiveDocIndex] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const startWidthRef = useRef(480);
  const startXRef = useRef(0);
  const chatId = useAppStore((s) => s.chatId);
  const documents = useAppStore((s) => s.documents);
  const hasDocuments = documents.length > 0;

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = docPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startXRef.current - ev.clientX;
      setDocPanelWidth(Math.max(280, Math.min(900, startWidthRef.current + delta)));
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [docPanelWidth]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
      className={`flex h-screen w-screen ${isResizing ? 'cursor-col-resize' : ''}`}
      style={isResizing ? { userSelect: 'none' } : undefined}
    >
      <ChatSidebar
        activeChatId={chatId} onSelectChat={onSelectChat} onNewChat={onNewChat}
        onOpenSettings={onOpenSettings} onGoHome={onGoHome}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex-1 flex overflow-hidden">
        <ChatPanel
          onOpenSettings={onOpenSettings}
          onAttachFiles={onAttachFiles}
          onToggleDocPanel={hasDocuments ? () => setDocPanelCollapsed(!docPanelCollapsed) : undefined}
          docPanelVisible={hasDocuments && !docPanelCollapsed}
        />

        {/* Inline document panel — always visible when documents exist */}
        {hasDocuments && !docPanelCollapsed && (
          <>
            {/* Drag handle */}
            <div
              className="relative flex-shrink-0 group"
              style={{ width: 5 }}
              onMouseDown={onResizeMouseDown}
            >
              <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize z-20" />
              <div className="w-full h-full bg-slate-800/50 transition-colors group-hover:bg-emerald-500/50" />
            </div>

            <div
              style={{ width: docPanelWidth }}
              className="h-screen flex flex-col bg-slate-950 flex-shrink-0"
            >
              {/* Doc tabs + collapse button */}
              <div className="flex items-center gap-1 px-2 py-2 border-b border-slate-800/50 bg-slate-900/60">
                <div className="flex-1 flex items-center gap-1 overflow-x-auto">
                  {documents.map((doc, i) => (
                    <button
                      key={doc.sessionId}
                      onClick={() => setActiveDocIndex(i)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        i === activeDocIndex
                          ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
                          : 'bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-white'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      <span className="truncate max-w-[100px]">{doc.fileName}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setDocPanelCollapsed(true)}
                  className="w-7 h-7 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors flex-shrink-0"
                  title="Hide document"
                >
                  <PanelRightClose className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-hidden">
                <DocumentViewer document={documents[activeDocIndex]} />
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
