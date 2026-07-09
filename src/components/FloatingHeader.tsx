import { motion } from 'framer-motion';
import { Lock, Info, Settings } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { MaskSymbol } from './MaskSymbol';

interface FloatingHeaderProps {
  onOpenSettings: () => void;
}

export default function FloatingHeader({ onOpenSettings }: FloatingHeaderProps) {
  const { backendReady, setShowInfo, stage } = useAppStore();

  if (stage !== 'scanning' && stage !== 'manifest') return null;

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 shadow-2xl">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center">
            <MaskSymbol size="sm" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">MaskBase</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">PII Redaction</p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-700/50" />

        {/* Status badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800/60">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                backendReady ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'
              }`}
            />
            <span className="text-[10px] text-slate-400">
              {backendReady ? 'Online' : 'Starting...'}
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-800/60">
            <Lock className="w-2.5 h-2.5 text-slate-400" />
            <span className="text-[10px] text-slate-400">100% Local</span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-700/50" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenSettings}
            className="w-7 h-7 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button
            onClick={() => setShowInfo(true)}
            className="w-7 h-7 rounded-full bg-slate-800/60 border border-slate-700/40 flex items-center justify-center hover:bg-slate-700/60 transition-colors"
          >
            <Info className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>
    </motion.header>
  );
}
