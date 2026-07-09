import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2, Settings,
  PanelLeftClose, PanelLeft, Home,
} from 'lucide-react';
import { listChats, deleteChat } from '../services/api';
import { MaskSymbol } from './MaskSymbol';
import { SavedChat } from '../types';

interface ChatSidebarProps {
  activeChatId: string | null;
  onSelectChat: (chat: SavedChat) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onGoHome: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function groupChats(chats: SavedChat[]) {
  const now = new Date();
  const today: SavedChat[] = [], week: SavedChat[] = [], older: SavedChat[] = [];
  for (const c of chats) {
    const diffDay = Math.floor((now.getTime() - new Date(c.updated_at || c.created_at).getTime()) / 86400000);
    if (diffDay < 1) today.push(c);
    else if (diffDay < 7) week.push(c);
    else older.push(c);
  }
  return { today, week, older };
}

function chatLabel(chat: SavedChat): string {
  if (chat.filenames.length === 0) return 'Untitled chat';
  if (chat.filenames.length === 1) return chat.filenames[0];
  return `${chat.filenames[0]} +${chat.filenames.length - 1}`;
}

export default function ChatSidebar({
  activeChatId, onSelectChat, onNewChat, onOpenSettings, onGoHome, collapsed, onToggleCollapse,
}: ChatSidebarProps) {
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => { listChats().then(setChats).catch(() => {}); }, [activeChatId]);

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    await deleteChat(chatId);
    setChats((prev) => prev.filter((c) => c.chat_id !== chatId));
  };

  const groups = groupChats(chats);

  if (collapsed) {
    return (
      <div className="w-14 h-screen flex flex-col bg-slate-900 border-r border-slate-800/50 items-center py-3 gap-2">
        <button onClick={onToggleCollapse} className="w-9 h-9 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors">
          <PanelLeft className="w-4 h-4 text-slate-400" />
        </button>
        <button onClick={onGoHome} className="w-9 h-9 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors" title="Back to redaction">
          <Home className="w-4 h-4 text-slate-400" />
        </button>
        <button onClick={onNewChat} className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center hover:bg-emerald-500/20 transition-colors">
          <Plus className="w-4 h-4 text-emerald-400" />
        </button>
        <div className="flex-1" />
        <button onClick={onOpenSettings} className="w-9 h-9 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors">
          <Settings className="w-4 h-4 text-slate-400" />
        </button>
      </div>
    );
  }

  const renderGroup = (label: string, items: SavedChat[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="px-3 mb-1.5"><span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span></div>
        <div className="space-y-0.5">
          {items.map((chat) => {
            const isActive = chat.chat_id === activeChatId;
            const isHovered = chat.chat_id === hoveredId;
            return (
              <motion.button key={chat.chat_id} onClick={() => onSelectChat(chat)}
                onMouseEnter={() => setHoveredId(chat.chat_id)} onMouseLeave={() => setHoveredId(null)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors group ${isActive ? 'bg-slate-800/80 border border-slate-700/50' : 'hover:bg-slate-800/40 border border-transparent'}`}
                layout>
                <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-slate-300'}`}>{chatLabel(chat)}</p>
                  <p className="text-[10px] text-slate-500 truncate">{chat.filenames.length} doc{chat.filenames.length !== 1 ? 's' : ''} · {formatRelativeDate(chat.updated_at || chat.created_at)}</p>
                </div>
                <AnimatePresence>
                  {isHovered && (
                    <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                      onClick={(e) => handleDelete(e, chat.chat_id)} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/15 transition-colors flex-shrink-0">
                      <Trash2 className="w-3 h-3 text-slate-500 hover:text-red-400" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="w-64 h-screen flex flex-col bg-slate-900 border-r border-slate-800/50">
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center"><MaskSymbol size="sm" /></div>
          <span className="text-sm font-bold text-white">MaskBase</span>
        </div>
        <button onClick={onToggleCollapse} className="w-7 h-7 rounded-lg bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors">
          <PanelLeftClose className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
      <div className="px-3 py-3 space-y-1.5">
        <button onClick={onGoHome} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors text-sm text-emerald-400">
          <Home className="w-4 h-4" /> Redact a document
        </button>
        <button onClick={onNewChat} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/70 transition-colors text-sm text-slate-300 hover:text-white">
          <Plus className="w-4 h-4" /> New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-4">
            <MessageSquare className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-xs text-slate-500">No chats yet</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Attach a document to start</p>
          </div>
        ) : (
          <>{renderGroup('Today', groups.today)}{renderGroup('This week', groups.week)}{renderGroup('Older', groups.older)}</>
        )}
      </div>
      <div className="px-3 py-3 border-t border-slate-800/50">
        <button onClick={onOpenSettings} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800/40 transition-colors text-sm text-slate-400 hover:text-white">
          <Settings className="w-4 h-4" /> Settings
        </button>
      </div>
    </div>
  );
}
