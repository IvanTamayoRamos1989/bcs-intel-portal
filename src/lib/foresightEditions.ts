import latest from '../data/foresights.json';

const editionModules = import.meta.glob('../data/foresights_editions/*.json', { eager: true });

export type ForesightEdition = {
  updated: string;
  period?: { from?: string; to?: string };
  headline_es: string;
  headline_en?: string;
  complete?: boolean;
  signals?: unknown[];
  [key: string]: unknown;
};

export type ForesightEditionMeta = {
  date: string;
  href: string;
  headline_es: string;
  headline_en: string;
  period?: { from?: string; to?: string };
  complete: boolean;
  isLatest: boolean;
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function formatEditionDate(iso: string, lang: 'es' | 'en'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = m[1];
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (lang === 'es') return `${day} de ${MESES[month - 1]} de ${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function isComplete(ed: ForesightEdition): boolean {
  if (ed.complete === false) return false;
  return Array.isArray(ed.signals) && ed.signals.length > 0;
}

function asEdition(mod: unknown): ForesightEdition | null {
  const ed = (mod && typeof mod === 'object' && 'default' in (mod as object)
    ? (mod as { default: ForesightEdition }).default
    : mod) as ForesightEdition;
  if (!ed || !ed.updated) return null;
  return ed;
}

export function loadLatest(): ForesightEdition {
  return latest as ForesightEdition;
}

export function loadAllEditions(): ForesightEdition[] {
  const map = new Map<string, ForesightEdition>();
  for (const mod of Object.values(editionModules)) {
    const ed = asEdition(mod);
    if (ed) map.set(ed.updated, ed);
  }
  const live = loadLatest();
  if (live?.updated) map.set(live.updated, live);
  return [...map.values()].sort((a, b) => b.updated.localeCompare(a.updated));
}

export function loadEdition(date: string): ForesightEdition | undefined {
  return loadAllEditions().find((ed) => ed.updated === date);
}

export function listEditionMeta(): ForesightEditionMeta[] {
  const latestDate = loadLatest()?.updated || '';
  return loadAllEditions().map((ed) => ({
    date: ed.updated,
    href: `/foresights/${ed.updated}/`,
    headline_es: ed.headline_es || '',
    headline_en: ed.headline_en || ed.headline_es || '',
    period: ed.period,
    complete: isComplete(ed),
    isLatest: ed.updated === latestDate,
  }));
}

export function previousEditions(): ForesightEditionMeta[] {
  return listEditionMeta().filter((ed) => !ed.isLatest);
}
