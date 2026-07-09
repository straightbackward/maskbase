import { DetectedEntity } from '../types';
import { cleanForSearch, findAllOccurrences } from './pdfHighlights';

export interface DocxHighlightRange {
  globalStart: number;
  globalEnd: number;
  label: string;
  /** Indices into the original detected_entities array this highlight covers. */
  entityIndices: number[];
}

interface TextNodeInfo {
  node: Text;
  globalStart: number;
  globalEnd: number;
}

function collectTextNodes(container: HTMLElement): { nodes: TextNodeInfo[]; globalText: string } {
  const nodes: TextNodeInfo[] = [];
  let globalText = '';
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const parent = n.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const t = node as Text;
    nodes.push({ node: t, globalStart: globalText.length, globalEnd: globalText.length + t.data.length });
    globalText += t.data;
  }
  return { nodes, globalText };
}

/** Unwrap existing highlight marks and merge adjacent text nodes. */
export function clearHighlights(container: HTMLElement, className: string) {
  const marks = container.querySelectorAll(`mark.${className}`);
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  container.normalize();
}

export function computeDocxHighlights(
  container: HTMLElement,
  entities: DetectedEntity[],
): DocxHighlightRange[] {
  const { globalText } = collectTextNodes(container);

  const grouped = new Map<string, { label: string; raw: string; indices: number[] }>();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const key = cleanForSearch(e.text);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.indices.push(i);
    else grouped.set(key, { label: e.entity_type, raw: e.text, indices: [i] });
  }

  const ranges: DocxHighlightRange[] = [];
  for (const { label, raw, indices } of grouped.values()) {
    for (const { idx, matchLen } of findAllOccurrences(globalText, raw)) {
      ranges.push({ globalStart: idx, globalEnd: idx + matchLen, label, entityIndices: indices });
    }
  }
  ranges.sort((a, b) => a.globalStart - b.globalStart);
  return ranges;
}

export type MarkBuilder = (text: string, range: DocxHighlightRange) => HTMLElement;

/**
 * Wrap the matched text-node slices in <mark> elements produced by `buildMark`.
 * Must be called after `clearHighlights` if this container was highlighted before.
 * Handles highlights that span multiple text nodes by splitting them per-node.
 */
export function applyDocxHighlights(
  container: HTMLElement,
  ranges: DocxHighlightRange[],
  buildMark: MarkBuilder,
) {
  if (ranges.length === 0) return;
  const { nodes } = collectTextNodes(container);

  for (const nodeInfo of nodes) {
    const overlap = ranges.filter(
      (r) => r.globalStart < nodeInfo.globalEnd && r.globalEnd > nodeInfo.globalStart,
    );
    if (overlap.length === 0) continue;

    // Merge overlapping ranges within this node (e.g. "Frederic" nested
    // inside "Frederic Piccavet") so we emit one mark, not two overlapping.
    const sorted = [...overlap].sort((a, b) => a.globalStart - b.globalStart);
    const merged: DocxHighlightRange[] = [
      { ...sorted[0], entityIndices: [...sorted[0].entityIndices] },
    ];
    for (let k = 1; k < sorted.length; k++) {
      const cur = sorted[k];
      const last = merged[merged.length - 1];
      if (cur.globalStart <= last.globalEnd) {
        if (cur.globalEnd > last.globalEnd) last.globalEnd = cur.globalEnd;
        for (const ei of cur.entityIndices) {
          if (!last.entityIndices.includes(ei)) last.entityIndices.push(ei);
        }
      } else {
        merged.push({ ...cur, entityIndices: [...cur.entityIndices] });
      }
    }

    const text = nodeInfo.node.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const r of merged) {
      const localStart = Math.max(0, r.globalStart - nodeInfo.globalStart);
      const localEnd = Math.min(text.length, r.globalEnd - nodeInfo.globalStart);
      if (localStart > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, localStart)));
      }
      fragment.appendChild(buildMark(text.slice(localStart, localEnd), r));
      cursor = localEnd;
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    nodeInfo.node.parentNode?.replaceChild(fragment, nodeInfo.node);
  }
}
