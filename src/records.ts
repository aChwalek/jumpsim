import { filterLogbook, jumpDiscipline, logStats, type JumpDiscipline, type LogEntry } from './logbook';

export const RECORD_RULES = {
  lowestPull: 'min', bestDistance: 'min', bestScore: 'max',
  longestFlightSeconds: 'max', longestFlightDistance: 'max', longestFreefallSeconds: 'max',
  fastestVerticalSpeed: 'max', fastestHorizontalSpeed: 'max',
  longestSwoopDistance: 'max', longestSwoopSeconds: 'max', fastestSwoopSpeed: 'max', longestSlide: 'max', bestStreak: 'max',
} as const;
export type RecordKind = keyof typeof RECORD_RULES;
export interface PersonalRecord {
  kind: RecordKind;
  value: number;
  previous: number | null;
  global: boolean;
  discipline: JumpDiscipline | null;
}

/** Compare before writing: one award per metric, even when both scopes improve. */
export function brokenRecords(previous: readonly LogEntry[], entry: LogEntry): PersonalRecord[] {
  if (entry.outcome === 'crash' || entry.outcome === 'impact') return [];
  const discipline = jumpDiscipline(entry);
  const before = logStats(previous);
  const categoryBefore = logStats(filterLogbook(previous, discipline));
  const candidate = logStats([entry]);
  const allStreak = logStats([...previous, entry]).currentStreak;
  const categoryStreak = logStats([...filterLogbook(previous, discipline), entry]).currentStreak;
  return (Object.keys(RECORD_RULES) as RecordKind[]).flatMap((kind) => {
    const value = kind === 'bestStreak' ? allStreak : candidate[kind];
    if (value === null || !Number.isFinite(value)) return [];
    if ((kind === 'bestScore' || kind === 'lowestPull') && value <= 0) return [];
    const improves = (next: number, old: number | null): boolean =>
      old === null || (RECORD_RULES[kind] === 'min' ? next < old - 1e-6 : next > old + 1e-6);
    const global = improves(value, before[kind]);
    const categoryValue = kind === 'bestStreak' ? categoryStreak : value;
    const category = improves(categoryValue, categoryBefore[kind]);
    if (!global && !category) return [];
    if (global && category && value !== categoryValue) return [
      { kind, value, previous: before[kind], global: true, discipline: null },
      { kind, value: categoryValue, previous: categoryBefore[kind], global: false, discipline },
    ];
    return [{ kind, value: global ? value : categoryValue, previous: global ? before[kind] : categoryBefore[kind], global, discipline: category ? discipline : null }];
  });
}
