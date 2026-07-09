import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, ShieldCheck, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// ?worker&inline spawns the worker from a blob: URL with no network fetch —
// required in the Tauri prod webview, where WKWebView never services
// custom-protocol (tauri://) requests made from worker threads, so URL-based
// worker loads hang forever. One PDFWorker per viewer instance: a shared
// worker/port dies on the first <Document> unmount. See ReviewPdfViewer.tsx.
import PdfWorkerInline from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline';
import { getDownloadUrl } from '../services/api';
import { ChatDocument, DetectedEntity } from '../types';
import {
  Highlight,
  PageInfo,
  computePageHighlights,
  escapeHtml,
} from '../lib/pdfHighlights';
import DocxDocumentViewer from './DocxDocumentViewer';

const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
} as const;

const BASE_URL = 'http://127.0.0.1:22140';

const PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+?)_(\d+)\]/g;

function isPdf(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf');
}

function isDocx(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.docx');
}

// ── Placeholder badge for text-mode fallback ────────────────────────────

function PlaceholderBadge({ placeholder, realValue }: { placeholder: string; realValue?: string }) {
  const [hovered, setHovered] = useState(false);
  const match = placeholder.match(/\[REDACTED_([A-Z_]+?)_(\d+)\]/);
  const label = match ? `${match[1]}_${match[2]}` : placeholder;
  return (
    <span className="relative inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-600 text-xs font-mono cursor-help">
        <ShieldCheck className="w-3 h-3" />{label}
      </span>
      {hovered && realValue && realValue !== placeholder && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-xs whitespace-nowrap shadow-xl z-50">
          <span className="text-slate-400 mr-1">Original:</span>
          <span className="font-semibold text-emerald-300">{realValue}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 rotate-45 bg-slate-700 border-r border-b border-slate-600" />
        </span>
      )}
    </span>
  );
}

function renderLine(line: string, lineIndex: number, placeholderMap: Record<string, string>) {
  const trimmed = line.trim();
  if (!trimmed) return <div key={lineIndex} className="h-4" />;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0, match;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) parts.push(<span key={`t-${lastIndex}`} className="text-slate-800">{line.slice(lastIndex, match.index)}</span>);
    parts.push(<PlaceholderBadge key={`r-${match.index}`} placeholder={match[0]} realValue={placeholderMap[match[0]]} />);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) parts.push(<span key={`t-${lastIndex}`} className="text-slate-800">{line.slice(lastIndex)}</span>);
  if (parts.length === 0) {
    if (trimmed === trimmed.toUpperCase() && trimmed.length < 60 && trimmed.length > 2) {
      return <motion.div key={lineIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: lineIndex * 0.02 }} className="text-sm font-bold text-slate-900 mt-3 mb-1">{line}</motion.div>;
    }
    return <motion.div key={lineIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: lineIndex * 0.02 }} className="text-sm text-slate-800 leading-relaxed">{line}</motion.div>;
  }
  return <motion.div key={lineIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: lineIndex * 0.02 }} className="text-sm leading-relaxed">{parts}</motion.div>;
}

// ── Position-based PDF highlighting ─────────────────────────────────────

function markHtml(text: string, label: string): string {
  const display = label.replace(/_/g, ' ');
  return `<mark class="pii-highlight" data-label="&#x1f6e1; ${display} \u2014 Hidden from AI">${text}</mark>`;
}

/** Walk the text-layer spans and inject highlight marks via innerHTML. */
function applyHighlightsToDOM(
  container: HTMLElement,
  highlights: Highlight[],
  itemOffsets: { start: number; end: number }[],
) {
  const textLayer = container.querySelector('.react-pdf__Page__textContent');
  if (!textLayer) return;

  // pdf.js wraps text spans inside <span class="markedContent"> containers for
  // tagged PDFs. Selecting only direct children misses nested text spans, so
  // we query all descendant spans and exclude the marked-content wrappers.
  const spans = textLayer.querySelectorAll<HTMLSpanElement>('span:not(.markedContent)');

  for (let idx = 0; idx < spans.length && idx < itemOffsets.length; idx++) {
    const span = spans[idx];
    const io = itemOffsets[idx];
    const text = span.textContent || '';

    const overlapping = highlights
      .filter((h) => h.localStart < io.end && h.localEnd > io.start)
      .sort((a, b) => a.localStart - b.localStart);
    if (overlapping.length === 0) continue;

    // Merge overlapping ranges so stacked entities (e.g. "Piccavet" inside
    // "Frédéric Piccavet" plus "Frédéric" itself) render as one mark rather
    // than three overlapping marks, which would duplicate the visible text.
    const merged: Highlight[] = [{ ...overlapping[0] }];
    for (let k = 1; k < overlapping.length; k++) {
      const cur = overlapping[k];
      const last = merged[merged.length - 1];
      if (cur.localStart <= last.localEnd) {
        if (cur.localEnd > last.localEnd) last.localEnd = cur.localEnd;
      } else {
        merged.push({ ...cur });
      }
    }

    let result = '';
    let cursor = 0;
    for (const hl of merged) {
      const hlStart = Math.max(0, hl.localStart - io.start);
      const hlEnd = Math.min(text.length, hl.localEnd - io.start);
      if (hlStart > cursor) result += escapeHtml(text.slice(cursor, hlStart));
      result += markHtml(escapeHtml(text.slice(hlStart, hlEnd)), hl.label);
      cursor = hlEnd;
    }
    if (cursor < text.length) result += escapeHtml(text.slice(cursor));
    span.innerHTML = result;
  }
}

/** Per-page wrapper that applies highlights after the text layer paints. */
function HighlightedPage({
  pageNumber,
  width,
  highlights,
  itemOffsets,
}: {
  pageNumber: number;
  width: number;
  highlights: Highlight[];
  itemOffsets: { start: number; end: number }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hlRef = useRef(highlights);
  const ioRef = useRef(itemOffsets);
  hlRef.current = highlights;
  ioRef.current = itemOffsets;

  // Case 1: text layer renders (or re-renders after zoom) → apply highlights
  const onTextLayerReady = useCallback(() => {
    requestAnimationFrame(() => {
      if (ref.current && hlRef.current.length > 0) {
        applyHighlightsToDOM(ref.current, hlRef.current, ioRef.current);
      }
    });
  }, []);

  // Case 2: highlights arrive after the text layer already rendered
  useEffect(() => {
    if (!ref.current || highlights.length === 0) return;
    const tl = ref.current.querySelector('.react-pdf__Page__textContent');
    if (!tl || tl.children.length === 0) return;
    applyHighlightsToDOM(ref.current, highlights, itemOffsets);
  }, [highlights, itemOffsets]);

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

// ── PDF Document Viewer ─────────────────────────────────────────────────

function PdfDocumentViewer({
  sessionId,
  activeEntities,
  onFallback,
}: {
  sessionId: string;
  activeEntities: DetectedEntity[];
  onFallback: () => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const [pageInfoMap, setPageInfoMap] = useState<Map<number, PageInfo>>(new Map());

  const fileUrl = `${BASE_URL}/sessions/${sessionId}/original-file`;

  // One worker per viewer instance, torn down on unmount.
  const pdfWorker = useMemo(
    () => new pdfjs.PDFWorker({ port: new PdfWorkerInline() as unknown as null }),
    [],
  );
  useEffect(() => () => pdfWorker.destroy(), [pdfWorker]);
  const documentOptions = useMemo(
    () => ({ ...PDF_DOCUMENT_OPTIONS, worker: pdfWorker }),
    [pdfWorker],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const baseWidth = containerWidth > 0 ? containerWidth - 48 : 600;
  const pageWidth = baseWidth * scale;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onLoadSuccess = useCallback((pdf: any) => {
    setNumPages(pdf.numPages);
    setLoading(false);
    pdfDocRef.current = pdf;
  }, []);

  const onLoadError = useCallback(() => {
    setLoading(false);
    onFallback();
  }, [onFallback]);

  // Compute per-page highlight data after PDF loads
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc || numPages === 0 || activeEntities.length === 0) return;
    let cancelled = false;
    computePageHighlights(doc, numPages, activeEntities)
      .then((m) => { if (!cancelled) setPageInfoMap(m); })
      .catch((err) => console.error('[DocumentViewer] highlight computation failed:', err));
    return () => { cancelled = true; };
  }, [numPages, activeEntities]);

  return (
    <div ref={containerRef} className="w-full min-h-full bg-slate-100 rounded-lg flex flex-col">
      {/* Zoom controls */}
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
                <HighlightedPage
                  key={i}
                  pageNumber={i + 1}
                  width={pageWidth}
                  highlights={info?.highlights ?? []}
                  itemOffsets={info?.itemOffsets ?? []}
                />
              );
            })}
          </Document>
        </div>
      </div>
    </div>
  );
}

// ── Main DocumentViewer ─────────────────────────────────────────────────

interface DocumentViewerProps {
  document: ChatDocument;
  /** Hide the built-in filename/save header (when the parent provides its own). */
  hideHeader?: boolean;
}

export default function DocumentViewer({ document: doc, hideHeader }: DocumentViewerProps) {
  const { scanResult, fileName, sessionId } = doc;
  const lines = scanResult.redacted_text.split('\n');
  const placeholderMap = scanResult.replacement_map || {};
  const [pdfFailed, setPdfFailed] = useState(false);
  const [docxFailed, setDocxFailed] = useState(false);

  // Derive highlight entities straight from the replacement map — it's the
  // authoritative record of what was redacted, and includes user-added CUSTOM
  // entries that never made it back into detected_entities.
  const activeEntities = useMemo(() => {
    const rm = scanResult.replacement_map;
    if (!rm) return [];
    const entities: DetectedEntity[] = [];
    for (const [placeholder, text] of Object.entries(rm)) {
      const match = placeholder.match(/\[REDACTED_([A-Z_]+?)_\d+\]/);
      if (!match) continue;
      entities.push({
        text,
        entity_type: match[1],
        start: -1,
        end: -1,
        enabled: true,
      });
    }
    return entities;
  }, [scanResult.replacement_map]);

  const showPdf = isPdf(fileName) && !pdfFailed;
  const showDocx = isDocx(fileName) && !docxFailed;

  return (
    <div className="w-full h-full flex flex-col bg-slate-950">
      {/* Header */}
      {!hideHeader && (
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-300 font-medium truncate max-w-[200px]">
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              window.open(getDownloadUrl(sessionId), '_blank');
            }}
            title="Save redacted file"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" /> Save Redacted
          </button>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
            REDACTED
          </span>
        </div>
      </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {showPdf ? (
          <PdfDocumentViewer
            sessionId={sessionId}
            activeEntities={activeEntities}
            onFallback={() => setPdfFailed(true)}
          />
        ) : showDocx ? (
          <DocxDocumentViewer
            sessionId={sessionId}
            activeEntities={activeEntities}
            onFallback={() => setDocxFailed(true)}
          />
        ) : (
          <div className="bg-white rounded-lg shadow-2xl p-6 min-h-full">
            {lines.map((line, i) => renderLine(line, i, placeholderMap))}
          </div>
        )}
      </div>

      {/* PII highlight styles — dark redaction bars with hover labels */}
      <style>{`
        .pii-highlight {
          position: relative;
          background: rgba(15, 23, 42, 0.72);
          border-radius: 3px;
          padding: 1px 3px;
          margin: 0 -1px;
          color: transparent;
          cursor: default;
          transition: background 0.15s ease;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .pii-highlight:hover {
          background: rgba(15, 23, 42, 0.45);
        }
        .pii-highlight::before {
          content: attr(data-label);
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%) scale(0.92);
          padding: 4px 10px;
          background: #0f172a;
          color: #94a3b8;
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
        .pii-highlight::after {
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
        .pii-highlight:hover::before,
        .pii-highlight:hover::after {
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
