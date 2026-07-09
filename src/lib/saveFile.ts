import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

/** True when running inside the Tauri webview (native file APIs available). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save bytes to disk. In the Tauri app this opens a native save dialog; in a
 * plain browser it falls back to a normal download. Returns false only when
 * the user cancels the native dialog.
 */
export async function saveBytes(
  bytes: Uint8Array, filename: string, ext: string, mime: string,
): Promise<boolean> {
  if (isTauri()) {
    const path = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  browserDownload(new Blob([bytes as BlobPart], { type: mime }), filename);
  return true;
}

/** Ask the user for a destination folder (batch save). Returns null when the
 * dialog is cancelled or when running outside Tauri. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === 'string' ? dir : null;
}

/** Write one file into a folder previously chosen with pickFolder(). In a
 * plain browser (no folder dialogs) it falls back to a normal download. */
export async function saveIntoFolder(
  dir: string | null, filename: string, data: Uint8Array | string, mime: string,
): Promise<void> {
  if (isTauri() && dir) {
    const path = `${dir}/${filename}`;
    if (typeof data === 'string') await writeTextFile(path, data);
    else await writeFile(path, data);
    return;
  }
  const blob = typeof data === 'string'
    ? new Blob([data], { type: mime })
    : new Blob([data as BlobPart], { type: mime });
  browserDownload(blob, filename);
}

/** Save text to disk (native dialog in Tauri, browser download otherwise). */
export async function saveText(
  text: string, filename: string, ext: string, mime: string,
): Promise<boolean> {
  if (isTauri()) {
    const path = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  browserDownload(new Blob([text], { type: mime }), filename);
  return true;
}
