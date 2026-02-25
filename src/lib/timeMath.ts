export interface PunchEntryLike {
  entry1?: string;
  exit1?: string;
  entry2?: string;
  exit2?: string;
  entryExtra?: string;
  exitExtra?: string;
}

export interface DatedPunchEntryLike extends PunchEntryLike {
  date?: string;
  workDate?: string;
}

const CLOCK_RX = /^\d{1,2}:\d{2}$/;

export function normalizeClock(value: unknown): string {
  const str = String(value ?? '').trim();
  return CLOCK_RX.test(str) ? str : '';
}

export function timeToMinutes(time: string): number {
  if (!time || !time.includes(':')) return 0;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function diffMinutes(start: string, end: string): number {
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!s || !e) return 0;
  let duration = timeToMinutes(e) - timeToMinutes(s);
  if (duration < 0) duration += 24 * 60;
  return Math.max(0, duration);
}

export function periodsFromEntry(entry: PunchEntryLike): Array<[string, string]> {
  return [
    [entry.entry1 || '', entry.exit1 || ''],
    [entry.entry2 || '', entry.exit2 || ''],
    [entry.entryExtra || '', entry.exitExtra || '']
  ];
}

export function sumPeriodsMinutes(periods: Array<[string, string]>): number {
  return periods.reduce((acc, [start, end]) => acc + diffMinutes(start, end), 0);
}

export function sumEntryWorkedMinutes(entry: PunchEntryLike): number {
  return sumPeriodsMinutes(periodsFromEntry(entry));
}

export function getLastExitMinutes(entry: PunchEntryLike): number {
  const periods = periodsFromEntry(entry).filter(([start, end]) => !!normalizeClock(start) && !!normalizeClock(end));
  if (periods.length === 0) return 0;
  const [, lastExit] = periods[periods.length - 1];
  return timeToMinutes(lastExit);
}

export function parseCompDays(compDaysRaw?: string): number[] {
  return (compDaysRaw || '1,2,3,4')
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

export function resolveDailyJourneyMinutes(
  baseDailyJourneyHours: number,
  isOvertimeCardEntry: boolean,
  dayOfWeek: number,
  saturdayCompensation?: boolean,
  compDaysRaw?: string
): number {
  if (isOvertimeCardEntry) return 0;

  let journey = Math.round((baseDailyJourneyHours || 0) * 60);
  if (!saturdayCompensation) return journey;

  const compDays = parseCompDays(compDaysRaw);
  if (compDays.includes(dayOfWeek)) return journey + 60;
  if (dayOfWeek === 6) return 0;
  return journey;
}

export function normalizeOvernightEntries<T extends DatedPunchEntryLike>(entries: T[]): T[] {
  if (!Array.isArray(entries) || entries.length === 0) return entries;

  const cloned = entries.map((entry) => ({ ...entry })) as T[];
  const getDateKey = (entry: DatedPunchEntryLike) => String(entry.date || entry.workDate || '');
  const ordered = cloned
    .map((entry) => ({ entry }))
    .sort((a, b) => getDateKey(a.entry).localeCompare(getDateKey(b.entry)));

  const pairs: Array<[keyof PunchEntryLike, keyof PunchEntryLike]> = [
    ['entry1', 'exit1'],
    ['entry2', 'exit2'],
    ['entryExtra', 'exitExtra']
  ];

  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].entry;
    const next = ordered[i + 1].entry;

    pairs.forEach(([startKey, endKey]) => {
      const currentStart = normalizeClock(current[startKey]);
      const currentEnd = normalizeClock(current[endKey]);
      const nextStart = normalizeClock(next[startKey]);
      const nextEnd = normalizeClock(next[endKey]);

      // OCR may split an overnight period into two consecutive rows.
      if (currentStart && !currentEnd && !nextStart && nextEnd) {
        (current as any)[endKey] = nextEnd;
        (next as any)[endKey] = '';
      }
    });
  }

  return cloned;
}
