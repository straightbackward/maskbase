import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Shield, Cloud, ArrowRight } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

export default function InfoPage() {
  const { showInfo, setShowInfo } = useAppStore();

  return (
    <AnimatePresence>
      {showInfo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center"
        >
          {/* Close button */}
          <button
            onClick={() => setShowInfo(false)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>

          <div className="max-w-3xl w-full mx-6">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <h2 className="text-2xl font-bold text-white text-center mb-8">
                How MaskBase Protects You
              </h2>

              {/* Diagram */}
              <div className="flex items-stretch gap-4">
                {/* Your Computer */}
                <div className="flex-1 rounded-2xl border-2 border-dashed border-blue-500/30 bg-blue-500/5 p-5">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-4">
                    Your Computer
                  </h3>

                  {/* Your Files */}
                  <div className="rounded-xl bg-slate-900/80 border border-slate-700/50 p-4 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-semibold text-white">Your Files</span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono bg-slate-800/60 rounded-lg p-3">
                      <p>Name: <span className="text-red-400">John Smith</span></p>
                      <p>SSN: <span className="text-red-400">123-45-6789</span></p>
                      <p>Card: <span className="text-red-400">4242-4242-4242-7821</span></p>
                    </div>
                  </div>

                  {/* Arrow down */}
                  <div className="flex justify-center my-2">
                    <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
                  </div>

                  {/* MaskBase */}
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-semibold text-white">MaskBase</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                        Runs locally
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono bg-slate-800/60 rounded-lg p-3">
                      <p>Name: <span className="text-emerald-400">[PERSON_1]</span></p>
                      <p>SSN: <span className="text-emerald-400">[US_SSN_1]</span></p>
                      <p>Card: <span className="text-emerald-400">[CREDIT_CARD_1]</span></p>
                    </div>
                  </div>
                </div>

                {/* Arrow: "Only safe data" */}
                <div className="flex flex-col items-center justify-center gap-2 px-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="text-xs text-emerald-400 font-medium whitespace-nowrap">Only safe data</span>
                  </div>
                  <ArrowRight className="w-6 h-6 text-emerald-400" />
                </div>

                {/* Cloud / AI */}
                <div className="flex-1 rounded-2xl border-2 border-dashed border-violet-500/30 bg-violet-500/5 p-5 flex flex-col justify-center">
                  <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wider mb-4">
                    AI Provider (optional)
                  </h3>

                  <div className="rounded-xl bg-slate-900/80 border border-slate-700/50 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Cloud className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-semibold text-white">Only sees redacted, safe data</span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono bg-slate-800/60 rounded-lg p-3">
                      <p>Name: <span className="text-emerald-400">[PERSON_1]</span></p>
                      <p>SSN: <span className="text-emerald-400">[US_SSN_1]</span></p>
                      <p>Card: <span className="text-emerald-400">[CREDIT_CARD_1]</span></p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom note */}
              <p className="text-center text-sm text-slate-400 mt-8">
                MaskBase runs <strong className="text-white">on your device</strong> — your private data never leaves.
                Sharing with an AI is optional, and even then only redacted text is sent.
              </p>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

