import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, ZoomIn, ZoomOut, Plus } from 'lucide-react';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// ?worker&inline bundles the worker code into the JS and spawns it from a
// blob: URL — no network fetch. This is required in the Tauri prod webview:
// the page origin is the custom scheme tauri://localhost, and WKWebView does
// not service custom-protocol requests made from worker threads, so any
// URL-based worker load (workerSrc or ?worker) hangs forever with no error.
// Legacy build for older-WebKit compat (macOS Ventura). Each <Document> gets
// its own PDFWorker instance (see documentOptions below): react-pdf destroys
// the loading task's worker on unmount, and a shared worker/port would kill
// PDF loading for every Document mounted afterwards.
import PdfWorkerInline from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';
import { DetectedEntity } from '../types';
import {
  Highlight,
  PageInfo,
  computePageHighlights,
  escapeHtml,
} from '../lib/pdfHighlights';

// cmaps + standard fonts are copied into public/pdfjs/ by `npm run assets:pdfjs`.
const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
} as const;

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

function markHtml(text: string, hl: Highlight, enabled: boolean): string {
  const prettyLabel = ENTITY_LABELS[hl.label] || hl.label.replace(/_/g, ' ');
  const hoverLabel = enabled
    ? `${prettyLabel} \u2014 click to keep visible`
    : `${prettyLabel} \u2014 click to redact`;
  const indices = hl.entityIndices.join(',');
  return `<mark class="pii-review" data-label="${escapeHtml(hoverLabel)}" data-indices="${indices}" data-enabled="${enabled ? '1' : '0'}">${text}</mark>`;
}

/** Walk the text-layer spans and inject clickable highlight marks. */
function applyHighlightsToDOM(
  container: HTMLElement,
  highlights: Highlight[],
  itemOffsets: { start: number; end: number }[],
  enabledMap: boolean[],
) {
  const textLayer = container.querySelector('.react-pdf__Page__textContent');
  if (!textLayer) return;

  const spans = textLayer.querySelectorAll<HTMLSpanElement>('span:not(.markedContent)');

  for (let idx = 0; idx < spans.length && idx < itemOffsets.length; idx++) {
    const span = spans[idx];
    const io = itemOffsets[idx];
    const text = span.textContent || '';

    const overlapping = highlights
      .filter((h) => h.localStart < io.end && h.localEnd > io.start)
      .sort((a, b) => a.localStart - b.localStart);
    if (overlapping.length === 0) continue;

    // Merge overlapping ranges, combining their entity indices.
    const merged: Highlight[] = [{ ...overlapping[0], entityIndices: [...overlapping[0].entityIndices] }];
    for (let k = 1; k < overlapping.length; k++) {
      const cur = overlapping[k];
      const last = merged[merged.length - 1];
      if (cur.localStart <= last.localEnd) {
        if (cur.localEnd > last.localEnd) last.localEnd = cur.localEnd;
        for (const ei of cur.entityIndices) {
          if (!last.entityIndices.includes(ei)) last.entityIndices.push(ei);
        }
      } else {
        merged.push({ ...cur, entityIndices: [...cur.entityIndices] });
      }
    }

    let result = '';
    let cursor = 0;
    for (const hl of merged) {
      const hlStart = Math.max(0, hl.localStart - io.start);
      const hlEnd = Math.min(text.length, hl.localEnd - io.start);
      if (hlStart > cursor) result += escapeHtml(text.slice(cursor, hlStart));
      // A merged region is "enabled" if any of its constituent entities is enabled.
      const anyEnabled = hl.entityIndices.some((i) => enabledMap[i]);
      result += markHtml(escapeHtml(text.slice(hlStart, hlEnd)), hl, anyEnabled);
      cursor = hlEnd;
    }
    if (cursor < text.length) result += escapeHtml(text.slice(cursor));
    span.innerHTML = result;
  }
}

function ReviewPage({
  pageNumber,
  width,
  highlights,
  itemOffsets,
  enabledMap,
  onToggleIndices,
}: {
  pageNumber: number;
  width: number;
  highlights: Highlight[];
  itemOffsets: { start: number; end: number }[];
  enabledMap: boolean[];
  onToggleIndices: (indices: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hlRef = useRef(highlights);
  const ioRef = useRef(itemOffsets);
  const enRef = useRef(enabledMap);
  hlRef.current = highlights;
  ioRef.current = itemOffsets;
  enRef.current = enabledMap;

  const paint = useCallback(() => {
    if (!ref.current || hlRef.current.length === 0) return;
    applyHighlightsToDOM(ref.current, hlRef.current, ioRef.current, enRef.current);
  }, []);

  const onTextLayerReady = useCallback(() => {
    requestAnimationFrame(paint);
  }, [paint]);

  // Repaint when highlight data or enabled states change
  useEffect(() => {
    if (!ref.current) return;
    const tl = ref.current.querySelector('.react-pdf__Page__textContent');
    if (!tl || tl.children.length === 0) return;
    paint();
  }, [highlights, itemOffsets, enabledMap, paint]);

  // Click delegation for entity toggles
  useEffect(() => {
    const el = ref.current;
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

  return (
    <div ref={ref} className="shadow-lg mb-4 rounded overflow-hidden">
      <Page
        pageNumber={pageNumber}
        width={width}
        renderAnnotationLayer={false}
        onRenderTextLayerSuccess={onTextLayerReady}
      />
    </div>
  );
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

interface ReviewPdfViewerProps {
  sessionId: string;
  detectedEntities: DetectedEntity[];
  onToggleIndices: (indices: number[]) => void;
  onAddCustom: (text: string) => void;
}

export default function ReviewPdfViewer({
  sessionId,
  detectedEntities,
  onToggleIndices,
  onAddCustom,
}: ReviewPdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const [pageInfoMap, setPageInfoMap] = useState<Map<number, PageInfo>>(new Map());

  const fileUrl = `${BASE_URL}/sessions/${sessionId}/original-file`;

  // One worker per viewer instance, torn down on unmount. Passed to pdf.js via
  // documentOptions so it never touches the global worker configuration.
  const pdfWorker = useMemo(
    () => new pdfjs.PDFWorker({ port: new PdfWorkerInline() as unknown as null }),
    [],
  );
  useEffect(() => () => pdfWorker.destroy(), [pdfWorker]);
  const documentOptions = useMemo(
    () => ({ ...PDF_DOCUMENT_OPTIONS, worker: pdfWorker }),
    [pdfWorker],
  );

  const enabledMap = useMemo(() => detectedEntities.map((e) => e.enabled), [detectedEntities]);

  // Structural key: ignores the mutable `enabled` flag so toggling a highlight
  // doesn't trigger a full PDF-text re-extraction.
  const structuralKey = useMemo(
    () => detectedEntities.map((e) => `${e.entity_type}|${e.text}`).join('\u0000'),
    [detectedEntities],
  );
  const entitiesRef = useRef(detectedEntities);
  entitiesRef.current = detectedEntities;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const baseWidth = containerWidth > 0 ? containerWidth - 48 : 700;
  const pageWidth = baseWidth * scale;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onLoadSuccess = useCallback((pdf: any) => {
    setNumPages(pdf.numPages);
    setLoading(false);
    pdfDocRef.current = pdf;
  }, []);

  const onLoadError = useCallback(() => {
    setLoading(false);
    setLoadError(true);
  }, []);

  // Use ALL entities (not just enabled ones) so that disabled entities remain
  // clickable for re-enabling. Highlight data is enabled-agnostic; the visual
  // state comes from enabledMap at paint time. Depend on structuralKey (not
  // the detectedEntities array ref) so toggling doesn't re-extract PDF text.
  useEffect(() => {
    const doc = pdfDocRef.current;
    const ents = entitiesRef.current;
    if (!doc || numPages === 0 || ents.length === 0) return;
    let cancelled = false;
    computePageHighlights(doc, numPages, ents)
      .then((m) => { if (!cancelled) setPageInfoMap(m); })
      .catch((err) => console.error('[ReviewPdfViewer] highlight computation failed:', err));
    return () => { cancelled = true; };
  }, [numPages, structuralKey]);

  // Track text selection inside the viewer so we can offer a "Redact selection"
  // floating button for arbitrary text the auto-detector missed.
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
      // Only react to selections that are (at least partly) inside the viewer.
      if (!container.contains(range.commonAncestorContainer)) {
        return;
      }
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

  // Clear the selection popover if the user scrolls the PDF — the saved
  // coordinates would point to a stale location otherwise.
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
        <div className="text-sm text-slate-500">Could not load PDF preview.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-slate-100 rounded-lg flex flex-col overflow-hidden">
      {selection && (() => {
        const halfWidth = 80;
        const containerW = containerRef.current?.clientWidth ?? 800;
        const clampedX = Math.max(halfWidth + 4, Math.min(selection.x, containerW - halfWidth - 4));
        const top = Math.max(8, selection.y - 42);
        return (
          <button
            onMouseDown={(e) => {
              // Prevent mousedown from clearing the selection before our click fires.
              e.preventDefault();
            }}
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
          <span className="ml-2 text-sm text-slate-500">Loading PDF…</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div
          className="flex flex-col items-center px-6 pb-6"
          style={{ minWidth: pageWidth > baseWidth ? pageWidth + 48 : undefined }}
        >
          <Document
            file={fileUrl}
            options={documentOptions}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            loading={null}
          >
            {Array.from({ length: numPages }, (_, i) => {
              const info = pageInfoMap.get(i);
              return (
                <ReviewPage
                  key={i}
                  pageNumber={i + 1}
                  width={pageWidth}
                  highlights={info?.highlights ?? []}
                  itemOffsets={info?.itemOffsets ?? []}
                  enabledMap={enabledMap}
                  onToggleIndices={onToggleIndices}
                />
              );
            })}
          </Document>
        </div>
      </div>

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
        .react-pdf__Page__textContent {
          pointer-events: auto;
        }
        .react-pdf__Page__textContent span {
          pointer-events: auto;
        }
      `}</style>
    </div>
  );
}
