import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+?)_(\d+)\]/g;

function Badge({ placeholder, realValue }: { placeholder: string; realValue?: string }) {
  const [hovered, setHovered] = useState(false);
  const match = placeholder.match(/\[REDACTED_([A-Z_]+?)_(\d+)\]/);
  const label = match ? `${match[1]}_${match[2]}` : placeholder;
  return (
    <span className="relative inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-mono cursor-help">
        <ShieldCheck className="w-3 h-3" />{label}
      </span>
      {hovered && realValue && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-xs whitespace-nowrap shadow-xl z-50 max-w-[360px] overflow-hidden text-ellipsis">
          <span className="text-slate-400 mr-1">Original:</span>
          <span className="font-semibold text-emerald-300">{realValue}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 rotate-45 bg-slate-700 border-r border-b border-slate-600" />
        </span>
      )}
    </span>
  );
}

interface RedactedTextProps {
  text: string;
  replacementMap?: Record<string, string>;
}

/** Renders redacted text with [REDACTED_*] placeholders shown as badges.
 *  Hovering a badge reveals the original value (restored locally). */
export default function RedactedText({ text, replacementMap = {} }: RedactedTextProps) {
  const parts: React.ReactNode[] = [];
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<Badge key={`ph-${match.index}`} placeholder={match[0]} realValue={replacementMap[match[0]]} />);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
      {parts.length > 0 ? parts : text}
    </div>
  );
}
