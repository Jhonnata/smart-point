import { isValid, parseISO } from 'date-fns';
import {
  minutesToTime,
  resolveWorkDateByCompetenciaDay,
  sumEntryWorkedMinutes,
  timeToMinutes,
  type Settings
} from './calculations';
import type { ParsedHolerithPdfData } from './holerithPdf';

interface CardRow {
  date: string;
  day: string;
  entry1: string;
  exit1: string;
  entry2: string;
  exit2: string;
  entryExtra: string;
  exitExtra: string;
  totalHours: string;
  isDPAnnotation?: boolean;
}

type RateType = '50' | '75' | '100' | '125';

interface Segment {
  start: number;
  end: number;
}

interface SlotPlan {
  start: number;
  end: number;
  cursor: number;
  segments: Segment[];
}

interface DayPlan {
  row: CardRow;
  dateObj: Date;
  dayOfWeek: number;
  weekKey: string;
  slots: SlotPlan[];
}

export interface ProjectedCardFromHolerith {
  hours: CardRow[];
  he: CardRow[];
  summary: {
    atrasoMinutesApplied: number;
    he50MinutesApplied: number;
    he75MinutesApplied: number;
    he100MinutesApplied: number;
    he125MinutesApplied: number;
  };
  warnings: string[];
}

function blankRow(day: number, date: string): CardRow {
  return {
    date,
    day: day.toString().padStart(2, '0'),
    entry1: '',
    exit1: '',
    entry2: '',
    exit2: '',
    entryExtra: '',
    exitExtra: '',
    totalHours: ''
  };
}

function formatClock(totalMinutes: number): string {
  const value = ((Math.round(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = Math.floor(value / 60);
  const mm = value % 60;
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function parseCompDays(compDaysRaw?: string): number[] {
  return (compDaysRaw || '1,2,3,4')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function isWeekday(dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function isSunday(dayOfWeek: number): boolean {
  return dayOfWeek === 0;
}

function isSaturday(dayOfWeek: number): boolean {
  return dayOfWeek === 6;
}

function finalizeTotals(rows: CardRow[]) {
  rows.forEach((row) => {
    row.totalHours = minutesToTime(sumEntryWorkedMinutes(row));
  });
}

function getCustomWeekKey(date: Date): string {
  const dayOfMonth = date.getDate();
  const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfWeekFirstOfMonth = ((firstOfMonth.getDay() + 6) % 7) + 1; // Monday=1 ... Sunday=7
  const daysUntilFirstSunday = 7 - (dayOfWeekFirstOfMonth % 7);

  let weekIndex = 1;
  if (dayOfMonth > daysUntilFirstSunday) {
    weekIndex = 1 + Math.ceil((dayOfMonth - daysUntilFirstSunday) / 7);
  }
  return `${monthYear}-W${weekIndex}`;
}

function isNightMinute(minuteOfDay: number, nightCutoffMinutes: number): boolean {
  return minuteOfDay >= nightCutoffMinutes || minuteOfDay < 5 * 60;
}

function classifyMinuteRateType(params: {
  dayOfWeek: number;
  minuteOfDay: number;
  weekAccumulator: number;
  weeklyLimitMinutes: number;
  nightCutoffMinutes: number;
}): RateType {
  const { dayOfWeek, minuteOfDay, weekAccumulator, weeklyLimitMinutes, nightCutoffMinutes } = params;
  const night = isNightMinute(minuteOfDay, nightCutoffMinutes);

  if (dayOfWeek === 0) {
    return night ? '125' : '100';
  }

  const withinLimit = weeklyLimitMinutes > 0 ? weekAccumulator < weeklyLimitMinutes : true;
  if (withinLimit) {
    return night ? '75' : '50';
  }
  return night ? '125' : '100';
}

function addMinuteToSlot(slot: SlotPlan, minute: number) {
  const last = slot.segments[slot.segments.length - 1];
  if (last && last.end === minute) {
    last.end = minute + 1;
  } else {
    slot.segments.push({ start: minute, end: minute + 1 });
  }
}

function buildDayPlans(rows: CardRow[], settings: Settings): DayPlan[] {
  const workStartMin = timeToMinutes(settings.workStart || '12:00');
  const workEndMin = timeToMinutes(settings.workEnd || '21:00');
  const saturdayStartMin = timeToMinutes(settings.saturdayWorkStart || '12:00');
  const saturdayEndMin = timeToMinutes(settings.saturdayWorkEnd || '16:00');
  const nightStartMin = Math.max(0, timeToMinutes(settings.nightCutoff || '22:00'));

  return rows
    .map((row) => {
      const dateObj = parseISO(row.date);
      if (!isValid(dateObj)) return null;
      const dayOfWeek = dateObj.getDay();
      const weekKey = getCustomWeekKey(dateObj);

      const slots: SlotPlan[] = [];

      if (isSunday(dayOfWeek)) {
        const sundayDayStart = 8 * 60;
        const sundayDayEnd = 18 * 60;
        const sundayNightStart = Math.max(22 * 60, nightStartMin);
        const sundayNightEnd = sundayNightStart + 240;
        slots.push({
          start: sundayDayStart,
          end: sundayDayEnd,
          cursor: sundayDayStart,
          segments: []
        });
        slots.push({
          start: sundayNightStart,
          end: sundayNightEnd,
          cursor: sundayNightStart,
          segments: []
        });
      } else {
        const baseStart =
          isSaturday(dayOfWeek) && !settings.saturdayCompensation
            ? saturdayStartMin
            : workStartMin;
        const baseEnd =
          isSaturday(dayOfWeek) && !settings.saturdayCompensation
            ? saturdayEndMin
            : workEndMin;

        const beforeStart = Math.max(0, baseStart - 120);
        const beforeEnd = baseStart;
        const afterStart = baseEnd;
        const afterEnd = baseEnd + 360;

        slots.push({
          start: beforeStart,
          end: beforeEnd,
          cursor: beforeStart,
          segments: []
        });
        slots.push({
          start: afterStart,
          end: afterEnd,
          cursor: afterStart,
          segments: []
        });
      }

      return { row, dateObj, dayOfWeek, weekKey, slots };
    })
    .filter((item): item is DayPlan => !!item);
}

function allocateTypeMinutes(params: {
  dayPlans: DayPlan[];
  targetType: RateType;
  targetMinutes: number;
  weekAccumulator: Map<string, number>;
  weeklyLimitMinutes: number;
  nightCutoffMinutes: number;
  sundayOnly?: boolean;
  nonSundayOnly?: boolean;
}): number {
  const {
    dayPlans,
    targetType,
    targetMinutes,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    sundayOnly,
    nonSundayOnly
  } = params;

  let remaining = Math.max(0, Math.round(targetMinutes));

  for (const dayPlan of dayPlans) {
    if (remaining <= 0) break;
    if (sundayOnly && dayPlan.dayOfWeek !== 0) continue;
    if (nonSundayOnly && dayPlan.dayOfWeek === 0) continue;

    for (const slot of dayPlan.slots) {
      if (remaining <= 0) break;

      while (slot.cursor < slot.end && remaining > 0) {
        const minuteOfDay = ((slot.cursor % (24 * 60)) + (24 * 60)) % (24 * 60);
        const currentWeekAcc = weekAccumulator.get(dayPlan.weekKey) || 0;
        const predictedType = classifyMinuteRateType({
          dayOfWeek: dayPlan.dayOfWeek,
          minuteOfDay,
          weekAccumulator: currentWeekAcc,
          weeklyLimitMinutes,
          nightCutoffMinutes
        });

        if (predictedType !== targetType) break;

        addMinuteToSlot(slot, slot.cursor);
        slot.cursor += 1;
        remaining -= 1;
        if (!isSunday(dayPlan.dayOfWeek)) {
          weekAccumulator.set(dayPlan.weekKey, currentWeekAcc + 1);
        }
      }
    }
  }

  return Math.max(0, Math.round(targetMinutes) - remaining);
}

function applySegmentsToRows(dayPlans: DayPlan[], warnings: string[]) {
  dayPlans.forEach((dayPlan) => {
    const mergedSegments = dayPlan.slots
      .flatMap((slot) => slot.segments)
      .sort((a, b) => a.start - b.start);

    const compacted: Segment[] = [];
    mergedSegments.forEach((segment) => {
      const last = compacted[compacted.length - 1];
      if (last && last.end >= segment.start) {
        last.end = Math.max(last.end, segment.end);
      } else {
        compacted.push({ ...segment });
      }
    });

    if (compacted.length > 3) {
      warnings.push(`Dia ${dayPlan.row.day}: excesso de periodos previstos; consolidado em 3 batidas.`);
      const first = compacted[0];
      const second = compacted[1];
      const third = {
        start: compacted[2].start,
        end: compacted[compacted.length - 1].end
      };
      compacted.splice(0, compacted.length, first, second, third);
    }

    const fields: Array<
      [
        'entry1' | 'entry2' | 'entryExtra',
        'exit1' | 'exit2' | 'exitExtra'
      ]
    > = [
      ['entry1', 'exit1'],
      ['entry2', 'exit2'],
      ['entryExtra', 'exitExtra']
    ];
    fields.forEach(([startKey, endKey], index) => {
      const segment = compacted[index];
      if (!segment) return;
      dayPlan.row[startKey] = formatClock(segment.start);
      dayPlan.row[endKey] = formatClock(segment.end);
    });
  });
}

export function buildProjectedCardFromHolerith(params: {
  referenceMonth: string;
  settings: Settings;
  parsed: ParsedHolerithPdfData;
}): ProjectedCardFromHolerith {
  const { referenceMonth, settings, parsed } = params;
  const [yearStr, monthStr] = referenceMonth.split('-');
  const referenceYear = Number(yearStr);
  const referenceMonthNumber = Number(monthStr);
  const cycleStartDay = settings.cycleStartDay || 15;

  const warnings: string[] = [];
  const normalRows: CardRow[] = [];
  const overtimeRows: CardRow[] = [];
  const compDays = parseCompDays(settings.compDays);

  const workStartMin = timeToMinutes(settings.workStart || '12:00');
  const lunchStartMin = timeToMinutes(settings.lunchStart || '17:00');
  const lunchEndMin = timeToMinutes(settings.lunchEnd || '18:00');
  const workEndMin = timeToMinutes(settings.workEnd || '21:00');
  const saturdayStartMin = timeToMinutes(settings.saturdayWorkStart || '12:00');
  const saturdayEndMin = timeToMinutes(settings.saturdayWorkEnd || '16:00');

  for (let day = 1; day <= 31; day++) {
    const date = resolveWorkDateByCompetenciaDay(day, referenceMonthNumber, referenceYear, cycleStartDay);
    const dateObj = parseISO(date);
    const dayOfWeek = isValid(dateObj) ? dateObj.getDay() : -1;

    const normal = blankRow(day, date);
    if (isWeekday(dayOfWeek)) {
      let adjustedWorkEnd = workEndMin;
      if (settings.saturdayCompensation && compDays.includes(dayOfWeek)) {
        adjustedWorkEnd += 60;
      }
      normal.entry1 = formatClock(workStartMin);
      normal.exit1 = formatClock(lunchStartMin);
      normal.entry2 = formatClock(lunchEndMin);
      normal.exit2 = formatClock(adjustedWorkEnd);
    } else if (isSaturday(dayOfWeek) && !settings.saturdayCompensation) {
      normal.entry1 = formatClock(saturdayStartMin);
      normal.exit1 = formatClock(saturdayEndMin);
    }

    normalRows.push(normal);
    overtimeRows.push(blankRow(day, date));
  }

  let atrasoRemaining = Math.max(0, parsed.atrasoMinutes);
  let atrasoMinutesApplied = 0;
  const atrasoCandidates = normalRows.filter((row) => {
    const dateObj = parseISO(row.date);
    return isValid(dateObj) && isWeekday(dateObj.getDay()) && !!row.entry2 && !!row.exit2;
  });

  for (const row of atrasoCandidates) {
    if (atrasoRemaining <= 0) break;
    const start = timeToMinutes(row.entry2);
    const end = timeToMinutes(row.exit2);
    const available = Math.max(0, end - start);
    if (available <= 0) continue;

    const cut = Math.min(60, available, atrasoRemaining);
    row.exit2 = formatClock(end - cut);
    row.isDPAnnotation = false;
    atrasoRemaining -= cut;
    atrasoMinutesApplied += cut;
  }
  if (atrasoRemaining > 0) {
    warnings.push(`Nao foi possivel distribuir ${minutesToTime(atrasoRemaining)} de atraso no cartao normal.`);
  }

  const dayPlans = buildDayPlans(overtimeRows, settings).sort((a, b) => a.row.date.localeCompare(b.row.date));
  const weekAccumulator = new Map<string, number>();
  const weeklyLimitMinutes = Math.max(0, Math.round((settings.weeklyLimit || 0) * 60));
  const nightCutoffMinutes = Math.max(0, timeToMinutes(settings.nightCutoff || '22:00'));

  // Sunday minutes do not consume weekly limit in the current overtime rules.
  const sunday125 = allocateTypeMinutes({
    dayPlans,
    targetType: '125',
    targetMinutes: parsed.he125Minutes,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    sundayOnly: true
  });
  const sunday100 = allocateTypeMinutes({
    dayPlans,
    targetType: '100',
    targetMinutes: parsed.he100Minutes,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    sundayOnly: true
  });

  // Consume within-week limit first for 75/50, then overflow for 125/100.
  const he75MinutesApplied = allocateTypeMinutes({
    dayPlans,
    targetType: '75',
    targetMinutes: parsed.he75Minutes,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    nonSundayOnly: true
  });
  const he50MinutesApplied = allocateTypeMinutes({
    dayPlans,
    targetType: '50',
    targetMinutes: parsed.he50Minutes,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    nonSundayOnly: true
  });
  const nonSunday125Needed = Math.max(0, parsed.he125Minutes - sunday125);
  const nonSunday100Needed = Math.max(0, parsed.he100Minutes - sunday100);
  const nonSunday125Applied = allocateTypeMinutes({
    dayPlans,
    targetType: '125',
    targetMinutes: nonSunday125Needed,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    nonSundayOnly: true
  });
  const nonSunday100Applied = allocateTypeMinutes({
    dayPlans,
    targetType: '100',
    targetMinutes: nonSunday100Needed,
    weekAccumulator,
    weeklyLimitMinutes,
    nightCutoffMinutes,
    nonSundayOnly: true
  });

  const he125MinutesApplied = sunday125 + nonSunday125Applied;
  const he100MinutesApplied = sunday100 + nonSunday100Applied;

  const missing50 = Math.max(0, parsed.he50Minutes - he50MinutesApplied);
  const missing75 = Math.max(0, parsed.he75Minutes - he75MinutesApplied);
  const missing100 = Math.max(0, parsed.he100Minutes - he100MinutesApplied);
  const missing125 = Math.max(0, parsed.he125Minutes - he125MinutesApplied);
  if (missing50 > 0) warnings.push(`HE 50% restante nao alocada: ${minutesToTime(missing50)}.`);
  if (missing75 > 0) warnings.push(`HE 75% restante nao alocada: ${minutesToTime(missing75)}.`);
  if (missing100 > 0) warnings.push(`HE 100% restante nao alocada: ${minutesToTime(missing100)}.`);
  if (missing125 > 0) warnings.push(`HE 125% restante nao alocada: ${minutesToTime(missing125)}.`);

  applySegmentsToRows(dayPlans, warnings);
  finalizeTotals(normalRows);
  finalizeTotals(overtimeRows);

  return {
    hours: normalRows,
    he: overtimeRows,
    summary: {
      atrasoMinutesApplied,
      he50MinutesApplied,
      he75MinutesApplied,
      he100MinutesApplied,
      he125MinutesApplied,
    },
    warnings,
  };
}
