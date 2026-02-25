import { format, isValid, parseISO } from 'date-fns';
import type { Settings, TimeEntry, WeeklySummary } from './calculations';
import {
  getLastExitMinutes,
  normalizeOvernightEntries,
  resolveDailyJourneyMinutes,
  sumEntryWorkedMinutes,
  timeToMinutes
} from './timeMath';

interface RatePack {
  hourlyRate: number;
  rate50: number;
  rate75: number;
  rate100: number;
  rate125: number;
}

interface MutableTotals {
  total50Minutes: number;
  total75Minutes: number;
  total100Minutes: number;
  total125Minutes: number;
  totalBancoHoras: number;
}

interface WeekContext extends MutableTotals {
  weekOvertimeAccumulator: number;
}

interface DayRuleContext {
  entry: TimeEntry;
  settings: Settings;
  nightCutoffMinutes: number;
  week: WeekContext;
  grand: MutableTotals;
  isSunday: boolean;
  isOvertimeCardEntry: boolean;
  dailyJourneyMinutesEntry: number;
  dailyTotalMinutes: number;
  dayOvertimeMinutes: number;
  dayEndMinutes: number;
}

type DayRule = (ctx: DayRuleContext, next: () => void) => void;

export interface OvertimeComputationResult {
  weeklySummaries: WeeklySummary[];
  grandTotal50: number;
  grandTotal50Minutes: number;
  grandTotal75: number;
  grandTotal75Minutes: number;
  grandTotal100: number;
  grandTotal100Minutes: number;
  grandTotal125: number;
  grandTotal125Minutes: number;
  grandTotalValue: number;
  grandTotalBancoHoras: number;
  hourlyRate: number;
  rate50: number;
  rate75: number;
  rate100: number;
  rate125: number;
}

function buildRates(settings: Settings): RatePack {
  const hourlyRate = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
  const rate50 = hourlyRate * (1 + (settings.percent50 || 0) / 100);
  const rate100 = hourlyRate * (1 + (settings.percent100 || 0) / 100);
  const rate75 = hourlyRate * (1 + ((settings.percent50 || 0) + (settings.percentNight || 0)) / 100);
  const rate125 = hourlyRate * (1 + ((settings.percent100 || 0) + (settings.percentNight || 0)) / 100);
  return { hourlyRate, rate50, rate75, rate100, rate125 };
}

function composeRules(rules: DayRule[]) {
  return (ctx: DayRuleContext) => {
    let index = -1;
    const dispatch = (i: number) => {
      if (i <= index) return;
      index = i;
      const rule = rules[i];
      if (!rule) return;
      rule(ctx, () => dispatch(i + 1));
    };
    dispatch(0);
  };
}

const resolveJourneyRule: DayRule = (ctx, next) => {
  const date = parseISO(ctx.entry.date);
  const dayOfWeek = isValid(date) ? date.getDay() : 0;
  ctx.dailyJourneyMinutesEntry = resolveDailyJourneyMinutes(
    ctx.settings.dailyJourney || 0,
    ctx.isOvertimeCardEntry,
    dayOfWeek,
    !!ctx.settings.saturdayCompensation,
    ctx.settings.compDays
  );
  next();
};

const computeWorkedTimeRule: DayRule = (ctx, next) => {
  ctx.dailyTotalMinutes = sumEntryWorkedMinutes(ctx.entry);
  ctx.dayEndMinutes = getLastExitMinutes(ctx.entry);
  next();
};

const computeDayOvertimeRule: DayRule = (ctx, next) => {
  ctx.dayOvertimeMinutes = ctx.isSunday
    ? ctx.dailyTotalMinutes
    : Math.max(
        0,
        ctx.dailyTotalMinutes - (ctx.dailyJourneyMinutesEntry || (ctx.dailyTotalMinutes > 0 ? 0 : Infinity))
      );
  next();
};

const classifyAndAccumulateRule: DayRule = (ctx, next) => {
  if (ctx.dayOvertimeMinutes <= 0) {
    next();
    return;
  }

  if (!ctx.isOvertimeCardEntry) {
    ctx.week.totalBancoHoras += ctx.dayOvertimeMinutes;
    ctx.grand.totalBancoHoras += ctx.dayOvertimeMinutes;
    next();
    return;
  }

  const totalOvertimeToProcess = Math.round(ctx.dayOvertimeMinutes);
  let processed = 0;
  while (processed < totalOvertimeToProcess) {
    const currentMinuteFromEnd = ctx.dayEndMinutes - (processed + 0.5);
    let minuteOfDay = currentMinuteFromEnd;
    while (minuteOfDay < 0) minuteOfDay += 24 * 60;
    while (minuteOfDay >= 24 * 60) minuteOfDay -= 24 * 60;

    const isNight = minuteOfDay >= ctx.nightCutoffMinutes || minuteOfDay < 5 * 60;

    if (ctx.isSunday) {
      if (isNight) {
        ctx.week.total125Minutes += 1;
        ctx.grand.total125Minutes += 1;
      } else {
        ctx.week.total100Minutes += 1;
        ctx.grand.total100Minutes += 1;
      }
    } else {
      const limitMinutes = (ctx.settings.weeklyLimit || 0) * 60;
      const isWithinLimit = limitMinutes > 0 ? ctx.week.weekOvertimeAccumulator < limitMinutes : true;

      if (isWithinLimit) {
        if (isNight) {
          ctx.week.total75Minutes += 1;
          ctx.grand.total75Minutes += 1;
        } else {
          ctx.week.total50Minutes += 1;
          ctx.grand.total50Minutes += 1;
        }
      } else {
        if (isNight) {
          ctx.week.total125Minutes += 1;
          ctx.grand.total125Minutes += 1;
        } else {
          ctx.week.total100Minutes += 1;
          ctx.grand.total100Minutes += 1;
        }
      }
      ctx.week.weekOvertimeAccumulator += 1;
    }

    processed += 1;
  }

  next();
};

const runDayRuleChain = composeRules([
  resolveJourneyRule,
  computeWorkedTimeRule,
  computeDayOvertimeRule,
  classifyAndAccumulateRule
]);

function groupByCustomWeek(entries: TimeEntry[]): Record<string, TimeEntry[]> {
  const weeks: Record<string, TimeEntry[]> = {};
  entries.forEach((entry) => {
    if (!entry.date) return;
    const date = parseISO(entry.date);
    if (!isValid(date)) return;

    const dayOfMonth = date.getDate();
    const monthYear = format(date, 'yyyy-MM');
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const dayOfWeekFirstOfMonth = (firstOfMonth.getDay() + 6) % 7 + 1; // Monday=1 ... Sunday=7
    const daysUntilFirstSunday = 7 - (dayOfWeekFirstOfMonth % 7);

    let weekIndex = 1;
    if (dayOfMonth > daysUntilFirstSunday) {
      weekIndex = 1 + Math.ceil((dayOfMonth - daysUntilFirstSunday) / 7);
    }

    const key = `${monthYear}-W${weekIndex}`;
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(entry);
  });
  return weeks;
}

export function runOvertimeEngine(entries: TimeEntry[], settings: Settings): OvertimeComputationResult {
  const effectiveEntries = normalizeOvernightEntries(entries);
  const rates = buildRates(settings);
  const nightCutoffMinutes = timeToMinutes(settings.nightCutoff || '22:00');
  const groupedWeeks = groupByCustomWeek(effectiveEntries);

  const grand: MutableTotals = {
    total50Minutes: 0,
    total75Minutes: 0,
    total100Minutes: 0,
    total125Minutes: 0,
    totalBancoHoras: 0
  };

  const weeklySummaries: WeeklySummary[] = [];
  let grandTotalValue = 0;

  const sortedWeekKeys = Object.keys(groupedWeeks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  sortedWeekKeys.forEach((weekKey) => {
    const weekEntries = groupedWeeks[weekKey].slice().sort((a, b) => a.date.localeCompare(b.date));
    const week: WeekContext = {
      total50Minutes: 0,
      total75Minutes: 0,
      total100Minutes: 0,
      total125Minutes: 0,
      totalBancoHoras: 0,
      weekOvertimeAccumulator: 0
    };

    let weekStartStr = '';
    let weekEndStr = '';

    weekEntries.forEach((entry, index) => {
      if (index === 0) weekStartStr = entry.date;
      weekEndStr = entry.date;

      const date = parseISO(entry.date);
      const ctx: DayRuleContext = {
        entry,
        settings,
        nightCutoffMinutes,
        week,
        grand,
        isSunday: isValid(date) ? date.getDay() === 0 : false,
        isOvertimeCardEntry: !!entry.isOvertimeCard,
        dailyJourneyMinutesEntry: 0,
        dailyTotalMinutes: 0,
        dayOvertimeMinutes: 0,
        dayEndMinutes: 0
      };

      runDayRuleChain(ctx);
    });

    const week50 = week.total50Minutes / 60;
    const week75 = week.total75Minutes / 60;
    const week100 = week.total100Minutes / 60;
    const week125 = week.total125Minutes / 60;
    const weekValue = Number(
      (
        week50 * rates.rate50 +
        week75 * rates.rate75 +
        week100 * rates.rate100 +
        week125 * rates.rate125
      ).toFixed(2)
    );
    grandTotalValue += weekValue;

    weeklySummaries.push({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      total50: Number(week50.toFixed(2)),
      total50Minutes: week.total50Minutes,
      total75: Number(week75.toFixed(2)),
      total75Minutes: week.total75Minutes,
      total100: Number(week100.toFixed(2)),
      total100Minutes: week.total100Minutes,
      total125: Number(week125.toFixed(2)),
      total125Minutes: week.total125Minutes,
      totalValue: weekValue,
      totalBancoHoras: week.totalBancoHoras
    });
  });

  const grandTotal50 = grand.total50Minutes / 60;
  const grandTotal75 = grand.total75Minutes / 60;
  const grandTotal100 = grand.total100Minutes / 60;
  const grandTotal125 = grand.total125Minutes / 60;

  return {
    weeklySummaries,
    grandTotal50: Number(grandTotal50.toFixed(2)),
    grandTotal50Minutes: grand.total50Minutes,
    grandTotal75: Number(grandTotal75.toFixed(2)),
    grandTotal75Minutes: grand.total75Minutes,
    grandTotal100: Number(grandTotal100.toFixed(2)),
    grandTotal100Minutes: grand.total100Minutes,
    grandTotal125: Number(grandTotal125.toFixed(2)),
    grandTotal125Minutes: grand.total125Minutes,
    grandTotalValue: Number(grandTotalValue.toFixed(2)),
    grandTotalBancoHoras: grand.totalBancoHoras,
    hourlyRate: rates.hourlyRate,
    rate50: rates.rate50,
    rate75: rates.rate75,
    rate100: rates.rate100,
    rate125: rates.rate125
  };
}
