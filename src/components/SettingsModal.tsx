import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Key, AlertTriangle, Shield, Trash2, CheckCircle, Loader2, Sliders,
  Download, RefreshCw, Plus, Cpu, Star, HardDrive, Globe, ExternalLink,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  getSettings, setProviderKey, removeProviderKey, setThreshold, setIgnorePronouns,
  getPIILabels, updatePIILabels, addCustomPIILabel, removeCustomPIILabel, PIILabel, ProviderKeyInfo,
  getEngines, selectEngine, setRegexBoost, setCustomEndpoint, EngineInfo, EngineStatus,
  getProviders,
} from '../services/api';
import { useAppStore } from '../stores/appStore';
import { APP_VERSION, GITHUB_URL, checkForUpdate } from '../services/updateChecker';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  required?: boolean;
}

const KEY_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza...' },
] as const;

export default function SettingsModal({ isOpen, onClose, onSaved, required }: SettingsModalProps) {
  const { updateAvailable, latestVersion, updateDownloadUrl, setUpdateAvailable } = useAppStore();
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({ openai: '', anthropic: '', gemini: '' });
  const [keysInfo, setKeysInfo] = useState<Record<string, ProviderKeyInfo>>({});
  const [threshold, setThresholdState] = useState<number>(0.75);
  const [ignorePronouns, setIgnorePronounsState] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [piiLabels, setPiiLabels] = useState<PIILabel[]>([]);
  const [customLabelInput, setCustomLabelInput] = useState('');
  const [isAddingLabel, setIsAddingLabel] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'up-to-date' | 'error' | null>(null);

  // Engine state
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [customEngineKind, setCustomEngineKind] = useState<'gliner' | 'hf_token'>('gliner');
  const [customEngineModel, setCustomEngineModel] = useState('');
  const [isSelectingEngine, setIsSelectingEngine] = useState(false);

  // Custom chat endpoint
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customSaved, setCustomSaved] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);

  const chatSectionRef = useRef<HTMLDivElement>(null);

  // When opened because chat needs a model ("Ask AI" without one configured),
  // jump to the AI Chat providers section instead of the top of the list.
  useEffect(() => {
    if (!isOpen || !required) return;
    const t = setTimeout(
      () => chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      250,
    );
    return () => clearTimeout(t);
  }, [isOpen, required]);

  const refreshEngines = useCallback(() => {
    getEngines().then((cat) => {
      setEngines(cat.engines);
      setEngineStatus(cat.status);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isOpen) {
      getSettings().then((s) => {
        setKeysInfo(s.api_keys || {});
        setThresholdState(s.threshold ?? 0.75);
        setIgnorePronounsState(s.ignore_pronouns ?? true);
        setKeyInputs({ openai: '', anthropic: '', gemini: '' });
        setCustomBaseUrl(s.custom_base_url || '');
        setError('');
      }).catch(() => {});

      getPIILabels().then(setPiiLabels).catch(() => {});
      refreshEngines();
      getProviders().then((cat) => {
        const ollama = cat.providers.find((p) => p.id === 'ollama');
        setOllamaModels(ollama ? ollama.models : []);
      }).catch(() => setOllamaModels([]));
    }
  }, [isOpen, refreshEngines]);

  // Poll engine status while a model is downloading
  useEffect(() => {
    if (!isOpen || engineStatus?.state !== 'loading') return;
    const t = setTimeout(refreshEngines, 2500);
    return () => clearTimeout(t);
  }, [isOpen, engineStatus, refreshEngines]);

  const handleSelectEngine = async (kind: string, modelId: string) => {
    setIsSelectingEngine(true);
    setError('');
    try {
      const status = await selectEngine(kind, modelId);
      setEngineStatus(status);
      refreshEngines();
    } catch (err: any) {
      setError(err.message || 'Failed to switch engine');
    } finally {
      setIsSelectingEngine(false);
    }
  };

  const handleUseCustomEngine = async () => {
    const modelId = customEngineModel.trim();
    if (!modelId) return;
    await handleSelectEngine(customEngineKind, modelId);
    setCustomEngineModel('');
  };

  const handleRegexBoostToggle = async () => {
    if (!engineStatus) return;
    const next = !engineStatus.regex_boost;
    setEngineStatus({ ...engineStatus, regex_boost: next });
    try { await setRegexBoost(next); } catch { /* keep optimistic state */ }
  };

  const handleSaveKey = async (provider: string) => {
    const key = keyInputs[provider]?.trim();
    if (!key) return;
    setIsSaving(provider);
    setError('');
    try {
      await setProviderKey(provider, key);
      const s = await getSettings();
      setKeysInfo(s.api_keys || {});
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save key');
    } finally {
      setIsSaving(null);
    }
  };

  const handleRemoveKey = async (provider: string) => {
    setIsSaving(provider);
    setError('');
    try {
      await removeProviderKey(provider);
      const s = await getSettings();
      setKeysInfo(s.api_keys || {});
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to remove key');
    } finally {
      setIsSaving(null);
    }
  };

  const handleSaveCustomEndpoint = async () => {
    setError('');
    try {
      await setCustomEndpoint(customBaseUrl.trim(), customApiKey.trim() || undefined);
      setCustomApiKey('');
      setCustomSaved(true);
      setTimeout(() => setCustomSaved(false), 1500);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save endpoint');
    }
  };

  const saveLabelsToDisk = (labels: PIILabel[]) => {
    const enabled = labels.filter((l) => l.enabled).map((l) => l.label);
    updatePIILabels(enabled).catch(() => {});
  };

  const toggleLabel = (label: string) => {
    setPiiLabels((prev) => {
      const updated = prev.map((l) => (l.label === label ? { ...l, enabled: !l.enabled } : l));
      saveLabelsToDisk(updated);
      return updated;
    });
  };

  const handleAddCustomLabel = async () => {
    const name = customLabelInput.trim().toLowerCase();
    if (!name) return;
    if (piiLabels.some((l) => l.label === name)) {
      setError(`"${name}" already exists`);
      return;
    }
    setIsAddingLabel(true);
    setError('');
    try {
      const added = await addCustomPIILabel(name);
      setPiiLabels((prev) => [...prev, added]);
      setCustomLabelInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to add custom label');
    } finally {
      setIsAddingLabel(false);
    }
  };

  const handleRemoveCustomLabel = async (label: string) => {
    setError('');
    try {
      await removeCustomPIILabel(label);
      setPiiLabels((prev) => prev.filter((l) => l.label !== label));
    } catch (err: any) {
      setError(err.message || 'Failed to remove custom label');
    }
  };

  const handleThresholdChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setThresholdState(val);
    try {
      await setThreshold(val);
    } catch (err: any) {
      setError(err.message || 'Failed to update threshold');
    }
  };

  const handleIgnorePronounsToggle = async () => {
    const newVal = !ignorePronouns;
    setIgnorePronounsState(newVal);
    try {
      await setIgnorePronouns(newVal);
    } catch (err: any) {
      setError(err.message || 'Failed to update ignore pronouns setting');
    }
  };

  const allEnabled = piiLabels.length > 0 && piiLabels.every((l) => l.enabled);

  const toggleAll = () => {
    const newState = !allEnabled;
    setPiiLabels((prev) => {
      const updated = prev.map((l) => ({ ...l, enabled: newState }));
      saveLabelsToDisk(updated);
      return updated;
    });
  };

  const handleCheckForUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateCheckResult(null);
    try {
      const result = await checkForUpdate();
      if (!result) {
        setUpdateCheckResult('error');
      } else if (result.available) {
        setUpdateAvailable(result.version, result.downloadUrl);
        setUpdateCheckResult(null);
      } else {
        setUpdateCheckResult('up-to-date');
      }
    } catch {
      setUpdateCheckResult('error');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const enabledCount = piiLabels.filter((l) => l.enabled).length;
  const activeIsZeroShot = engineStatus ? engineStatus.kind === 'gliner' : true;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center"
          onClick={required ? undefined : onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg mx-4 rounded-2xl bg-slate-900 border border-slate-700/50 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/50 flex-shrink-0">
              <h3 className="text-base font-semibold text-white">Settings</h3>
              {!required && (
                <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-800/60 flex items-center justify-center hover:bg-slate-700/60 transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-6">
              {/* ── Redaction Engine ─────────────────────────────── */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-1">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  Redaction Engine
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  The model that detects PII — it runs entirely on this Mac. Switching downloads the model on first use.
                </p>

                {engineStatus?.state === 'loading' && (
                  <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
                    <p className="text-xs text-amber-300">Downloading / loading model — scanning is paused until it's ready.</p>
                  </div>
                )}
                {engineStatus?.state === 'error' && (
                  <div className="flex items-start gap-2 px-3 py-2 mb-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">Engine failed to load: {engineStatus.error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {engines.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => !e.active && handleSelectEngine(e.kind, e.model_id)}
                      disabled={isSelectingEngine}
                      className={`w-full text-left rounded-xl border p-3 transition-colors ${
                        e.active
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-slate-800/30 border-slate-700/20 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-white truncate">{e.label}</span>
                          {e.recommended && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                          {e.active && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {e.cached && (
                            <span className="flex items-center gap-1 text-[9px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                              <HardDrive className="w-2.5 h-2.5" /> downloaded
                            </span>
                          )}
                          <span className="text-[9px] font-mono text-slate-500">{e.size}</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{e.description}</p>
                      {e.model_id && <p className="text-[10px] font-mono text-slate-600 mt-1">{e.model_id}</p>}
                    </button>
                  ))}
                </div>

                {/* Custom engine model */}
                <div className="mt-2 rounded-xl bg-slate-800/30 border border-slate-700/20 p-3">
                  <p className="text-xs font-medium text-slate-300 mb-2">Use any Hugging Face model</p>
                  <div className="flex gap-2">
                    <select
                      value={customEngineKind}
                      onChange={(e) => setCustomEngineKind(e.target.value as 'gliner' | 'hf_token')}
                      className="px-2 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-xs text-white outline-none focus:border-emerald-500/40"
                    >
                      <option value="gliner">GLiNER</option>
                      <option value="hf_token">Token classifier</option>
                    </select>
                    <input
                      type="text"
                      value={customEngineModel}
                      onChange={(e) => setCustomEngineModel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUseCustomEngine()}
                      placeholder="org/model-id (e.g. urchade/gliner_base)"
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 transition-colors font-mono"
                    />
                    <button
                      onClick={handleUseCustomEngine}
                      disabled={!customEngineModel.trim() || isSelectingEngine}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        customEngineModel.trim() && !isSelectingEngine
                          ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                          : 'bg-slate-700/50 text-slate-500'
                      }`}
                    >
                      Use
                    </button>
                  </div>
                </div>

                {/* Regex boost */}
                <button
                  onClick={handleRegexBoostToggle}
                  className="mt-2 w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/30 border border-slate-700/20 hover:bg-slate-700/30 transition-colors group"
                >
                  <div className="text-left">
                    <span className="text-sm font-medium text-slate-300 group-hover:text-emerald-400 transition-colors block">
                      Pattern-matching boost
                    </span>
                    <p className="text-xs text-slate-500 mt-1">
                      Also run deterministic patterns (emails, cards, SSNs, IPs, IBANs) on top of the model. Recommended.
                    </p>
                  </div>
                  <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-4 ${engineStatus?.regex_boost ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${engineStatus?.regex_boost ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                  </div>
                </button>
              </div>

              {/* ── PII Label Toggles ─────────────────────────────── */}
              {piiLabels.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      PII Detection Types
                    </label>
                    <button onClick={toggleAll} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                      {allEnabled ? 'Disable all' : 'Enable all'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    Choose which types of sensitive data to detect and redact. Changes are saved automatically.
                    {' '}<span className="text-emerald-400/70">{enabledCount}/{piiLabels.length} enabled</span>
                  </p>
                  {!activeIsZeroShot && (
                    <div className="flex items-start gap-2 px-3 py-2 mb-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <Cpu className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-blue-300">
                        The active engine has a fixed vocabulary — type toggles still filter results, but custom types need a zero-shot GLiNER engine.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1 max-h-[30vh] overflow-y-auto pr-1 rounded-xl bg-slate-800/30 border border-slate-700/20 p-2">
                    {piiLabels.map((pii) => (
                      <div key={pii.label}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-700/30 transition-colors group cursor-pointer"
                        onClick={() => toggleLabel(pii.label)}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-sm text-white capitalize">{pii.label}</span>
                          <span className="text-[10px] font-mono text-slate-600 bg-slate-800/80 px-1.5 py-0.5 rounded hidden group-hover:inline-block">{pii.entity_type}</span>
                          {pii.custom && (
                            <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">custom</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {pii.custom && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveCustomLabel(pii.label); }}
                              className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/15 transition-colors"
                              title="Remove custom label"
                            >
                              <Trash2 className="w-3 h-3 text-slate-500 hover:text-red-400" />
                            </button>
                          )}
                          <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${pii.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${pii.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={customLabelInput}
                      onChange={(e) => { setCustomLabelInput(e.target.value); setError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCustomLabel()}
                      placeholder="Add custom type (e.g. enrollment number)…"
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 transition-colors"
                      disabled={isAddingLabel}
                    />
                    <button
                      onClick={handleAddCustomLabel}
                      disabled={!customLabelInput.trim() || isAddingLabel}
                      className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                        customLabelInput.trim() && !isAddingLabel
                          ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                          : 'bg-slate-700/50 text-slate-500'
                      }`}
                    >
                      {isAddingLabel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Custom types use zero-shot detection. Clear, concrete labels (like "enrollment number") work better than vague ones.
                  </p>
                </div>
              )}

              {/* ── Threshold Setting ─────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    Scanner Sensitivity
                  </label>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    {threshold}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Adjust the detection threshold. Lower values catch more PII but may include false positives. Higher values are stricter.
                </p>
                <div className="rounded-xl bg-slate-800/30 border border-slate-700/20 p-4">
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.05"
                    value={threshold}
                    onChange={handleThresholdChange}
                    className="w-full accent-emerald-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-2">
                    <span>More Sensitive</span>
                    <span>Stricter</span>
                  </div>
                </div>
              </div>

              {/* ── Pronoun Filter Setting ────────────────────────── */}
              <div>
                <button
                  onClick={handleIgnorePronounsToggle}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/30 border border-slate-700/20 hover:bg-slate-700/30 transition-colors group"
                >
                  <div className="text-left">
                    <label className="text-sm font-medium text-slate-300 group-hover:text-emerald-400 transition-colors cursor-pointer block">
                      Ignore Common Pronouns & Generics
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      Skip words like "I", "you", "he", "team", "company" to avoid false positive matches.
                    </p>
                  </div>
                  <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-4 ${ignorePronouns ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${ignorePronouns ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                  </div>
                </button>
              </div>

              {/* ── AI Chat: API keys ─────────────────────────────── */}
              <div ref={chatSectionRef}>
                {required && (
                  <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-300">Connect a chat model below — an API key, a custom endpoint, or a running Ollama.</p>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-1">
                  <Key className="w-4 h-4 text-emerald-400" />
                  AI Chat — Providers
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Optional. Chat sends only redacted text, directly to the provider you pick. Keys are stored locally and never shared.
                </p>
                <div className="space-y-3">
                  {KEY_PROVIDERS.map((p) => {
                    const info = keysInfo[p.id];
                    const hasKey = info?.set;
                    return (
                      <div key={p.id} className="rounded-xl bg-slate-800/30 border border-slate-700/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-white">{p.label}</span>
                          {hasKey && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                {info.masked}
                              </span>
                              <button
                                onClick={() => handleRemoveKey(p.id)}
                                disabled={isSaving === p.id}
                                className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/15 transition-colors"
                                title="Remove key"
                              >
                                <Trash2 className="w-3 h-3 text-slate-500 hover:text-red-400" />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={keyInputs[p.id] || ''}
                            onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder={hasKey ? 'Enter new key to replace…' : p.placeholder}
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 transition-colors"
                          />
                          <button
                            onClick={() => handleSaveKey(p.id)}
                            disabled={!keyInputs[p.id]?.trim() || isSaving === p.id}
                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                              keyInputs[p.id]?.trim()
                                ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                                : 'bg-slate-700/50 text-slate-500'
                            }`}
                          >
                            {isSaving === p.id ? '…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Ollama */}
                  <div className="rounded-xl bg-slate-800/30 border border-slate-700/20 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-white">Ollama (fully local)</span>
                        <p className="text-xs text-slate-500 mt-0.5">No key needed — models on this Mac are detected automatically.</p>
                      </div>
                      {ollamaModels === null ? (
                        <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                      ) : ollamaModels.length > 0 ? (
                        <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                          {ollamaModels.length} model{ollamaModels.length > 1 ? 's' : ''} found
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full flex-shrink-0">not running</span>
                      )}
                    </div>
                  </div>

                  {/* Custom endpoint */}
                  <div className="rounded-xl bg-slate-800/30 border border-slate-700/20 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-sm font-medium text-white">Custom OpenAI-compatible endpoint</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-2">LM Studio, llama.cpp, vLLM, OpenRouter, or any server that speaks the OpenAI API.</p>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={customBaseUrl}
                        onChange={(e) => setCustomBaseUrl(e.target.value)}
                        placeholder="http://localhost:1234/v1"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 transition-colors font-mono"
                      />
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={customApiKey}
                          onChange={(e) => setCustomApiKey(e.target.value)}
                          placeholder="API key (optional)"
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/30 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 transition-colors"
                        />
                        <button
                          onClick={handleSaveCustomEndpoint}
                          className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-400 transition-all"
                        >
                          {customSaved ? <CheckCircle className="w-3.5 h-3.5" /> : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── App Updates ───────────────────────────────────── */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-3">
                  <Download className="w-4 h-4 text-emerald-400" />
                  Updates
                </label>
                <div className="rounded-xl bg-slate-800/30 border border-slate-700/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-white">Current version</span>
                      <span className="ml-2 text-xs font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full">v{APP_VERSION}</span>
                    </div>
                    <button
                      onClick={handleCheckForUpdate}
                      disabled={isCheckingUpdate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                      {isCheckingUpdate ? 'Checking…' : 'Check for updates'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Checks GitHub Releases only when you click — the app never phones home on its own.
                  </p>

                  {updateAvailable && (
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-sm text-emerald-300">
                          v{latestVersion} available
                        </span>
                      </div>
                      <button
                        onClick={() => updateDownloadUrl && openUrl(updateDownloadUrl)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                    </div>
                  )}

                  {updateCheckResult === 'up-to-date' && !updateAvailable && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-slate-300">You're on the latest version</span>
                    </div>
                  )}

                  {updateCheckResult === 'error' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-xs text-red-300">Could not check for updates</span>
                    </div>
                  )}

                  <button
                    onClick={() => openUrl(GITHUB_URL)}
                    className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Source code & issues on GitHub
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
