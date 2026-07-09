import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { DetectedEntity } from '../types';
import {
  DocxHighlightRange,
  applyDocxHighlights,
  clearHighlights,
  computeDocxHighlights,
} from '../lib/docxHighlights';

const BASE_URL = 'http://127.0.0.1:22140';

function buildReadOnlyMark(text: string, range: DocxHighlightRange): HTMLElement {
  const mark = document.createElement('mark');
  mark.className = 'pii-highlight';
  const display = range.label.replace(/_/g, ' ');
  mark.setAttribute('data-label', `\u{1f6e1} ${display} \u2014 Hidden from AI`);
  mark.textContent = text;
  return mark;
}

interface DocxDocumentViewerProps {
  sessionId: string;
  activeEntities: DetectedEntity[];
  onFallback: () => void;
}

export default function DocxDocumentViewer({
  sessionId,
  activeEntities,
  onFallback,
}: DocxDocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const [rendered, setRendered] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);

  const fileUrl = `${BASE_URL}/sessions/${sessionId}/original-file`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return;
    let cancelled = false;
    setLoading(true);
    setRendered(false);

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
        console.error('[DocxDocumentViewer] load failed:', err);
        if (!cancelled) {
          setLoading(false);
          onFallback();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [fileUrl, onFallback]);

  // Measure the intrinsic page width so we can auto-fit it to the container.
  useLayoutEffect(() => {
    if (!rendered) return;
    const body = bodyRef.current;
    if (!body) return;
    const firstPage = body.querySelector('section') as HTMLElement | null;
    if (firstPage && firstPage.offsetWidth > 0) {
      setPageWidth(firstPage.offsetWidth);
    }
  }, [rendered]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !rendered) return;
    clearHighlights(body, 'pii-highlight');
    if (activeEntities.length === 0) return;
    const ranges = computeDocxHighlights(body, activeEntities);
    applyDocxHighlights(body, ranges, buildReadOnlyMark);
  }, [activeEntities, rendered]);

  // Fit the page to the container width (at user zoom = 1.0), then let the
  // user zoom further on top of that. Using CSS `zoom` (not transform) so the
  // element's layout box actually shrinks — Tauri's WKWebView supports this.
  const available = containerWidth > 0 ? containerWidth - 16 : 0;
  const fit = available > 0 && pageWidth > 0 ? Math.min(1, available / pageWidth) : 1;
  const effectiveZoom = fit * scale;
  // Post-zoom width. When this exceeds the scroll container, set `minWidth`
  // on the flex centering wrapper so horizontal scroll can actually reach
  // the content's left edge (flex justify-content: center otherwise positions
  // the overflow off-screen where scrollLeft can't reach).
  const scaledWidth = pageWidth * effectiveZoom;
  const overflowMinWidth = scaledWidth > available ? scaledWidth + 16 : undefined;

  return (
    <div className="w-full min-h-full bg-slate-100 rounded-lg flex flex-col">
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
    </div>
  );
}
