import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Cpu, Eye, AlertTriangle } from 'lucide-react';

const WELCOME_VERSION = '2.0';
const STORAGE_KEY = 'maskbase_welcome_seen';

export function hasSeenWelcome(): boolean {
  return localStorage.getItem(STORAGE_KEY) === WELCOME_VERSION;
}

export function markWelcomeSeen(): void {
  localStorage.setItem(STORAGE_KEY, WELCOME_VERSION);
}

interface WelcomeModalProps {
  isOpen: boolean;
  onAccept: () => void;
}

export default function WelcomeModal({ isOpen, onAccept }: WelcomeModalProps) {
  const handleAccept = () => {
    markWelcomeSeen();
    onAccept();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg mx-4 rounded-2xl bg-slate-900 border border-slate-700/50 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800/50 flex-shrink-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Welcome to MaskBase</h3>
                <p className="text-xs text-slate-400">Open-source, local-first PII redaction</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
                <Cpu className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white mb-1">Everything runs on your device</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Documents are scanned by a small language model running locally. There is no account,
                    no telemetry, and no server — your files and the detected PII never leave this Mac.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
                <Eye className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white mb-1">You stay in the loop</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Every detection is shown for review before redaction is applied. You can toggle
                    individual findings, select missed text to redact it, and add custom entity types.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
                <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white mb-1">AI chat is optional — and bring-your-own</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    If you choose to chat about a document, only the redacted text is sent — to a provider
                    you configure yourself (your own API key, or a fully local model via Ollama).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white mb-1">No detector is perfect</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Automated PII detection can miss things. Always review the result before sharing a
                    redacted document — that's what the review step is for.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-800/50 flex-shrink-0">
              <button
                onClick={handleAccept}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-all"
              >
                Get Started
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
