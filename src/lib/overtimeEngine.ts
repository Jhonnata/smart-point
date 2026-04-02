import { isValid, parseISO } from 'date-fns';
import type {
  CompanyDailyOvertimeDiscountRule,
  CompanyOvertimeRule,
  Settings,
  TimeEntry,
  WeeklySummary
} from './calculations';
import { resolveEffectiveCalculationConfig } from './calculations';
import {
  getFirstEntryMinutes,
  getLastExitInfo,
  getWorkedMinuteSlices,
  NIGHT_END_MINUTES,
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

interface OvertimeDiscountSettings {
  overtimeDiscountEnabled?: boolean;
  overtimeDiscountThresholdOneHours?: number;
  overtimeDiscountMinutesOne?: number;
  overtimeDiscountThresholdTwoHours?: number;
  overtimeDiscountMinutesTwo?: number;
  companySettings?: Settings['companySettings'];
}

interface OvertimeBucket {
  rubricKey: string;
  code: string;
  label: string;
  ruleId: string;
  multiplier: number;
  period: 'day' | 'night' | 'any';
  minutes: number;
  amount: number;
}

interface DiscountBucket {
  rubricKey: string;
  code: string;
  label: string;
  ruleId: string;
  minutes: number;
  amount: number;
}

interface MutableTotals {
  total50Minutes: number;
  total75Minutes: number;
  total100Minutes: number;
  total125Minutes: number;
  totalBancoHoras: number;
  buckets: Map<string, OvertimeBucket>;
  discountBuckets: Map<string, DiscountBucket>;
  weekDayMinutesAcc: number;
  weekNightMinutesAcc: number;
  monthUsage: Record<string, number>;
}

interface WeekContext extends MutableTotals {
  weekStart: string;
  weekEnd: string;
}

interface DayRuleContext {
  entry: TimeEntry;
  settings: Settings;
  rules: CompanyOvertimeRule[];
  rates: RatePack;
  nightCutoffMinutes: number;
  week: WeekContext;
  grand: MutableTotals;
  isSunday: boolean;
  isOvertimeCardEntry: boolean;
  dailyJourneyMinutesEntry: number;
  dailyTotalMinutes: number;
  overtimeSlices: Array<{ isNight: boolean; financialMinutes: number }>;
  rawOvertimeRealMinutes: number;
  rawOvertimeMinutes: number;
  dayOvertimeMinutes: number;
  ignoreDay: boolean;
  bankOnlyDay: boolean;
  weekDayMinutesAccBefore: number;
  weekNightMinutesAccBefore: number;
  monthUsageBefore: Record<string, number>;
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
  overtimeBuckets: Array<OvertimeBucket & { hours: number }>;
  discountBuckets: Array<DiscountBucket & { hours: number }>;
}

export interface DailyOvertimePreview {
  workedMinutes: number;
  dailyJourneyMinutes: number;
  rawOvertimeRealMinutes: number;
  rawOvertimeMinutes: number;
  discountRealMinutes: number;
  dayOvertimeRealMinutes: number;
  dayOvertimeMinutes: number;
}

function buildRates(settings: Settings): RatePack {
  const effectiveConfig = resolveEffectiveCalculationConfig(settings);
  const hourlyRate = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
  const rate50 = hourlyRate * (1 + effectiveConfig.percent50 / 100);
  const rate100 = hourlyRate * (1 + effectiveConfig.percent100 / 100);
  const percentNight = effectiveConfig.percentNight;
  const rate75 = rate50 * (1 + percentNight / 100);
  const rate125 = rate100 * (1 + percentNight / 100);
  return { hourlyRate, rate50, rate75, rate100, rate125 };
}

function normalizeAnnotationText(value?: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function hasAnnotationKeyword(annotationText: string | undefined, keyword: string): boolean {
  return normalizeAnnotationText(annotationText).includes(keyword);
}

function cloneBuckets(source?: Map<string, OvertimeBucket>): Map<string, OvertimeBucket> {
  if (!source) return new Map();
  return new Map(
    Array.from(source.entries()).map(([key, bucket]) => [key, { ...bucket }])
  );
}

function createMutableTotals(): MutableTotals {
  return {
    total50Minutes: 0,
    total75Minutes: 0,
    total100Minutes: 0,
    total125Minutes: 0,
    totalBancoHoras: 0,
    buckets: new Map(),
    discountBuckets: new Map(),
    weekDayMinutesAcc: 0,
    weekNightMinutesAcc: 0,
    monthUsage: {},
  };
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

export function resolveDailyOvertimeDiscountMinutes(
  rawOvertimeMinutes: number,
  settings?: OvertimeDiscountSettings
): number {
  if (rawOvertimeMinutes <= 0) return 0;

  const companyRules = (settings?.companySettings?.config?.dailyOvertimeDiscountRules || [])
    .filter((rule) => rule && rule.active !== false && Number(rule.thresholdHours) > 0 && Number(rule.discountMinutes) > 0)
    .sort((a, b) => Number(a.thresholdHours) - Number(b.thresholdHours) || Number(a.discountMinutes) - Number(b.discountMinutes));
  if (companyRules.length > 0) {
    for (const rule of companyRules) {
      if (rawOvertimeMinutes >= Number(rule.thresholdHours) * 60) {
        return Math.max(0, Number(rule.discountMinutes));
      }
    }
    return 0;
  }

  const enabled = settings?.overtimeDiscountEnabled ?? true;
  if (!enabled) return 0;

  const rules = [
    {
      thresholdHours: Math.max(0, Number(settings?.overtimeDiscountThresholdOneHours ?? 4)),
      discountMinutes: Math.max(0, Number(settings?.overtimeDiscountMinutesOne ?? 15)),
    },
    {
      thresholdHours: Math.max(0, Number(settings?.overtimeDiscountThresholdTwoHours ?? 6)),
      discountMinutes: Math.max(0, Number(settings?.overtimeDiscountMinutesTwo ?? 60)),
    },
  ]
    .filter((rule) => rule.thresholdHours > 0 && rule.discountMinutes > 0)
    .sort((a, b) => a.thresholdHours - b.thresholdHours || a.discountMinutes - b.discountMinutes);

  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const matches = rawOvertimeMinutes >= rule.thresholdHours * 60;
    if (matches) return rule.discountMinutes;
  }

  return 0;
}

function resolveCompanyDiscountRules(settings: Settings): CompanyDailyOvertimeDiscountRule[] {
  const configuredRules = (settings.companySettings?.config?.dailyOvertimeDiscountRules || [])
    .filter((rule) => rule && rule.active !== false && rule.rubricKey && Number(rule.thresholdHours) > 0 && Number(rule.discountMinutes) > 0)
    .map((rule, index) => ({
      ...rule,
      id: String(rule.id || `discount-rule-${index + 1}`),
      label: String(rule.label || `Desconto ${index + 1}`).trim(),
      rubricKey: String(rule.rubricKey).trim(),
      thresholdHours: Number(rule.thresholdHours),
      discountMinutes: Number(rule.discountMinutes),
      priority: Number(rule.priority ?? index + 1),
    }))
    .sort((a, b) => Number(a.thresholdHours) - Number(b.thresholdHours) || Number(a.priority || 0) - Number(b.priority || 0));

  if (configuredRules.length > 0) return configuredRules;

  const enabled = settings.overtimeDiscountEnabled ?? true;
  if (!enabled) return [];
  return [
    {
      id: 'legacy-discount-1',
      label: 'Desconto diario HE faixa 1',
      rubricKey: 'DESC_HE_1',
      thresholdHours: Math.max(0, Number(settings.overtimeDiscountThresholdOneHours ?? 4)),
      discountMinutes: Math.max(0, Number(settings.overtimeDiscountMinutesOne ?? 15)),
      priority: 1,
      active: true,
    },
    {
      id: 'legacy-discount-2',
      label: 'Desconto diario HE faixa 2',
      rubricKey: 'DESC_HE_2',
      thresholdHours: Math.max(0, Number(settings.overtimeDiscountThresholdTwoHours ?? 6)),
      discountMinutes: Math.max(0, Number(settings.overtimeDiscountMinutesTwo ?? 60)),
      priority: 2,
      active: true,
    },
  ].filter((rule) => rule.thresholdHours > 0 && rule.discountMinutes > 0);
}

function resolveCompanyRules(settings: Settings, rates: RatePack): CompanyOvertimeRule[] {
  const configuredRules = (settings.companySettings?.config?.overtimeRules || [])
    .filter((rule) => rule && rule.active !== false && rule.rubricKey && Number(rule.multiplier) > 0)
    .map((rule, index) => ({
      ...rule,
      id: String(rule.id || `rule-${index + 1}`),
      label: String(rule.label || rule.rubricKey || `Regra ${index + 1}`).trim(),
      rubricKey: String(rule.rubricKey).trim(),
      multiplier: Number(rule.multiplier),
      period: rule.period || 'any',
      dayType: rule.dayType || 'weekday',
      priority: Number(rule.priority ?? index + 1),
    }))
    .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));

  if (configuredRules.length > 0) return configuredRules;

  const effectiveConfig = resolveEffectiveCalculationConfig(settings);
  const weeklyLimitMinutes = Math.max(0, Number(effectiveConfig.weeklyLimit ?? 0) * 60);
  const monthlyLimitMinutes = Math.max(0, Number(effectiveConfig.monthlyLimitHE ?? 0));

  return [
    {
      id: 'weekday-low-day',
      label: 'Extra base diurna',
      rubricKey: 'HE_50',
      multiplier: rates.rate50 / (rates.hourlyRate || 1),
      period: 'day',
      dayType: 'weekday',
      weeklyLimitMinutes,
      weeklyLimitGroup: weeklyLimitMinutes > 0 ? 'weekday-low' : undefined,
      monthlyLimitMinutes,
      monthlyLimitGroup: monthlyLimitMinutes > 0 ? 'weekday-low-day' : undefined,
      priority: 1,
      active: true,
    },
    {
      id: 'weekday-low-night',
      label: 'Extra base noturna',
      rubricKey: 'HE_75',
      multiplier: rates.rate75 / (rates.hourlyRate || 1),
      period: 'night',
      dayType: 'weekday',
      weeklyLimitMinutes,
      weeklyLimitGroup: weeklyLimitMinutes > 0 ? 'weekday-low' : undefined,
      monthlyLimitMinutes,
      monthlyLimitGroup: monthlyLimitMinutes > 0 ? 'weekday-low-night' : undefined,
      priority: 2,
      active: true,
    },
    {
      id: 'weekday-high-day',
      label: 'Extra excedente diurna',
      rubricKey: 'HE_100',
      multiplier: rates.rate100 / (rates.hourlyRate || 1),
      period: 'day',
      dayType: 'weekday',
      priority: 3,
      active: true,
    },
    {
      id: 'weekday-high-night',
      label: 'Extra excedente noturna',
      rubricKey: 'HE_125',
      multiplier: rates.rate125 / (rates.hourlyRate || 1),
      period: 'night',
      dayType: 'weekday',
      priority: 4,
      active: true,
    },
    {
      id: 'sunday-day',
      label: 'Extra domingo diurna',
      rubricKey: 'HE_100',
      multiplier: rates.rate100 / (rates.hourlyRate || 1),
      period: 'day',
      dayType: 'sunday',
      priority: 5,
      active: true,
    },
    {
      id: 'sunday-night',
      label: 'Extra domingo noturna',
      rubricKey: 'HE_125',
      multiplier: rates.rate125 / (rates.hourlyRate || 1),
      period: 'night',
      dayType: 'sunday',
      priority: 6,
      active: true,
    },
  ];
}

function resolveRubricEntry(settings: Settings, rubricKey: string, labelFallback: string) {
  const entry = settings.companySettings?.rubrics?.[rubricKey];
  return {
    code: String(entry?.code || '').trim(),
    label: String(entry?.label || labelFallback || rubricKey).trim(),
  };
}

function recordDiscountAmount(
  totals: MutableTotals,
  settings: Settings,
  rule: CompanyDailyOvertimeDiscountRule,
  discountMinutes: number,
  discountAmount: number
) {
  if (discountMinutes <= 0 || discountAmount <= 0) return;
  const rubric = resolveRubricEntry(settings, rule.rubricKey, rule.label);
  const existing = totals.discountBuckets.get(rule.rubricKey) || {
    rubricKey: rule.rubricKey,
    code: rubric.code,
    label: rubric.label,
    ruleId: rule.id,
    minutes: 0,
    amount: 0,
  };
  existing.minutes += discountMinutes;
  existing.amount += discountAmount;
  existing.code = rubric.code;
  existing.label = rubric.label;
  totals.discountBuckets.set(rule.rubricKey, existing);
}

function incrementLegacyBuckets(totals: MutableTotals, minuteRate: number, rates: RatePack, financialMinutes: number) {
  const epsilon = 0.0001;
  if (Math.abs(minuteRate - rates.rate50) < epsilon) totals.total50Minutes += financialMinutes;
  else if (Math.abs(minuteRate - rates.rate75) < epsilon) totals.total75Minutes += financialMinutes;
  else if (Math.abs(minuteRate - rates.rate100) < epsilon) totals.total100Minutes += financialMinutes;
  else if (Math.abs(minuteRate - rates.rate125) < epsilon) totals.total125Minutes += financialMinutes;
}

function recordRuleMinute(
  totals: MutableTotals,
  settings: Settings,
  rates: RatePack,
  rule: CompanyOvertimeRule,
  financialMinutes: number
) {
  const rubric = resolveRubricEntry(settings, rule.rubricKey, rule.label);
  const bucketKey = rule.rubricKey;
  const existing = totals.buckets.get(bucketKey) || {
    rubricKey: rule.rubricKey,
    code: rubric.code,
    label: rubric.label,
    ruleId: rule.id,
    multiplier: rule.multiplier,
    period: rule.period || 'any',
    minutes: 0,
    amount: 0,
  };
  existing.minutes += financialMinutes;
  existing.amount += ((rates.hourlyRate * rule.multiplier) / 60) * financialMinutes;
  existing.code = rubric.code;
  existing.label = rubric.label;
  existing.period = rule.period || 'any';
  totals.buckets.set(bucketKey, existing);
  incrementLegacyBuckets(totals, rates.hourlyRate * rule.multiplier, rates, financialMinutes);
}

function ruleMatches(rule: CompanyOvertimeRule, isNight: boolean, isSunday: boolean): boolean {
  const period = rule.period || 'any';
  const dayType = rule.dayType || 'weekday';
  const periodMatch = period === 'any' || (isNight ? period === 'night' : period === 'day');
  const dayMatch = dayType === 'any' || (isSunday ? dayType === 'sunday' : dayType === 'weekday');
  return periodMatch && dayMatch;
}

function getAvailableRuleCapacity(rule: CompanyOvertimeRule, week: MutableTotals, monthUsage: Record<string, number>): number {
  const weeklyLimit = Math.max(0, Number(rule.weeklyLimitMinutes || 0));
  const monthlyLimit = Math.max(0, Number(rule.monthlyLimitMinutes || 0));
  const monthlyGroup = rule.monthlyLimitGroup || rule.id;
  const weeklyAccumulator = (rule.period || 'any') === 'night' ? week.weekNightMinutesAcc : week.weekDayMinutesAcc;
  const weeklyAvailable = weeklyLimit > 0 ? Math.max(0, weeklyLimit - weeklyAccumulator) : Number.POSITIVE_INFINITY;
  const monthlyAvailable = monthlyLimit > 0 ? Math.max(0, monthlyLimit - (monthUsage[monthlyGroup] || 0)) : Number.POSITIVE_INFINITY;
  return Math.min(weeklyAvailable, monthlyAvailable);
}

function canUseRule(rule: CompanyOvertimeRule, week: MutableTotals, monthUsage: Record<string, number>, financialMinutes: number): boolean {
  const monthlyLimit = Math.max(0, Number(rule.monthlyLimitMinutes || 0));
  const monthlyGroup = rule.monthlyLimitGroup || rule.id;
  const weeklyOk = getAvailableRuleCapacity(rule, week, monthUsage) + 0.0001 >= financialMinutes;
  const monthlyOk = monthlyLimit <= 0 || (monthUsage[monthlyGroup] || 0) + financialMinutes <= monthlyLimit + 0.0001;
  return weeklyOk && monthlyOk;
}

function consumeRuleUsage(rule: CompanyOvertimeRule, week: MutableTotals, monthUsage: Record<string, number>, financialMinutes: number) {
  const weeklyLimit = Math.max(0, Number(rule.weeklyLimitMinutes || 0));
  const monthlyLimit = Math.max(0, Number(rule.monthlyLimitMinutes || 0));
  if (weeklyLimit > 0) {
    if ((rule.period || 'any') === 'night') week.weekNightMinutesAcc += financialMinutes;
    else week.weekDayMinutesAcc += financialMinutes;
  }
  if (monthlyLimit > 0) {
    const monthlyGroup = rule.monthlyLimitGroup || rule.id;
    monthUsage[monthlyGroup] = (monthUsage[monthlyGroup] || 0) + financialMinutes;
  }
}

function pickRule(rules: CompanyOvertimeRule[], isNight: boolean, isSunday: boolean, week: MutableTotals, monthUsage: Record<string, number>, financialMinutes: number) {
  const matching = rules.filter((rule) => ruleMatches(rule, isNight, isSunday));
  if (matching.length === 0) return null;
  for (const rule of matching) {
    if (canUseRule(rule, week, monthUsage, financialMinutes)) return rule;
  }
  return matching[matching.length - 1];
}

function allocateSliceAcrossRules(
  financialMinutes: number,
  isNight: boolean,
  isSunday: boolean,
  rules: CompanyOvertimeRule[],
  week: MutableTotals,
  monthUsage: Record<string, number>,
  apply: (rule: CompanyOvertimeRule, allocatedFinancialMinutes: number) => void
) {
  let remaining = financialMinutes;
  const matching = rules.filter((rule) => ruleMatches(rule, isNight, isSunday));
  if (matching.length === 0) return;

  for (let index = 0; index < matching.length && remaining > 0.0001; index++) {
    const rule = matching[index];
    const isLast = index === matching.length - 1;
    const available = getAvailableRuleCapacity(rule, week, monthUsage);
    const allocatable = Number.isFinite(available)
      ? Math.min(remaining, Math.max(0, available))
      : remaining;

    if (allocatable > 0.0001) {
      consumeRuleUsage(rule, week, monthUsage, allocatable);
      apply(rule, allocatable);
      remaining -= allocatable;
      continue;
    }

    if (isLast) {
      consumeRuleUsage(rule, week, monthUsage, remaining);
      apply(rule, remaining);
      remaining = 0;
    }
  }
}

const resolveJourneyRule: DayRule = (ctx, next) => {
  const date = parseISO(ctx.entry.date);
  const dayOfWeek = isValid(date) ? date.getDay() : 0;
  ctx.dailyJourneyMinutesEntry = resolveDailyJourneyMinutes(
    resolveEffectiveCalculationConfig(ctx.settings).dailyJourney,
    ctx.isOvertimeCardEntry,
    dayOfWeek,
    !!ctx.settings.saturdayCompensation,
    ctx.settings.compDays
  );
  next();
};

const computeWorkedTimeRule: DayRule = (ctx, next) => {
  if (hasAnnotationKeyword(ctx.entry.annotationText, 'ABONADO') || hasAnnotationKeyword(ctx.entry.annotationText, 'FALTA ABONADA')) {
    ctx.ignoreDay = true;
    ctx.dailyTotalMinutes = 0;
    ctx.overtimeSlices = [];
    ctx.rawOvertimeRealMinutes = 0;
    ctx.rawOvertimeMinutes = 0;
    ctx.dayOvertimeMinutes = 0;
    next();
    return;
  }
  if (hasAnnotationKeyword(ctx.entry.annotationText, 'BCO')) ctx.bankOnlyDay = true;
  ctx.dailyTotalMinutes = sumEntryWorkedMinutes(ctx.entry);
  next();
};

const computeDayOvertimeRule: DayRule = (ctx, next) => {
  if (ctx.ignoreDay) {
    ctx.overtimeSlices = [];
    ctx.rawOvertimeRealMinutes = 0;
    ctx.rawOvertimeMinutes = 0;
    ctx.dayOvertimeMinutes = 0;
    next();
    return;
  }

  const preview = analyzeDailyOvertimePreview(
    { ...ctx.entry, isOvertimeCard: ctx.isOvertimeCardEntry },
    ctx.settings
  );
  const workedSlices = getWorkedMinuteSlices(ctx.entry, ctx.nightCutoffMinutes, NIGHT_END_MINUTES);
  const overtimeSlices: Array<{ isNight: boolean; financialMinutes: number }> = [];
  let workedRealMinutes = 0;
  for (const slice of workedSlices) {
    const countsAsOvertime = ctx.isSunday || workedRealMinutes >= ctx.dailyJourneyMinutesEntry;
    workedRealMinutes += 1;
    if (!countsAsOvertime) continue;
    overtimeSlices.push({
      isNight: slice.isNight,
      financialMinutes: slice.financialMinutes,
    });
  }

  ctx.overtimeSlices = overtimeSlices;
  ctx.rawOvertimeRealMinutes = preview.rawOvertimeRealMinutes;
  ctx.rawOvertimeMinutes = preview.rawOvertimeMinutes;
  ctx.dayOvertimeMinutes = preview.dayOvertimeMinutes;
  next();
};

export function analyzeDailyOvertimePreview(entry: TimeEntry, settings: Settings): DailyOvertimePreview {
  const normalizedEntry = normalizeOvernightEntries([entry])[0] || entry;
  const effectiveConfig = resolveEffectiveCalculationConfig(settings);
  const date = parseISO(normalizedEntry.date);
  const dayOfWeek = isValid(date) ? date.getDay() : 0;
  const isSunday = dayOfWeek === 0;
  const dailyJourneyMinutes = resolveDailyJourneyMinutes(
    effectiveConfig.dailyJourney,
    !!normalizedEntry.isOvertimeCard,
    dayOfWeek,
    !!settings.saturdayCompensation,
    settings.compDays
  );
  const workedMinutes = sumEntryWorkedMinutes(normalizedEntry);

  if (!normalizedEntry.isOvertimeCard) {
    return {
      workedMinutes,
      dailyJourneyMinutes,
      rawOvertimeRealMinutes: 0,
      rawOvertimeMinutes: 0,
      discountRealMinutes: 0,
      dayOvertimeRealMinutes: workedMinutes,
      dayOvertimeMinutes: workedMinutes,
    };
  }

  const nightCutoffMinutes = timeToMinutes(effectiveConfig.nightCutoff || '22:00');
  const workedSlices = getWorkedMinuteSlices(normalizedEntry, nightCutoffMinutes, NIGHT_END_MINUTES);
  const overtimeSlices: Array<{ isNight: boolean; financialMinutes: number }> = [];
  let workedRealMinutes = 0;

  for (const slice of workedSlices) {
    const countsAsOvertime = isSunday || workedRealMinutes >= dailyJourneyMinutes;
    workedRealMinutes += 1;
    if (!countsAsOvertime) continue;
    overtimeSlices.push({
      isNight: slice.isNight,
      financialMinutes: slice.financialMinutes,
    });
  }

  const rawOvertimeRealMinutes = overtimeSlices.length;
  const rawOvertimeMinutes = Number(overtimeSlices.reduce((sum, slice) => sum + slice.financialMinutes, 0).toFixed(4));
  const discountRealMinutes = resolveDailyOvertimeDiscountMinutes(rawOvertimeRealMinutes, settings);
  const dayOvertimeRealMinutes = Math.max(0, rawOvertimeRealMinutes - discountRealMinutes);
  const dayOvertimeMinutes = Number(
    overtimeSlices
      .slice(discountRealMinutes)
      .reduce((sum, slice) => sum + slice.financialMinutes, 0)
      .toFixed(4)
  );

  return {
    workedMinutes,
    dailyJourneyMinutes,
    rawOvertimeRealMinutes,
    rawOvertimeMinutes,
    discountRealMinutes,
    dayOvertimeRealMinutes,
    dayOvertimeMinutes,
  };
}

const classifyAndAccumulateRule: DayRule = (ctx, next) => {
  if (ctx.ignoreDay || ctx.dayOvertimeMinutes <= 0) {
    next();
    return;
  }

  if (!ctx.isOvertimeCardEntry || ctx.bankOnlyDay) {
    ctx.week.totalBancoHoras += ctx.dayOvertimeMinutes;
    ctx.grand.totalBancoHoras += ctx.dayOvertimeMinutes;
    next();
    return;
  }

  let remainingDiscountRealMinutes = resolveDailyOvertimeDiscountMinutes(ctx.rawOvertimeRealMinutes, ctx.settings);
  let processedFinancialMinutes = 0;

  for (const slice of ctx.overtimeSlices) {
    if (processedFinancialMinutes + 0.0001 >= ctx.dayOvertimeMinutes) break;

    if (remainingDiscountRealMinutes > 0) {
      remainingDiscountRealMinutes -= 1;
      continue;
    }

    const financialMinutes = Math.min(slice.financialMinutes, ctx.dayOvertimeMinutes - processedFinancialMinutes);
    const rule = pickRule(ctx.rules, slice.isNight, ctx.isSunday, ctx.week, ctx.grand.monthUsage, financialMinutes);
    if (!rule) {
      processedFinancialMinutes += financialMinutes;
      continue;
    }
    allocateSliceAcrossRules(
      financialMinutes,
      slice.isNight,
      ctx.isSunday,
      ctx.rules,
      ctx.week,
      ctx.grand.monthUsage,
      (matchedRule, allocatedFinancialMinutes) => {
        recordRuleMinute(ctx.week, ctx.settings, ctx.rates, matchedRule, allocatedFinancialMinutes);
        recordRuleMinute(ctx.grand, ctx.settings, ctx.rates, matchedRule, allocatedFinancialMinutes);
      }
    );
    processedFinancialMinutes += financialMinutes;
  }

  next();
};

const runDayRuleChain = composeRules([
  resolveJourneyRule,
  computeWorkedTimeRule,
  computeDayOvertimeRule,
  classifyAndAccumulateRule,
]);

function getRealWeekKey(date: Date): string {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diffToMonday);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(base.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

function groupByRealWeek(entries: TimeEntry[]): Record<string, TimeEntry[]> {
  const weeks: Record<string, TimeEntry[]> = {};
  entries.forEach((entry) => {
    if (!entry.date) return;
    const date = parseISO(entry.date);
    if (!isValid(date)) return;
    const key = getRealWeekKey(date);
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(entry);
  });
  return weeks;
}

function mapBucketsForOutput(buckets: Map<string, OvertimeBucket>) {
  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      hours: Number((bucket.minutes / 60).toFixed(2)),
      amount: Number(bucket.amount.toFixed(2)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function mapDiscountBucketsForOutput(buckets: Map<string, DiscountBucket>) {
  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      hours: Number((bucket.minutes / 60).toFixed(2)),
      amount: Number(bucket.amount.toFixed(2)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildMinuteTimeline(entry: TimeEntry, isSunday: boolean, dailyJourneyMinutesEntry: number): Array<{ isNight: boolean; financialMinutes: number }> {
  const slices = getWorkedMinuteSlices(entry);
  const timeline: Array<{ isNight: boolean; financialMinutes: number }> = [];
  let workedOffset = 0;

  for (const slice of slices) {
    const countsAsOvertime = isSunday || workedOffset >= dailyJourneyMinutesEntry;
    workedOffset += 1;
    if (!countsAsOvertime) continue;
    timeline.push({
      isNight: slice.isNight,
      financialMinutes: slice.financialMinutes,
    });
  }
  return timeline;
}

function classifyTimelineMinutes(
  slices: Array<{ isNight: boolean; financialMinutes: number }>,
  rules: CompanyOvertimeRule[],
  isSunday: boolean,
  week: MutableTotals,
  monthUsage: Record<string, number>
) {
  const allocations: Array<{ rule: CompanyOvertimeRule; financialMinutes: number }> = [];
  for (const slice of slices) {
    const pickedRule = pickRule(rules, slice.isNight, isSunday, week, monthUsage, slice.financialMinutes);
    if (!pickedRule) continue;
    allocateSliceAcrossRules(
      slice.financialMinutes,
      slice.isNight,
      isSunday,
      rules,
      week,
      monthUsage,
      (rule, financialMinutes) => {
        allocations.push({ rule, financialMinutes });
      }
    );
  }
  return allocations;
}

function takeSlicesUntilFinancialTarget(
  slices: Array<{ isNight: boolean; financialMinutes: number }>,
  financialTarget: number
) {
  const selected: Array<{ isNight: boolean; financialMinutes: number }> = [];
  let consumed = 0;
  for (const slice of slices) {
    if (consumed + 0.0001 >= financialTarget) break;
    selected.push(slice);
    consumed += slice.financialMinutes;
  }
  return selected;
}

function recordInterjornadaBuckets(entries: TimeEntry[], settings: Settings, totals: MutableTotals, hourlyRate: number) {
  const sorted = entries
    .filter((entry) => !!entry.date)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (let index = 0; index < sorted.length - 1; index++) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const currentDate = parseISO(current.date);
    const nextDate = parseISO(next.date);
    if (!isValid(currentDate) || !isValid(nextDate)) continue;

    const lastExit = getLastExitInfo(current);
    const firstEntry = getFirstEntryMinutes(next);
    if (!lastExit || firstEntry == null) continue;

    const currentExitAt = new Date(currentDate);
    currentExitAt.setDate(currentExitAt.getDate() + lastExit.dayOffset);
    currentExitAt.setHours(0, 0, 0, 0);
    currentExitAt.setMinutes(lastExit.minuteOfDay);

    const nextEntryAt = new Date(nextDate);
    nextEntryAt.setHours(0, 0, 0, 0);
    nextEntryAt.setMinutes(firstEntry);

    const interjornadaMinutes = Math.round((nextEntryAt.getTime() - currentExitAt.getTime()) / 60000);
    if (interjornadaMinutes >= 11 * 60 || interjornadaMinutes <= 0) continue;

    const missingMinutes = 11 * 60 - interjornadaMinutes;
    const rubric = resolveRubricEntry(settings, 'INTERJORNADA', 'Indenizacao Interjornada');
    const existing = totals.buckets.get('INTERJORNADA') || {
      rubricKey: 'INTERJORNADA',
      code: rubric.code,
      label: rubric.label,
      ruleId: 'interjornada',
      multiplier: 1,
      period: 'any' as const,
      minutes: 0,
      amount: 0,
    };
    existing.minutes += missingMinutes;
    existing.amount += (hourlyRate / 60) * missingMinutes;
    totals.buckets.set('INTERJORNADA', existing);
  }
}

export function runOvertimeEngine(entries: TimeEntry[], settings: Settings): OvertimeComputationResult {
  const effectiveEntries = normalizeOvernightEntries(entries);
  const rates = buildRates(settings);
  const rules = resolveCompanyRules(settings, rates);
  const discountRules = resolveCompanyDiscountRules(settings);
  const nightCutoffMinutes = timeToMinutes(resolveEffectiveCalculationConfig(settings).nightCutoff || '22:00');
  const groupedWeeks = groupByRealWeek(effectiveEntries);

  const grand = createMutableTotals();
  const weeklySummaries: WeeklySummary[] = [];
  let grandTotalValue = 0;

  const sortedWeekKeys = Object.keys(groupedWeeks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  sortedWeekKeys.forEach((weekKey) => {
    const weekEntries = groupedWeeks[weekKey].slice().sort((a, b) => a.date.localeCompare(b.date));
    const week = createMutableTotals() as WeekContext;
    week.weekStart = '';
    week.weekEnd = '';

    weekEntries.forEach((entry, index) => {
      if (index === 0) week.weekStart = entry.date;
      week.weekEnd = entry.date;

      const date = parseISO(entry.date);
      const ctx: DayRuleContext = {
        entry,
        settings,
        rules,
        rates,
        nightCutoffMinutes,
        week,
        grand,
        isSunday: isValid(date) ? date.getDay() === 0 : false,
        isOvertimeCardEntry: !!entry.isOvertimeCard,
        dailyJourneyMinutesEntry: 0,
        dailyTotalMinutes: 0,
        overtimeSlices: [],
        rawOvertimeRealMinutes: 0,
        rawOvertimeMinutes: 0,
        dayOvertimeMinutes: 0,
        ignoreDay: false,
        bankOnlyDay: false,
        weekDayMinutesAccBefore: week.weekDayMinutesAcc,
        weekNightMinutesAccBefore: week.weekNightMinutesAcc,
        monthUsageBefore: { ...grand.monthUsage },
      };
      runDayRuleChain(ctx);

      if (
        !ctx.ignoreDay &&
        ctx.isOvertimeCardEntry &&
        !ctx.bankOnlyDay &&
        ctx.rawOvertimeMinutes > ctx.dayOvertimeMinutes &&
        ctx.dayOvertimeMinutes >= 0
      ) {
        const appliedDiscountRule = discountRules.find((rule) => ctx.rawOvertimeRealMinutes >= rule.thresholdHours * 60);
        if (appliedDiscountRule) {
          const rawTimeline = ctx.overtimeSlices;
          const rawSlices = takeSlicesUntilFinancialTarget(rawTimeline, ctx.rawOvertimeMinutes);
          const netSlices = takeSlicesUntilFinancialTarget(rawTimeline.slice(resolveDailyOvertimeDiscountMinutes(ctx.rawOvertimeRealMinutes, ctx.settings)), ctx.dayOvertimeMinutes);
          const rawWeek = createMutableTotals();
          rawWeek.weekDayMinutesAcc = ctx.weekDayMinutesAccBefore;
          rawWeek.weekNightMinutesAcc = ctx.weekNightMinutesAccBefore;
          const rawAllocations = classifyTimelineMinutes(rawSlices, rules, ctx.isSunday, rawWeek, { ...ctx.monthUsageBefore });
          const netWeek = createMutableTotals();
          netWeek.weekDayMinutesAcc = ctx.weekDayMinutesAccBefore;
          netWeek.weekNightMinutesAcc = ctx.weekNightMinutesAccBefore;
          const netAllocations = classifyTimelineMinutes(netSlices, rules, ctx.isSunday, netWeek, { ...ctx.monthUsageBefore });
          const rawAmount = rawAllocations.reduce((sum, allocation) => sum + ((rates.hourlyRate * allocation.rule.multiplier) / 60) * allocation.financialMinutes, 0);
          const netAmount = netAllocations.reduce((sum, allocation) => sum + ((rates.hourlyRate * allocation.rule.multiplier) / 60) * allocation.financialMinutes, 0);
          const discountAmount = Math.max(0, rawAmount - netAmount);
          const discountMinutes = Math.max(0, resolveDailyOvertimeDiscountMinutes(ctx.rawOvertimeRealMinutes, ctx.settings));
          recordDiscountAmount(week, settings, appliedDiscountRule, discountMinutes, discountAmount);
          recordDiscountAmount(grand, settings, appliedDiscountRule, discountMinutes, discountAmount);
        }
      }
    });

    recordInterjornadaBuckets(weekEntries, settings, week, rates.hourlyRate);

    const weekValue = Number(Array.from(week.buckets.values()).reduce((sum, bucket) => sum + bucket.amount, 0).toFixed(2));
    grandTotalValue += weekValue;

    weeklySummaries.push({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      total50: Number((week.total50Minutes / 60).toFixed(2)),
      total50Minutes: week.total50Minutes,
      total75: Number((week.total75Minutes / 60).toFixed(2)),
      total75Minutes: week.total75Minutes,
      total100: Number((week.total100Minutes / 60).toFixed(2)),
      total100Minutes: week.total100Minutes,
      total125: Number((week.total125Minutes / 60).toFixed(2)),
      total125Minutes: week.total125Minutes,
      totalValue: weekValue,
      totalBancoHoras: week.totalBancoHoras,
      bucketTotals: Object.fromEntries(
        mapBucketsForOutput(week.buckets).map((bucket) => [
          bucket.rubricKey,
          { minutes: bucket.minutes, amount: bucket.amount, label: bucket.label, code: bucket.code }
        ])
      ),
    });
  });

  recordInterjornadaBuckets(effectiveEntries, settings, grand, rates.hourlyRate);

  return {
    weeklySummaries,
    grandTotal50: Number((grand.total50Minutes / 60).toFixed(2)),
    grandTotal50Minutes: grand.total50Minutes,
    grandTotal75: Number((grand.total75Minutes / 60).toFixed(2)),
    grandTotal75Minutes: grand.total75Minutes,
    grandTotal100: Number((grand.total100Minutes / 60).toFixed(2)),
    grandTotal100Minutes: grand.total100Minutes,
    grandTotal125: Number((grand.total125Minutes / 60).toFixed(2)),
    grandTotal125Minutes: grand.total125Minutes,
    grandTotalValue: Number(grandTotalValue.toFixed(2)),
    grandTotalBancoHoras: grand.totalBancoHoras,
    hourlyRate: rates.hourlyRate,
    rate50: rates.rate50,
    rate75: rates.rate75,
    rate100: rates.rate100,
    rate125: rates.rate125,
    overtimeBuckets: mapBucketsForOutput(grand.buckets),
    discountBuckets: mapDiscountBucketsForOutput(grand.discountBuckets),
  };
}
