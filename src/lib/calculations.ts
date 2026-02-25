import { runOvertimeEngine, type OvertimeComputationResult } from './overtimeEngine';
import {
  minutesToTime,
  normalizeOvernightEntries,
  parseCompDays,
  resolveDailyJourneyMinutes,
  sumEntryWorkedMinutes,
  timeToMinutes
} from './timeMath';

export interface Settings {
  baseSalary: number;
  monthlyHours: number;
  dailyJourney: number;
  weeklyLimit: number;
  nightCutoff: string;
  percent50: number;
  percent100: number;
  percentNight: number;
  aiProvider: 'gemini' | 'openai' | 'codex';
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  codexApiKey?: string;
  codexModel?: string;
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
}

export type OvertimeCalculationResult = OvertimeComputationResult;

export {
  minutesToTime,
  normalizeOvernightEntries,
  parseCompDays,
  resolveDailyJourneyMinutes,
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

export function calculateOvertime(entries: TimeEntry[], settings: Settings): OvertimeCalculationResult | null {
  if (!settings) throw new Error('Settings are required');
  if (!entries) return null;
  return runOvertimeEngine(entries, settings);
}
