import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Lock, Sparkles, ShieldCheck, Paperclip, FileText, FileUp, PanelRight, ChevronDown, Key, RefreshCw } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useAppStore } from '../stores/appStore';
import { setModel as apiSetModel, getProviders, ProviderInfo } from '../services/api';
import { Message } from '../types';
import { DOCUMENT_EXTENSIONS, FILE_ACCEPT, filterAllowedFiles } from '../lib/fileTypes';

const PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+?)_(\d+)\]/g;

function buildPlaceholderMap(redacted: string, deanonymized: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!redacted || !deanonymized) return map;
  const placeholders: { placeholder: string; start: number; end: number }[] = [];
  let m;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  while ((m = regex.exec(redacted)) !== null) {
    placeholders.push({ placeholder: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (placeholders.length === 0) return map;
  let rIdx = 0, dIdx = 0;
  for (const p of placeholders) {
    dIdx += p.start - rIdx;
    rIdx = p.start;
    const suffixInRedacted = redacted.slice(p.end, p.end + 20);
    let realValueEnd: number;
    if (suffixInRedacted.length > 0) {
      const suffixPos = deanonymized.indexOf(suffixInRedacted, dIdx);
      realValueEnd = suffixPos > dIdx ? suffixPos : dIdx + p.placeholder.length;
    } else { realValueEnd = deanonymized.length; }
    map[p.placeholder] = deanonymized.slice(dIdx, realValueEnd);
    rIdx = p.end;
    dIdx = realValueEnd;
  }
  return map;
}

function PlaceholderBadge({ placeholder, realValue }: { placeholder: string; realValue?: string }) {
  const [hovered, setHovered] = useState(false);
  const match = placeholder.match(/\[REDACTED_([A-Z_]+?)_(\d+)\]/);
  const label = match ? `${match[1]}_${match[2]}` : placeholder;
  return (
    <span className="relative inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-mono cursor-help">
        <ShieldCheck className="w-3 h-3" />{label}
      </span>
      {hovered && realValue && realValue !== placeholder && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-xs whitespace-nowrap shadow-xl z-50">
          <span className="text-slate-400 mr-1">Restored locally:</span>
          <span className="font-semibold text-emerald-300">{realValue}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 rotate-45 bg-slate-700 border-r border-b border-slate-600" />
        </span>
      )}
    </span>
  );
}

function parseAIMessage(text: string, placeholderMap: Record<string, string>): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  let lastIndex = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(...parseMarkdown(text.slice(lastIndex, match.index), `md-${lastIndex}`));
    parts.push(<PlaceholderBadge key={`ph-${match.index}`} placeholder={match[0]} realValue={placeholderMap[match[0]]} />);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(...parseMarkdown(text.slice(lastIndex), `md-${lastIndex}`));
  return parts.length > 0 ? parts : [text];
}

function parseMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(_(.+?)_)/g;
  let lastIndex = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2]) parts.push(<strong key={`${keyPrefix}-b-${match.index}`} className="font-semibold">{match[2]}</strong>);
    else if (match[4]) parts.push(<em key={`${keyPrefix}-i-${match.index}`} className="text-slate-400 italic text-xs">{match[4]}</em>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const placeholderMap = !isUser && message.deanonymizedText ? buildPlaceholderMap(message.text, message.deanonymizedText) : {};
  return (
    <div className={`max-w-3xl mx-auto w-full px-4 py-3 ${isUser ? '' : 'bg-slate-900/30'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isUser ? 'bg-emerald-600 text-white' : 'bg-slate-800 border border-slate-700/50'}`}>
          {isUser ? <span className="text-xs font-bold">U</span> : <Sparkles className="w-3.5 h-3.5 text-emerald-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-400 mb-1">{isUser ? 'You' : 'Assistant'}</p>
          <div className="text-sm text-slate-200 leading-relaxed">
            {message.attachment && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 w-fit">
                <FileText className="w-4 h-4 text-emerald-400" /><span className="text-xs text-slate-300">{message.attachment.name}</span>
              </div>
            )}
            {isUser ? parseMarkdown(message.text, 'user') : parseAIMessage(message.text, placeholderMap)}
          </div>
          {!isUser && Object.keys(placeholderMap).length > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <Lock className="w-2.5 h-2.5 text-slate-600" />
              <span className="text-[10px] text-slate-600">Hover badges to reveal — the AI only saw placeholders</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-3 bg-slate-900/30">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3.5 h-3.5 text-emerald-400" /></div>
        <div>
          <p className="text-xs font-semibold text-slate-400 mb-1">Assistant</p>
          <div className="flex items-center gap-1.5">
            <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
            <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
            <div className="typing-dot w-2 h-2 rounded-full bg-emerald-400" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChatPanelProps {
  onOpenSettings: () => void;
  onAttachFiles: (files: File[]) => void;
  onToggleDocPanel?: () => void;
  docPanelVisible?: boolean;
}

export default function ChatPanel({ onOpenSettings, onAttachFiles, onToggleDocPanel, docPanelVisible }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const { messages, isThinking, sendMessage } = useChatStore();
  const { chatId, documents, currentModel, currentProvider, setCurrentModel, setCurrentProvider, apiKeySet } = useAppStore();
  const canChat = apiKeySet;
  const modelLabel = currentModel || 'Select model';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) setShowModelPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const refreshProviders = useCallback(() => {
    setLoadingProviders(true);
    getProviders()
      .then((cat) => setProviders(cat.providers))
      .catch(() => {})
      .finally(() => setLoadingProviders(false));
  }, []);

  const handleOpenModelPicker = () => {
    if (!showModelPicker) refreshProviders();
    setShowModelPicker(!showModelPicker);
  };

  const handleModelChange = (provider: ProviderInfo, model: string) => {
    if (provider.requires_key && !provider.key_set) return;
    setCurrentModel(model);
    setCurrentProvider(provider.id);
    apiSetModel(model, provider.id).catch(() => {});
    setShowModelPicker(false);
  };
  const hasDocuments = documents.length > 0;
  const sessionIds = documents.map((d) => d.sessionId);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isThinking]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking || !canChat || !currentModel) return;
    setInput('');
    sendMessage(trimmed, sessionIds, chatId, currentModel, currentProvider || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterAllowedFiles(e.target.files);
    if (files.length > 0) onAttachFiles(files);
    if (e.target) e.target.value = '';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = filterAllowedFiles(e.dataTransfer.files);
    if (files.length > 0) onAttachFiles(files);
  }, [onAttachFiles]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 h-screen flex flex-col bg-slate-950" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <AnimatePresence>
        {isDragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-emerald-500/50 bg-emerald-500/5">
              <FileUp className="w-10 h-10 text-emerald-400" />
              <p className="text-sm text-emerald-400 font-medium">Drop files to redact & attach</p>
              <p className="text-xs text-slate-500">PDF, DOCX, CSV, XLSX, images</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/30">
        <div className="flex items-center gap-2 min-w-0">
          {/* Model selector */}
          <div className="relative" ref={modelPickerRef}>
            <button
              onClick={handleOpenModelPicker}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-white font-medium"
            >
              {modelLabel}
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
            </button>

            {showModelPicker && (
              <div className="absolute top-full left-0 mt-1 w-72 rounded-xl bg-slate-800 border border-slate-700/50 shadow-xl z-50 py-1 max-h-[60vh] overflow-y-auto">
                {loadingProviders && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Checking providers…
                  </div>
                )}
                {providers.map((p) => {
                  const locked = p.requires_key && !p.key_set;
                  const noModels = p.models.length === 0;
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between px-3 pt-2 pb-1">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{p.label}</p>
                        {locked && <span className="text-[9px] text-amber-500/70 font-medium">No key</span>}
                        {!locked && p.id === 'ollama' && noModels && <span className="text-[9px] text-slate-500 font-medium">not running</span>}
                        {!locked && p.id === 'custom' && !p.available && <span className="text-[9px] text-slate-500 font-medium">not configured</span>}
                      </div>
                      {noModels && p.id !== 'ollama' && p.id !== 'custom' && null}
                      {p.models.map((m) => {
                        const isActive = m === currentModel && p.id === currentProvider;
                        return (
                          <button
                            key={`${p.id}:${m}`}
                            onClick={() => handleModelChange(p, m)}
                            disabled={locked}
                            title={locked ? `Add a ${p.label} API key in Settings` : undefined}
                            className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
                              locked
                                ? 'text-slate-600 cursor-not-allowed'
                                : isActive
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : 'text-slate-300 hover:bg-slate-700/50'
                            }`}
                          >
                            <span className="truncate">{m}</span>
                            {p.id === 'ollama' && <span className="text-[9px] text-slate-500 font-medium ml-auto flex-shrink-0">local</span>}
                          </button>
                        );
                      })}
                      {p.id === 'ollama' && noModels && (
                        <p className="px-3 pb-2 text-[10px] text-slate-500">Start Ollama to chat with fully local models.</p>
                      )}
                      {p.id === 'custom' && noModels && p.available && (
                        <p className="px-3 pb-2 text-[10px] text-slate-500">Endpoint set — type a model name in Settings or ensure /models is exposed.</p>
                      )}
                      {p.id === 'custom' && !p.available && (
                        <button onClick={() => { setShowModelPicker(false); onOpenSettings(); }} className="w-full text-left px-3 py-1.5 text-xs text-emerald-400 hover:bg-slate-700/50">
                          Configure an OpenAI-compatible endpoint…
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {hasDocuments && (
            <span className="text-xs text-slate-500 flex-shrink-0">{documents.length} doc{documents.length > 1 ? 's' : ''}</span>
          )}
        </div>
        {hasDocuments && onToggleDocPanel && !docPanelVisible && (
          <button onClick={onToggleDocPanel} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/40 hover:bg-slate-700/60 transition-colors text-xs text-slate-400 hover:text-white">
            <PanelRight className="w-3 h-3" /> Show Document
          </button>
        )}
      </div>

      {/* Messages or empty state */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4"><ShieldCheck className="w-6 h-6 text-emerald-400" /></div>
          <h2 className="text-xl font-bold text-white mb-1">{hasDocuments ? 'Ask about your documents' : 'AI Chat'}</h2>
          <p className="text-sm text-slate-400 text-center max-w-md mb-6">
            {hasDocuments
              ? `${documents.length} redacted document${documents.length > 1 ? 's' : ''} attached. The AI only ever sees placeholders — never your real data.`
              : 'Chat with any model you choose — your key, your endpoint, or a fully local model. Attach documents and only the redacted text is sent.'}
          </p>

          {/* Bold attach card */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full max-w-sm rounded-xl border-2 border-dashed border-slate-700/70 hover:border-emerald-500/40 bg-slate-900/50 hover:bg-emerald-500/5 transition-all p-6 text-center group mb-6 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
              <FileUp className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">Attach & Redact Documents</p>
            <p className="text-xs text-slate-400 mb-3">PII is redacted on-device before any AI sees your data</p>
            <div className="flex items-center justify-center gap-2">
              {[...DOCUMENT_EXTENSIONS, 'images'].map((ext) => (
                <span key={ext} className="px-2.5 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/40 text-[10px] font-mono text-slate-500">{ext}</span>
              ))}
            </div>
          </button>

          {hasDocuments && (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Lock className="w-3 h-3" /><span>Redacted locally on-device</span></div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex justify-center py-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/40 border border-slate-700/30">
              <Lock className="w-3 h-3 text-slate-500" />
              <span className="text-xs text-slate-500">{documents.length} doc{documents.length > 1 ? 's' : ''} · Redacted locally on-device</span>
            </div>
          </div>
          {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
          {isThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area */}
      <div className="p-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className={`relative flex items-end gap-2 px-4 py-3 rounded-2xl bg-slate-800/60 border transition-colors ${
            !canChat ? 'border-slate-700/30' : isFocused ? 'border-emerald-500/40' : 'border-slate-700/30'
          }`}>
            <button onClick={() => fileInputRef.current?.click()} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700/60 transition-colors flex-shrink-0 mb-0.5" title="Attach file">
              <Paperclip className="w-4 h-4 text-slate-400" />
            </button>
            <input ref={fileInputRef} type="file" multiple accept={FILE_ACCEPT} onChange={handleFileSelect} className="hidden" />

            {!canChat ? (
              <div onClick={onOpenSettings} className="flex-1 flex items-end gap-2 cursor-pointer">
                <span className="flex-1 text-sm text-slate-600 leading-normal py-1">Connect a model to start chatting…</span>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-700/50 text-slate-600 flex-shrink-0 mb-0.5">
                  <Send className="w-4 h-4" />
                </div>
              </div>
            ) : (
              <>
                <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)} onKeyDown={handleKeyDown}
                  placeholder={hasDocuments ? 'Ask about your documents…' : 'Send a message…'}
                  rows={1} className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none resize-none max-h-[200px] leading-normal py-1"
                />
                <button onClick={handleSend} disabled={!input.trim() || isThinking}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0 mb-0.5 ${input.trim() && !isThinking ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-slate-700/50 text-slate-500'}`}>
                  <Send className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          {!canChat ? (
            <div className="flex items-center justify-center gap-1.5 mt-2 text-xs">
              <Key className="w-3 h-3 text-amber-500/70" />
              <span className="text-slate-500">Add an API key, a custom endpoint, or run Ollama —</span>
              <button onClick={onOpenSettings} className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
                Settings
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-slate-600 text-center mt-2">PII is redacted locally before anything is sent. Your real data never leaves your device.</p>
          )}
        </div>
      </div>
    </div>
  );
}
