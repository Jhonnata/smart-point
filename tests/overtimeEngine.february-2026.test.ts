import { describe, expect, it } from 'vitest';

import type { Settings, TimeEntry } from '../src/lib/calculations';
import { normalizeOvernightEntries } from '../src/lib/calculations';
import { runOvertimeEngine } from '../src/lib/overtimeEngine';

function buildFebruarySettings(): Settings {
  return {
    baseSalary: 9251.05,
    monthlyHours: 220,
    dailyJourney: 8,
    weeklyLimit: 3,
    nightCutoff: '22:00',
    percent50: 50,
    percent100: 100,
    percentNight: 25,
    aiProvider: 'gemini',
    saturdayCompensation: false,
    compDays: '',
    cycleStartDay: 16,
    overtimeDiscountEnabled: true,
    overtimeDiscountThresholdOneHours: 999,
    overtimeDiscountMinutesOne: 0,
    overtimeDiscountThresholdTwoHours: 6,
    overtimeDiscountMinutesTwo: 40,
    companySettings: {
      cnpj: '00000000000100',
      name: 'Empresa Teste Fevereiro/2026',
      rubrics: {
        HE_50: { code: '105', label: 'Hora Extra 50% Diurna' },
        HE_75: { code: '359', label: 'Hora Extra 50% Noturna' },
        HE_100: { code: '203', label: 'Hora Extra 100% Diurna' },
        HE_125: { code: '396', label: 'Hora Extra 100% Noturna' },
        ADIC_NOT: { code: '108', label: 'Adicional Noturno 25%' },
        INTERJORNADA: { code: '393', label: 'Interjornada' },
        DESC_HE_2: { code: '919', label: 'Desconto Intervalo' },
      },
      config: {
        weeklyLimit: 3,
        percentNight: 25,
        cycleStartDay: 16,
        overtimeRules: [
          {
            id: 'he50-day',
            label: 'HE 50% Diurna',
            rubricKey: 'HE_50',
            multiplier: 1.5,
            period: 'day',
            dayType: 'weekday',
            weeklyLimitMinutes: 180,
            priority: 1,
            active: true,
          },
          {
            id: 'he75-night',
            label: 'HE 50% Noturna',
            rubricKey: 'HE_75',
            multiplier: 1.875,
            period: 'night',
            dayType: 'weekday',
            weeklyLimitMinutes: 180,
            priority: 2,
            active: true,
          },
          {
            id: 'he100-day',
            label: 'HE 100% Diurna',
            rubricKey: 'HE_100',
            multiplier: 2,
            period: 'day',
            dayType: 'weekday',
            priority: 3,
            active: true,
          },
          {
            id: 'he125-night',
            label: 'HE 100% Noturna',
            rubricKey: 'HE_125',
            multiplier: 2.5,
            period: 'night',
            dayType: 'weekday',
            priority: 4,
            active: true,
          },
          {
            id: 'sunday-day',
            label: 'Domingo Diurno',
            rubricKey: 'HE_100',
            multiplier: 2,
            period: 'day',
            dayType: 'sunday',
            priority: 5,
            active: true,
          },
          {
            id: 'sunday-night',
            label: 'Domingo Noturno',
            rubricKey: 'HE_125',
            multiplier: 2.5,
            period: 'night',
            dayType: 'sunday',
            priority: 6,
            active: true,
          },
        ],
        dailyOvertimeDiscountRules: [
          {
            id: 'intervalo-40',
            label: 'Desconto Intervalo',
            rubricKey: 'DESC_HE_2',
            thresholdHours: 6,
            discountMinutes: 40,
            priority: 1,
            active: true,
          },
        ],
      },
    },
  };
}

const februaryEntries: TimeEntry[] = [
  { id: '2026-01-17', date: '2026-01-17', workDate: '2026-01-17', day: '17', entry1: '12:59', exit1: '20:02', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-01-24', date: '2026-01-24', workDate: '2026-01-24', day: '24', entry1: '14:36', exit1: '20:02', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-01-30', date: '2026-01-30', workDate: '2026-01-30', day: '30', entry1: '11:43', exit1: '12:07', entry2: '21:04', exit2: '23:34', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-01-31', date: '2026-01-31', workDate: '2026-01-31', day: '31', entry1: '12:33', exit1: '18:29', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-02', date: '2026-02-02', workDate: '2026-02-02', day: '02', entry1: '22:02', exit1: '23:34', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-03', date: '2026-02-03', workDate: '2026-02-03', day: '03', entry1: '10:30', exit1: '12:00', entry2: '22:08', exit2: '23:25', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-04', date: '2026-02-04', workDate: '2026-02-04', day: '04', entry1: '22:03', exit1: '', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-05', date: '2026-02-05', workDate: '2026-02-05', day: '05', entry1: '', exit1: '00:01', entry2: '11:29', exit2: '12:01', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-06', date: '2026-02-06', workDate: '2026-02-06', day: '06', entry1: '11:13', exit1: '12:02', entry2: '21:08', exit2: '23:09', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-07', date: '2026-02-07', workDate: '2026-02-07', day: '07', entry1: '13:06', exit1: '18:42', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-09', date: '2026-02-09', workDate: '2026-02-09', day: '09', entry1: '22:00', exit1: '23:32', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-10', date: '2026-02-10', workDate: '2026-02-10', day: '10', entry1: '22:03', exit1: '23:32', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-11', date: '2026-02-11', workDate: '2026-02-11', day: '11', entry1: '11:10', exit1: '12:09', entry2: '22:02', exit2: '23:37', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-02-12', date: '2026-02-12', workDate: '2026-02-12', day: '12', entry1: '22:07', exit1: '23:43', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
];

function bucketTotalsByCode(result: ReturnType<typeof runOvertimeEngine>) {
  return Object.fromEntries(
    result.overtimeBuckets.map((bucket) => [bucket.code, { hours: bucket.hours, minutes: bucket.minutes, amount: bucket.amount }])
  ) as Record<string, { hours: number; minutes: number; amount: number }>;
}

describe('runOvertimeEngine - fevereiro/2026 overnight', () => {
  it('deve normalizar a jornada overnight entre 04/02 e 05/02 antes do processamento', () => {
    const normalized = normalizeOvernightEntries(februaryEntries);
    const day0402 = normalized.find((entry) => entry.workDate === '2026-02-04');
    const day0502 = normalized.find((entry) => entry.workDate === '2026-02-05');

    expect(day0402?.entry1).toBe('22:03');
    expect(day0402?.exit1).toBe('00:01');
    expect(day0502?.entry1).toBe('');
    expect(day0502?.exit1).toBe('');
  });

  it('deve bater os totais de bucket do cenario real de fevereiro/2026', () => {
    const normalized = normalizeOvernightEntries(februaryEntries);
    const result = runOvertimeEngine(normalized, buildFebruarySettings());
    const bucketTotals = bucketTotalsByCode(result);

    expect(bucketTotals['105'].hours).toBe(9.0);
    expect(bucketTotals['359'].hours).toBe(6.0);
    expect(bucketTotals['203'].hours).toBe(22.15);
    expect(bucketTotals['396'].hours).toBe(13.26);
    expect(bucketTotals['393'].hours).toBe(0.21);
    expect(bucketTotals['108'].hours).toBe(5.03);
  });
});
