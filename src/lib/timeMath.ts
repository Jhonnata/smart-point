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

export interface DelayComputationOptions {
  workStart?: string;
  saturdayWorkStart?: string;
  saturdayCompensation?: boolean;
  toleranceMinutes?: number;
}

export interface DailyShortfallOptions {
  dailyJourneyHours: number;
  isOvertimeCardEntry: boolean;
  dayOfWeek: number;
  saturdayCompensation?: boolean;
  compDaysRaw?: string;
}

const CLOCK_RX = /^\d{1,2}:\d{2}$/;
export const NIGHT_START_MINUTES = 22 * 60;
export const NIGHT_END_MINUTES = 5 * 60;
export const NIGHT_REDUCED_FACTOR = 60 / 52.5;

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
  const entry1 = entry.entry1 || '';
  const exit1 = entry.exit1 || '';
  const entry2 = entry.entry2 || '';
  const exit2 = entry.exit2 || '';
  const entryExtra = entry.entryExtra || '';
  const exitExtra = entry.exitExtra || '';

  // Supports rows where the user/ocr filled only "Saida Extra":
  // if there is an unmatched previous start (entry2 or entry1), pair it with exitExtra.
  if (!entryExtra && normalizeClock(exitExtra)) {
    if (normalizeClock(entry2) && !normalizeClock(exit2)) {
      return [
        [entry1, exit1],
        [entry2, exitExtra],
        ['', '']
      ];
    }
    if (normalizeClock(entry1) && !normalizeClock(exit1)) {
      return [
        [entry1, exitExtra],
        [entry2, exit2],
        ['', '']
      ];
    }
  }

  return [
    [entry1, exit1],
    [entry2, exit2],
    [entryExtra, exitExtra]
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

export function isNightMinute(
  minuteOfDay: number,
  nightStartMinutes: number = NIGHT_START_MINUTES,
  nightEndMinutes: number = NIGHT_END_MINUTES
): boolean {
  if (nightStartMinutes === nightEndMinutes) return true;
  if (nightStartMinutes < nightEndMinutes) {
    return minuteOfDay >= nightStartMinutes && minuteOfDay < nightEndMinutes;
  }
  return minuteOfDay >= nightStartMinutes || minuteOfDay < nightEndMinutes;
}

export function convertNightRealMinutesToFinancial(realMinutes: number): number {
  return Math.max(0, realMinutes) * NIGHT_REDUCED_FACTOR;
}

export function convertWorkedMinutesToFinancial(realMinutes: number, night: boolean): number {
  return night ? convertNightRealMinutesToFinancial(realMinutes) : Math.max(0, realMinutes);
}

export interface WorkedMinuteSlice {
  minuteOfDay: number;
  absoluteMinute: number;
  isNight: boolean;
  financialMinutes: number;
}

export function getWorkedMinuteSlices(
  entry: PunchEntryLike,
  nightStartMinutes: number = NIGHT_START_MINUTES,
  nightEndMinutes: number = NIGHT_END_MINUTES
): WorkedMinuteSlice[] {
  const slices: WorkedMinuteSlice[] = [];
  let dayOffsetMinutes = 0;

  for (const [start, end] of periodsFromEntry(entry)) {
    const normalizedStart = normalizeClock(start);
    const normalizedEnd = normalizeClock(end);
    if (!normalizedStart || !normalizedEnd) continue;

    const startMinutes = timeToMinutes(normalizedStart);
    const endMinutes = timeToMinutes(normalizedEnd);
    let duration = endMinutes - startMinutes;
    if (duration < 0) duration += 24 * 60;
    if (duration <= 0) continue;

    for (let offset = 0; offset < duration; offset++) {
      const absoluteMinute = dayOffsetMinutes + startMinutes + offset;
      const minuteOfDay = ((absoluteMinute % (24 * 60)) + (24 * 60)) % (24 * 60);
      const night = isNightMinute(minuteOfDay, nightStartMinutes, nightEndMinutes);
      slices.push({
        minuteOfDay,
        absoluteMinute,
        isNight: night,
        financialMinutes: convertWorkedMinutesToFinancial(1, night),
      });
    }

    if (endMinutes < startMinutes) {
      dayOffsetMinutes += 24 * 60;
    }
  }

  return slices;
}

export function getFirstEntryMinutes(entry: PunchEntryLike): number | null {
  const firstStart = periodsFromEntry(entry)
    .map(([start]) => normalizeClock(start))
    .find(Boolean);
  if (!firstStart) return null;
  return timeToMinutes(firstStart);
}

export function getLastExitInfo(entry: PunchEntryLike): { minuteOfDay: number; dayOffset: number } | null {
  const periods = periodsFromEntry(entry).filter(([start, end]) => !!normalizeClock(start) && !!normalizeClock(end));
  if (periods.length === 0) return null;

  let dayOffset = 0;
  let result: { minuteOfDay: number; dayOffset: number } | null = null;
  for (const [start, end] of periods) {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    const exitDayOffset = dayOffset + (endMinutes < startMinutes ? 1 : 0);
    result = {
      minuteOfDay: endMinutes,
      dayOffset: exitDayOffset,
    };
    if (endMinutes < startMinutes) dayOffset += 1;
  }

  return result;
}

export function resolveExpectedStartMinutes(
  dayOfWeek: number,
  options?: DelayComputationOptions
): number {
  const saturdayCompensation = !!options?.saturdayCompensation;
  const start = dayOfWeek === 6 && !saturdayCompensation
    ? normalizeClock(options?.saturdayWorkStart) || normalizeClock(options?.workStart)
    : normalizeClock(options?.workStart);
  return start ? timeToMinutes(start) : 0;
}

export function resolveDelayMinutes(
  entry: PunchEntryLike,
  dayOfWeek: number,
  options?: DelayComputationOptions
): number {
  const toleranceMinutes = Math.max(0, Number(options?.toleranceMinutes ?? 5));
  const expectedStartMinutes = resolveExpectedStartMinutes(dayOfWeek, options);
  if (expectedStartMinutes <= 0) return 0;

  const firstStart = periodsFromEntry(entry)
    .map(([start]) => normalizeClock(start))
    .find(Boolean);
  if (!firstStart) return 0;

  const firstStartMinutes = timeToMinutes(firstStart);
  if (firstStartMinutes <= expectedStartMinutes + toleranceMinutes) return 0;
  return Math.max(0, firstStartMinutes - expectedStartMinutes);
}

export function resolveDailyShortfallMinutes(
  entry: PunchEntryLike,
  options: DailyShortfallOptions
): number {
  const journeyMinutes = resolveDailyJourneyMinutes(
    options.dailyJourneyHours,
    options.isOvertimeCardEntry,
    options.dayOfWeek,
    options.saturdayCompensation,
    options.compDaysRaw
  );
  if (journeyMinutes <= 0) return 0;

  const hasAnyMark = periodsFromEntry(entry).some(([start, end]) => !!normalizeClock(start) || !!normalizeClock(end));
  if (!hasAnyMark) return journeyMinutes;

  const workedMinutes = sumEntryWorkedMinutes(entry);
  if (workedMinutes <= 0) return journeyMinutes;
  if (workedMinutes >= journeyMinutes) return 0;
  return Math.max(0, journeyMinutes - workedMinutes);
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
