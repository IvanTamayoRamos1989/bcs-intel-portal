import { labelForPath, labelForFile } from './sourceLabel';

/**
 * Display label for a stored lake/Desktop path. Since 2026-10-08 the UI never shows internal
 * repo paths: this returns a plain source label (institution — title (year) when the file name
 * carries it, otherwise "Base de datos BCS 2050 — <tema>"). See src/lib/sourceLabel.ts.
 */
export function lakePath(p: string | null | undefined): string {
  if (!p) return '';
  const s = String(p).replace(/\\+/g, '/').replace(/^.*?(?=BCSFP\/)/i, '').replace(/^Desktop\//i, '');
  return labelForPath(s);
}

/** Readable document name — never Desktop/absolute paths or *.json names in UI. */
export function fileName(p: string | null | undefined): string {
  if (!p) return '';
  const s = String(p).replace(/\\/g, '/');
  const parts = s.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || s;
  if (/\.(geo)?json$/i.test(name)) return labelForPath(s);
  return labelForFile(name) || name;
}
