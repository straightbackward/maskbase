import { DetectedEntity } from '../types';

export interface Highlight {
  localStart: number;
  localEnd: number;
  label: string;
  /** Indices into the original detected_entities array that this highlight represents. */
  entityIndices: number[];
}

export interface PageInfo {
  highlights: Highlight[];
  itemOffsets: { start: number; end: number }[];
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip zero-width chars and normalize whitespace for cross-extractor matching. */
export function cleanForSearch(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[\n\r\u00a0\t]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Find every occurrence of `rawNeedle` in `text`, tolerating:
 *   - zero-width characters anywhere,
 *   - arbitrary whitespace between tokens (pdf.js concatenates adjacent
 *     items without a separator, while the backend text often has \n).
 */
export function findAllOccurrences(
  text: string,
  rawNeedle: string,
): { idx: number; matchLen: number }[] {
  const stripped = rawNeedle.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
  if (!stripped.trim()) return [];
  const tokens = stripped.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (tokens.length === 0) return [];

  const SEP = '[\\s\\u200b\\u200c\\u200d\\ufeff]*';
  const useBoundary = /^[\p{L}]+$/u.test(stripped) && stripped.length <= 4;
  const leftBoundary = useBoundary ? '(?<![\\p{L}\\p{N}_])' : '';
  const rightBoundary = useBoundary ? '(?![\\p{L}\\p{N}_])' : '';
  const pattern = leftBoundary + tokens.join(SEP) + rightBoundary;

  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gu');
  } catch {
    return [];
  }

  const matches: { idx: number; matchLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    matches.push({ idx: m.index, matchLen: m[0].length });
  }
  return matches;
}

/**
 * Extract text items from every page via pdf.js, then highlight every
 * occurrence of each detected entity. Each highlight carries the indices of
 * all detected_entities whose text matched here — so toggling a highlight
 * can flip every entity that shares that same text.
 */
export async function computePageHighlights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  numPages: number,
  entities: DetectedEntity[],
): Promise<Map<number, PageInfo>> {
  const pages: {
    items: string[];
    itemOffsets: { start: number; end: number }[];
    globalStart: number;
    len: number;
  }[] = [];

  let globalOffset = 0;
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const tc = await page.getTextContent();
    const items: string[] = [];
    const itemOffsets: { start: number; end: number }[] = [];
    let off = 0;
    for (const item of tc.items) {
      if (!('str' in item)) continue;
      const s = (item as { str: string }).str;
      if (s === '') continue;
      items.push(s);
      itemOffsets.push({ start: off, end: off + s.length });
      off += s.length;
    }
    pages.push({ items, itemOffsets, globalStart: globalOffset, len: off });
    globalOffset += off + 1;
  }

  const globalText = pages.map((p) => p.items.join('')).join('\n');

  const result = new Map<number, PageInfo>();
  for (let i = 0; i < pages.length; i++) {
    result.set(i, { highlights: [], itemOffsets: pages[i].itemOffsets });
  }

  // Group entities by normalised text so entities sharing a value search once
  // and the resulting highlights carry every matching entity index.
  const grouped = new Map<string, { label: string; raw: string; indices: number[] }>();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const key = cleanForSearch(e.text);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.indices.push(i);
    } else {
      grouped.set(key, { label: e.entity_type, raw: e.text, indices: [i] });
    }
  }

  for (const { label, raw, indices } of grouped.values()) {
    for (const { idx, matchLen } of findAllOccurrences(globalText, raw)) {
      for (let pi = 0; pi < pages.length; pi++) {
        const p = pages[pi];
        if (idx >= p.globalStart && idx < p.globalStart + p.len) {
          result.get(pi)!.highlights.push({
            localStart: idx - p.globalStart,
            localEnd: Math.min(idx + matchLen - p.globalStart, p.len),
            label,
            entityIndices: indices,
          });
          break;
        }
      }
    }
  }

  return result;
}
