import { ScanResult } from '../types';
import { getPdfExportUrl, getImageExportUrl } from '../services/api';
import { IMAGE_EXTENSIONS } from './fileTypes';

/** A ready-to-write redacted export of one scanned file. */
export interface RedactedExport {
  filename: string;
  data: Uint8Array | string;
  mime: string;
}

async function fetchExportBytes(url: string, failMessage: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: failMessage }));
    throw new Error(err.detail || failMessage);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

/** Build the redacted export for a scanned file in its natural format:
 * PDFs stay PDFs, images become redacted PNGs, everything else is text. */
export async function buildRedactedExport(fileName: string, result: ScanResult): Promise<RedactedExport> {
  const base = fileName.replace(/\.[^.]+$/, '') || 'document';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const data = await fetchExportBytes(getPdfExportUrl(result.session_id), 'PDF export failed');
    return { filename: `${base}_redacted.pdf`, data, mime: 'application/pdf' };
  }
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    const data = await fetchExportBytes(getImageExportUrl(result.session_id), 'Image export failed');
    return { filename: `${base}_redacted.png`, data, mime: 'image/png' };
  }
  return { filename: `${base}_redacted.txt`, data: result.redacted_text, mime: 'text/plain' };
}
