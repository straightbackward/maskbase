import { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DetectedEntity, OcrLine, CustomArea } from '../types';

const BASE_URL = 'http://127.0.0.1:22140';

interface ReviewImageViewerProps {
  sessionId: string;
  detectedEntities: DetectedEntity[];
  ocrLines: OcrLine[];
  customAreas: CustomArea[];
  onToggleIndices: (indices: number[]) => void;
  onAddArea: (area: CustomArea) => void;
  onRemoveArea: (index: number) => void;
}

/** One clickable highlight rectangle over the image, in % of natural size. */
interface Segment {
  entityIndex: number;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Review surface for scanned images: renders the original image with the
 * OCR-detected PII spans overlaid as clickable highlights, mirroring the PDF
 * viewer's blackout/toggle interaction. Entity positions inside a line are
 * interpolated proportionally from character offsets — close enough for
 * highlight placement.
 *
 * Dragging on the image draws a manual redaction area (for signatures,
 * photos, or anything OCR missed); clicking an area removes it.
 */
export default function ReviewImageViewer({
  sessionId,
  detectedEntities,
  ocrLines,
  customAreas,
  onToggleIndices,
  onAddArea,
  onRemoveArea,
}: ReviewImageViewerProps) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dragRect, setDragRect] = useState<CustomArea | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const fileUrl = `${BASE_URL}/sessions/${sessionId}/original-file`;

  const segments = useMemo<Segment[]>(() => {
    if (!natural || ocrLines.length === 0) return [];
    const segs: Segment[] = [];
    detectedEntities.forEach((e, entityIndex) => {
      if (e.start < 0) return; // custom entities have no position
      for (const line of ocrLines) {
        const os = Math.max(e.start, line.start);
        const oe = Math.min(e.end, line.end);
        const lineLen = line.end - line.start;
        if (oe <= os || lineLen <= 0) continue;
        const fx0 = (os - line.start) / lineLen;
        const fx1 = (oe - line.start) / lineLen;
        const x0 = line.x0 + fx0 * (line.x1 - line.x0);
        const x1 = line.x0 + fx1 * (line.x1 - line.x0);
        // Small padding so the cover doesn't clip glyph edges
        const padX = (line.x1 - line.x0) * 0.01 + 2;
        const padY = (line.y1 - line.y0) * 0.05 + 1;
        segs.push({
          entityIndex,
          label: e.entity_type,
          left: ((x0 - padX) / natural.w) * 100,
          top: ((line.y0 - padY) / natural.h) * 100,
          width: ((x1 - x0 + padX * 2) / natural.w) * 100,
          height: ((line.y1 - line.y0 + padY * 2) / natural.h) * 100,
        });
      }
    });
    return segs;
  }, [natural, ocrLines, detectedEntities]);

  /** Mouse position → original image pixel coordinates, clamped. */
  const toNatural = (e: { clientX: number; clientY: number }) => {
    const el = wrapperRef.current;
    if (!el || !natural) return null;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    return {
      x: Math.max(0, Math.min(natural.w, x)),
      y: Math.max(0, Math.min(natural.h, y)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !natural) return;
    const p = toNatural(e);
    if (!p) return;
    e.preventDefault();
    dragStart.current = p;

    const onMove = (ev: MouseEvent) => {
      const q = toNatural(ev);
      const s = dragStart.current;
      if (!q || !s) return;
      setDragRect({
        x0: Math.min(s.x, q.x),
        y0: Math.min(s.y, q.y),
        x1: Math.max(s.x, q.x),
        y1: Math.max(s.y, q.y),
      });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const q = toNatural(ev);
      const s = dragStart.current;
      dragStart.current = null;
      setDragRect(null);
      if (!q || !s || !natural) return;
      const area: CustomArea = {
        x0: Math.min(s.x, q.x),
        y0: Math.min(s.y, q.y),
        x1: Math.max(s.x, q.x),
        y1: Math.max(s.y, q.y),
      };
      // Ignore accidental clicks — require a real rectangle (~6px on screen)
      const el = wrapperRef.current;
      const minPx = el ? (6 / el.getBoundingClientRect().width) * natural.w : 8;
      if (area.x1 - area.x0 < minPx || area.y1 - area.y0 < minPx) return;
      onAddArea(area);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const pct = (a: CustomArea) =>
    natural
      ? {
          left: `${(a.x0 / natural.w) * 100}%`,
          top: `${(a.y0 / natural.h) * 100}%`,
          width: `${((a.x1 - a.x0) / natural.w) * 100}%`,
          height: `${((a.y1 - a.y0) / natural.h) * 100}%`,
        }
      : undefined;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div
        ref={wrapperRef}
        onMouseDown={handleMouseDown}
        className="relative mx-auto max-w-3xl cursor-crosshair"
      >
        {!natural && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          </div>
        )}
        <img
          src={fileUrl}
          alt="Scanned document"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          className={`w-full h-auto rounded-lg border border-slate-800 select-none ${natural ? '' : 'hidden'}`}
        />
        {segments.map((s, i) => {
          const enabled = detectedEntities[s.entityIndex]?.enabled !== false;
          return (
            <div
              key={i}
              role="button"
              data-label={s.label}
              data-enabled={enabled ? '1' : '0'}
              className="pii-img-mark"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.width}%`,
                height: `${s.height}%`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onToggleIndices([s.entityIndex])}
            />
          );
        })}
        {natural &&
          customAreas.map((a, i) => (
            <div
              key={`area-${i}`}
              role="button"
              data-label="MANUAL AREA — click to remove"
              data-enabled="1"
              className="pii-img-mark"
              style={pct(a)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onRemoveArea(i)}
            />
          ))}
        {dragRect && natural && (
          <div className="absolute rounded-[3px] bg-emerald-500/15 border-2 border-dashed border-emerald-400 pointer-events-none" style={pct(dragRect)} />
        )}
      </div>
      {natural && (
        <p className="text-center text-[11px] text-slate-500 mt-3">
          Click a highlight to toggle it · drag anywhere on the image to redact an area
        </p>
      )}

      <style>{`
        .pii-img-mark {
          position: absolute;
          border-radius: 3px;
          cursor: pointer;
          transition: background 0.15s ease, box-shadow 0.15s ease;
        }
        .pii-img-mark[data-enabled="1"] {
          background: rgba(15, 23, 42, 0.92);
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        }
        .pii-img-mark[data-enabled="1"]:hover {
          background: rgba(15, 23, 42, 0.7);
        }
        .pii-img-mark[data-enabled="0"] {
          background: rgba(16, 185, 129, 0.18);
          box-shadow: inset 0 0 0 1.5px rgba(16, 185, 129, 0.6);
        }
        .pii-img-mark[data-enabled="0"]:hover {
          background: rgba(16, 185, 129, 0.32);
        }
        .pii-img-mark::before {
          content: attr(data-label);
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%) scale(0.92);
          padding: 4px 10px;
          background: #0f172a;
          color: #e2e8f0;
          font-size: 10px;
          font-family: ui-monospace, monospace;
          line-height: 1.4;
          border-radius: 6px;
          border: 1px solid #1e293b;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.12s ease, transform 0.12s ease;
          z-index: 10;
        }
        .pii-img-mark:hover::before {
          opacity: 1;
          transform: translateX(-50%) scale(1);
        }
      `}</style>
    </div>
  );
}
