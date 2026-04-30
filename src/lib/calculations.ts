import {
  analyzeDailyOvertimePreview,
  runOvertimeEngine,
  resolveDailyOvertimeDiscountMinutes,
  type DailyOvertimePreview,
  type OvertimeComputationResult
} from './overtimeEngine';
import {
  convertNightRealMinutesToFinancial,
  convertWorkedMinutesToFinancial,
  getFirstEntryMinutes,
  getLastExitInfo,
  getWorkedMinuteSlices,
  isNightMinute,
  minutesToTime,
  normalizeOvernightEntries,
  parseCompDays,
  resolveDelayMinutes,
  resolveDailyShortfallMinutes,
  resolveDailyJourneyMinutes,
  resolveExpectedStartMinutes,
  summarizeNightWorkedMinutes,
  sumEntryWorkedMinutes,
  timeToMinutes
} from './timeMath';

export type CompanyRubricKey = string;

export interface CompanyRubricEntry {
  code: string;
  label: string;
}

export type CompanyRubricMap = Record<CompanyRubricKey, CompanyRubricEntry>;

export interface CompanyOvertimeRule {
  id: string;
  label: string;
  rubricKey: string;
  multiplier: number;
  period?: 'day' | 'night' | 'any';
  dayType?: 'weekday' | 'sunday' | 'any';
  weeklyLimitMinutes?: number;
  weeklyLimitGroup?: string;
  monthlyLimitMinutes?: number;
  monthlyLimitGroup?: string;
  priority?: number;
  active?: boolean;
}

export interface CompanyDailyOvertimeDiscountRule {
  id: string;
  label: string;
  rubricKey: string;
  thresholdHours: number;
  discountMinutes: number;
  priority?: number;
  active?: boolean;
}

export interface CompanyCalculationConfig {
  dailyJourney?: number;
  weeklyLimit?: number;
  monthlyLimitHE?: number;
  nightCutoff?: string;
  percent50?: number;
  percent100?: number;
  percentNight?: number;
  cycleStartDay?: number;
  roundingCarryover?: number;
  customHolidays?: string[];
  overtimeRules?: CompanyOvertimeRule[];
  dailyOvertimeDiscountRules?: CompanyDailyOvertimeDiscountRule[];
}

export interface CompanySettingsProfile {
  id?: string;
  cnpj: string;
  name: string;
  rubrics: CompanyRubricMap;
  config: CompanyCalculationConfig;
}

export function buildSuggestedCompanyRubrics(): CompanyRubricMap {
  return {
    SALARIO_FIXO: { code: '0116', label: 'Salario Fixo' },
    HE_50: { code: '1058', label: 'Hora Extra 50%' },
    HE_75: { code: '3590', label: 'H.E. 50/25% (75%)' },
    HE_100: { code: '2038', label: 'Hora Extra 100%' },
    HE_125: { code: '3964', label: 'H.E. 100/25% (125%)' },
    ADIC_NOT: { code: '1082', label: 'Adicional Noturno 25%' },
    DSR_HE: { code: '3948', label: 'INT H EXTRA S/ DSR' },
    DSR_NOT: { code: '3930', label: 'INT AD. NOT. S/ DSR' },
    DESC_HE_1: { code: '9191', label: 'Desconto HE Faixa 1' },
    DESC_HE_2: { code: '9192', label: 'Desconto HE Faixa 2' },
    ATRASO: { code: '5142', label: 'Atrasos' },
    DSR_ATRASO: { code: '5312', label: 'Perda DSR s/ Atraso' },
  };
}

export function buildSuggestedOvertimeRules(config?: CompanyCalculationConfig): CompanyOvertimeRule[] {
  const weeklyLimitMinutes = Math.max(0, Number(config?.weeklyLimit ?? 3) * 60);
  const monthlyLimitMinutes = Math.max(0, Number(config?.monthlyLimitHE ?? 900));
  return [
    {
      id: 'weekday-low-day',
      label: 'HE base diurna',
      rubricKey: 'HE_50',
      multiplier: 1.5,
      period: 'day',
      dayType: 'weekday',
      weeklyLimitMinutes,
      weeklyLimitGroup: 'weekday-low',
      monthlyLimitMinutes,
      monthlyLimitGroup: 'weekday-low-day',
      priority: 1,
      active: true,
    },
    {
      id: 'weekday-low-night',
      label: 'HE base noturna',
      rubricKey: 'HE_75',
      multiplier: 1.875,
      period: 'night',
      dayType: 'weekday',
      weeklyLimitMinutes,
      weeklyLimitGroup: 'weekday-low',
      monthlyLimitMinutes,
      monthlyLimitGroup: 'weekday-low-night',
      priority: 2,
      active: true,
    },
    {
      id: 'weekday-high-day',
      label: 'HE excedente diurna',
      rubricKey: 'HE_100',
      multiplier: 2,
      period: 'day',
      dayType: 'weekday',
      priority: 3,
      active: true,
    },
    {
      id: 'weekday-high-night',
      label: 'HE excedente noturna',
      rubricKey: 'HE_125',
      multiplier: 2.5,
      period: 'night',
      dayType: 'weekday',
      priority: 4,
      active: true,
    },
    {
      id: 'sunday-day',
      label: 'Domingo diurno',
      rubricKey: 'HE_100',
      multiplier: 2,
      period: 'day',
      dayType: 'sunday',
      priority: 5,
      active: true,
    },
    {
      id: 'sunday-night',
      label: 'Domingo noturno',
      rubricKey: 'HE_125',
      multiplier: 2.5,
      period: 'night',
      dayType: 'sunday',
      priority: 6,
      active: true,
    },
  ];
}

export function buildSuggestedDailyOvertimeDiscountRules(): CompanyDailyOvertimeDiscountRule[] {
  return [
    {
      id: 'discount-tier-1',
      label: 'Desconto diario HE faixa 1',
      rubricKey: 'DESC_HE_1',
      thresholdHours: 4,
      discountMinutes: 15,
      priority: 1,
      active: true,
    },
    {
      id: 'discount-tier-2',
      label: 'Desconto diario HE faixa 2',
      rubricKey: 'DESC_HE_2',
      thresholdHours: 6,
      discountMinutes: 40,
      priority: 2,
      active: true,
    },
  ];
}

export interface Settings {
  baseSalary: number;
  monthlyHours: number;
  dailyJourney: number;
  weeklyLimit: number;
  nightCutoff: string;
  percent50: number;
  percent100: number;
  percentNight: number;
  aiProvider: 'gemini' | 'openai' | 'codex' | 'claude' | 'groq' | 'pollinations' | 'llamaindex';
  pollinationsModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  llamaindexApiKey?: string;
  llamaindexTier?: 'fast' | 'cost_effective' | 'agentic' | 'agentic_plus';
  codexApiKey?: string;
  codexModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  isOvertimeCard?: boolean;
  dependentes?: number;
  adiantamentoPercent?: number;
  adiantamentoIR?: number;
  saturdayCompensation?: boolean;
  compDays?: string;
  cycleStartDay?: number;
  workStart?: string;
  lunchStart?: string;
  lunchEnd?: string;
  workEnd?: string;
  saturdayWorkStart?: string;
  saturdayWorkEnd?: string;
  overtimeDiscountEnabled?: boolean;
  overtimeDiscountThresholdOneHours?: number;
  overtimeDiscountMinutesOne?: number;
  overtimeDiscountThresholdTwoHours?: number;
  overtimeDiscountMinutesTwo?: number;
  companySettings?: CompanySettingsProfile | null;
}

export interface EffectiveCalculationConfig {
  dailyJourney: number;
  weeklyLimit: number;
  monthlyLimitHE?: number;
  nightCutoff: string;
  percent50: number;
  percent100: number;
  percentNight: number;
  cycleStartDay: number;
  roundingCarryover: number;
}

export interface TimeEntry {
  id: string;
  date: string;
  workDate?: string;
  day?: string;
  entry1: string;
  exit1: string;
  entry2: string;
  exit2: string;
  entryExtra: string;
  exitExtra: string;
  totalHours: string;
  isDPAnnotation?: boolean;
  annotationText?: string;
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  isOvertimeCard?: boolean;
  month?: string;
  year?: number;
  frontImage?: string;
  backImage?: string;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  total50: number;
  total50Minutes: number;
  total75: number;
  total75Minutes: number;
  total100: number;
  total100Minutes: number;
  total125: number;
  total125Minutes: number;
  totalValue: number;
  totalBancoHoras: number;
  bucketTotals?: Record<string, { minutes: number; amount: number; label: string; code: string }>;
}

export type OvertimeCalculationResult = OvertimeComputationResult;
export type DailyOvertimeAnalysis = DailyOvertimePreview;

export {
  analyzeDailyOvertimePreview,
  convertNightRealMinutesToFinancial,
  convertWorkedMinutesToFinancial,
  getFirstEntryMinutes,
  getLastExitInfo,
  getWorkedMinuteSlices,
  isNightMinute,
  minutesToTime,
  normalizeOvernightEntries,
  parseCompDays,
  resolveDelayMinutes,
  resolveDailyShortfallMinutes,
  resolveDailyOvertimeDiscountMinutes,
  resolveDailyJourneyMinutes,
  resolveExpectedStartMinutes,
  summarizeNightWorkedMinutes,
  sumEntryWorkedMinutes,
  timeToMinutes
};

export function resolveWorkDateByCompetenciaDay(
  day: number,
  referenceMonth: number,
  referenceYear: number,
  cycleStartDay: number
): string {
  let month = referenceMonth;
  let year = referenceYear;
  if (cycleStartDay > 1 && day > cycleStartDay) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function resolveEffectiveCalculationConfig(settings: Settings): EffectiveCalculationConfig {
  const config = settings.companySettings?.config;
  return {
    dailyJourney: Number(config?.dailyJourney ?? settings.dailyJourney ?? 0),
    weeklyLimit: Number(config?.weeklyLimit ?? settings.weeklyLimit ?? 0),
    monthlyLimitHE: config?.monthlyLimitHE == null ? undefined : Number(config.monthlyLimitHE),
    nightCutoff: String(config?.nightCutoff ?? settings.nightCutoff ?? '22:00'),
    percent50: Number(config?.percent50 ?? settings.percent50 ?? 0),
    percent100: Number(config?.percent100 ?? settings.percent100 ?? 0),
    percentNight: Number(config?.percentNight ?? settings.percentNight ?? 0),
    cycleStartDay: Number(config?.cycleStartDay ?? settings.cycleStartDay ?? 15),
    roundingCarryover: Number(config?.roundingCarryover ?? 0),
  };
}

export function calculateOvertime(entries: TimeEntry[], settings: Settings): OvertimeCalculationResult | null {
  if (!settings) throw new Error('Settings are required');
  if (!entries) return null;
  return runOvertimeEngine(entries, settings);
}
