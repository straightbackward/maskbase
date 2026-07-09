import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { DetectedEntity } from '../types';
import {
  DocxHighlightRange,
  applyDocxHighlights,
  clearHighlights,
  computeDocxHighlights,
} from '../lib/docxHighlights';

const BASE_URL = 'http://127.0.0.1:22140';

const ENTITY_LABELS: Record<string, string> = {
  PERSON: 'Person', EMAIL_ADDRESS: 'Email', PHONE_NUMBER: 'Phone',
  LOCATION: 'Address', CREDIT_CARD: 'Credit Card', US_SSN: 'SSN',
  DATE_OF_BIRTH: 'Date of Birth', PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License", IP_ADDRESS: 'IP Address',
  URL: 'URL', BANK_ACCOUNT: 'Bank Account', MEDICAL_RECORD: 'Medical Record',
  ORGANIZATION: 'Organization', INSURANCE_ID: 'Insurance',
  ROUTING_NUMBER: 'Routing Number', TAX_ID: 'Tax ID',
  NATIONAL_ID: 'National ID', VEHICLE_REGISTRATION: 'Vehicle Reg.',
  CUSTOM: 'Custom',
};

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

interface ReviewDocxViewerProps {
  sessionId: string;
  detectedEntities: DetectedEntity[];
  onToggleIndices: (indices: number[]) => void;
  onAddCustom: (text: string) => void;
}

export default function ReviewDocxViewer({
  sessionId,
  detectedEntities,
  onToggleIndices,
  onAddCustom,
}: ReviewDocxViewerProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);

  const fileUrl = `${BASE_URL}/sessions/${sessionId}/original-file`;

  const enabledMap = useMemo(
    () => detectedEntities.map((e) => e.enabled),
    [detectedEntities],
  );

  // Structural key: ignores the mutable `enabled` flag so toggling doesn't
  // trigger a full re-render of the DOCX.
  const structuralKey = useMemo(
    () => detectedEntities.map((e) => `${e.entity_type}|${e.text}`).join('\u0000'),
    [detectedEntities],
  );

  const enabledMapRef = useRef(enabledMap);
  enabledMapRef.current = enabledMap;

  const buildReviewMark = useCallback((text: string, range: DocxHighlightRange): HTMLElement => {
    const mark = document.createElement('mark');
    mark.className = 'pii-review';
    const pretty = ENTITY_LABELS[range.label] || range.label.replace(/_/g, ' ');
    const anyEnabled = range.entityIndices.some((i) => enabledMapRef.current[i]);
    const hoverLabel = anyEnabled
      ? `${pretty} \u2014 click to keep visible`
      : `${pretty} \u2014 click to redact`;
    mark.setAttribute('data-label', hoverLabel);
    mark.setAttribute('data-indices', range.entityIndices.join(','));
    mark.setAttribute('data-enabled', anyEnabled ? '1' : '0');
    mark.textContent = text;
    return mark;
  }, []);

  // Render the DOCX once
  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return;
    let cancelled = false;
    setLoading(true);
    setRendered(false);
    setLoadError(false);

    (async () => {
      try {
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;
        body.innerHTML = '';
        styles.innerHTML = '';
        await renderAsync(blob, body, styles, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        setLoading(false);
        setRendered(true);
      } catch (err) {
        console.error('[ReviewDocxViewer] load failed:', err);
        if (!cancelled) {
          setLoading(false);
          setLoadError(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [fileUrl]);

  // Apply highlights whenever the entity set or enabled map changes.
  // structuralKey + enabledMap together capture both cases.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !rendered) return;
    clearHighlights(body, 'pii-review');
    if (detectedEntities.length === 0) return;
    const ranges = computeDocxHighlights(body, detectedEntities);
    applyDocxHighlights(body, ranges, buildReviewMark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, structuralKey, enabledMap, buildReviewMark]);

  // Observe the scroll container and measure the intrinsic page width so we
  // can auto-fit the rendered DOCX to the panel width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!rendered) return;
    const body = bodyRef.current;
    if (!body) return;
    const firstPage = body.querySelector('section') as HTMLElement | null;
    if (firstPage && firstPage.offsetWidth > 0) {
      setPageWidth(firstPage.offsetWidth);
    }
  }, [rendered]);

  // Click delegation for entity toggles
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const mark = target.closest('mark.pii-review') as HTMLElement | null;
      if (!mark) return;
      ev.preventDefault();
      ev.stopPropagation();
      const raw = mark.getAttribute('data-indices') || '';
      const indices = raw.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
      if (indices.length) onToggleIndices(indices);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [onToggleIndices]);

  // Track text selection for the "Redact selection" floating button
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const raw = sel.toString();
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text.length < 2) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setSelection({
        text,
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top - containerRect.top,
      });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => setSelection(null);
    container.addEventListener('scroll', onScroll, true);
    return () => container.removeEventListener('scroll', onScroll, true);
  }, []);

  const handleAddSelection = useCallback(() => {
    if (!selection) return;
    onAddCustom(selection.text);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, [selection, onAddCustom]);

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100 rounded-lg">
        <div className="text-sm text-slate-500">Could not load DOCX preview.</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-100 rounded-lg flex flex-col overflow-hidden"
    >
      {selection && (() => {
        const halfWidth = 80;
        const containerW = containerRef.current?.clientWidth ?? 800;
        const clampedX = Math.max(halfWidth + 4, Math.min(selection.x, containerW - halfWidth - 4));
        const top = Math.max(8, selection.y - 42);
        return (
          <button
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={handleAddSelection}
            style={{ position: 'absolute', left: clampedX, top, transform: 'translateX(-50%)' }}
            className="z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-medium shadow-xl border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Redact selection
          </button>
        );
      })()}

      <div className="sticky top-0 z-10 flex items-center justify-center py-2 flex-shrink-0">
        <div className="flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg px-3 py-1.5 shadow-sm border border-slate-200">
          <button
            onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))}
            className="p-1 hover:bg-slate-100 rounded transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-xs text-slate-500 w-12 text-center font-medium">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)))}
            className="p-1 hover:bg-slate-100 rounded transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          <span className="ml-2 text-sm text-slate-500">Loading DOCX…</span>
        </div>
      )}

      <div ref={styleRef} style={{ display: 'none' }} />

      {(() => {
        // Fit-to-width × user zoom via CSS `zoom` (not transform) so the
        // layout box shrinks. When the zoomed width exceeds the scroll
        // container, set `minWidth` on the centering wrapper so horizontal
        // scroll can reach the content's left edge.
        const available = containerWidth > 0 ? containerWidth - 16 : 0;
        const fit = available > 0 && pageWidth > 0
          ? Math.min(1, available / pageWidth)
          : 1;
        const effectiveZoom = fit * scale;
        const scaledWidth = pageWidth * effectiveZoom;
        const overflowMinWidth = scaledWidth > available ? scaledWidth + 16 : undefined;
        return (
          <div ref={scrollRef} className="flex-1 overflow-auto">
            <div
              className="flex justify-center py-4"
              style={{ minWidth: overflowMinWidth }}
            >
              <div style={{ zoom: effectiveZoom }}>
                <div ref={bodyRef} />
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        .pii-review {
          position: relative;
          border-radius: 3px;
          padding: 1px 3px;
          margin: 0 -1px;
          cursor: pointer;
          transition: background 0.15s ease, box-shadow 0.15s ease;
          pointer-events: auto;
        }
        .pii-review[data-enabled="1"] {
          background: rgba(15, 23, 42, 0.78);
          color: transparent;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .pii-review[data-enabled="1"]:hover {
          background: rgba(15, 23, 42, 0.55);
        }
        .pii-review[data-enabled="0"] {
          background: rgba(16, 185, 129, 0.14);
          color: inherit;
          box-shadow: inset 0 -2px 0 rgba(16, 185, 129, 0.55);
        }
        .pii-review[data-enabled="0"]:hover {
          background: rgba(16, 185, 129, 0.28);
        }
        .pii-review::before {
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
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .pii-review::after {
          content: '';
          position: absolute;
          bottom: calc(100% + 2px);
          left: 50%;
          transform: translateX(-50%) scale(0.92);
          border: 4px solid transparent;
          border-top-color: #0f172a;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.12s ease, transform 0.12s ease;
          z-index: 100;
        }
        .pii-review:hover::before,
        .pii-review:hover::after {
          opacity: 1;
          transform: translateX(-50%) scale(1);
        }
      `}</style>
    </div>
  );
}
