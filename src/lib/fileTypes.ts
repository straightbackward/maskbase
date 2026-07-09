/** Single source of truth for which files can be scanned.
 * Must stay in sync with `allowed_extensions` in backend/main.py. */

export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.csv', '.xlsx', '.xls'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'];
export const ALLOWED_EXTENSIONS = [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS];

/** Value for an <input type="file"> accept attribute. */
export const FILE_ACCEPT = ALLOWED_EXTENSIONS.join(',');

export function isAllowedFile(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

/** Keep only scannable files from a picker/drop, preserving order. */
export function filterAllowedFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter(isAllowedFile);
}
