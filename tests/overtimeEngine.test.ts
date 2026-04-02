import { describe, expect, it } from 'vitest';

import type { Settings, TimeEntry } from '../src/lib/calculations';
import { analyzeDailyOvertimePreview, runOvertimeEngine } from '../src/lib/overtimeEngine';

function buildMarchSettings(): Settings {
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
      name: 'Empresa Teste Marco/2026',
      rubrics: {
        HE_50: { code: '1058', label: 'Hora Extra 50%' },
        HE_75: { code: '3590', label: 'H.E. 50/25% (75%)' },
        HE_100: { code: '2038', label: 'Hora Extra 100%' },
        HE_125: { code: '3964', label: 'H.E. 100/25% (125%)' },
        DESC_HE_2: { code: '9192', label: 'Desconto Intrajornada' },
        INTERJORNADA: { code: '3930', label: 'Indenizacao Interjornada' },
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
            label: 'HE 50/25% Noturna',
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
            multiplier: 2.0,
            period: 'day',
            dayType: 'weekday',
            priority: 3,
            active: true,
          },
          {
            id: 'he125-night',
            label: 'HE 100/25% Noturna',
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
            multiplier: 2.0,
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
            id: 'intrajornada-40',
            label: 'Desconto Intrajornada',
            rubricKey: 'DESC_HE_2',
            thresholdHours: 6,
            discountMinutes: 15,
            priority: 1,
            active: true,
          },
        ],
      },
    },
  };
}

function buildLegacyDiscountSettings(): Settings {
  return {
    baseSalary: 2500,
    monthlyHours: 220,
    dailyJourney: 8,
    weeklyLimit: 3,
    nightCutoff: '22:00',
    percent50: 50,
    percent100: 100,
    percentNight: 25,
    aiProvider: 'gemini',
    saturdayCompensation: false,
    compDays: '1,2,3,4',
    cycleStartDay: 15,
    overtimeDiscountEnabled: true,
    overtimeDiscountThresholdOneHours: 4,
    overtimeDiscountMinutesOne: 15,
    overtimeDiscountThresholdTwoHours: 6,
    overtimeDiscountMinutesTwo: 60,
  };
}

const marchEntries: TimeEntry[] = [
  { id: '2026-03-03', date: '2026-03-03', workDate: '2026-03-03', day: '03', entry1: '22:02', exit1: '23:36', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-04', date: '2026-03-04', workDate: '2026-03-04', day: '04', entry1: '22:17', exit1: '23:38', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-05', date: '2026-03-05', workDate: '2026-03-05', day: '05', entry1: '11:25', exit1: '12:03', entry2: '22:03', exit2: '23:35', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-06', date: '2026-03-06', workDate: '2026-03-06', day: '06', entry1: '21:02', exit1: '23:50', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-07', date: '2026-03-07', workDate: '2026-03-07', day: '07', entry1: '12:00', exit1: '19:09', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-09', date: '2026-03-09', workDate: '2026-03-09', day: '09', entry1: '22:04', exit1: '23:31', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-10', date: '2026-03-10', workDate: '2026-03-10', day: '10', entry1: '09:48', exit1: '12:04', entry2: '22:03', exit2: '23:32', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-11', date: '2026-03-11', workDate: '2026-03-11', day: '11', entry1: '10:42', exit1: '12:00', entry2: '22:10', exit2: '23:35', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-12', date: '2026-03-12', workDate: '2026-03-12', day: '12', entry1: '11:25', exit1: '12:00', entry2: '22:03', exit2: '23:40', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-13', date: '2026-03-13', workDate: '2026-03-13', day: '13', entry1: '09:51', exit1: '12:04', entry2: '21:17', exit2: '22:40', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-14', date: '2026-03-14', workDate: '2026-03-14', day: '14', entry1: '12:37', exit1: '18:35', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-18', date: '2026-03-18', workDate: '2026-03-18', day: '18', entry1: '22:02', exit1: '23:32', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-19', date: '2026-03-19', workDate: '2026-03-19', day: '19', entry1: '22:08', exit1: '23:31', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-20', date: '2026-03-20', workDate: '2026-03-20', day: '20', entry1: '21:09', exit1: '23:15', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
  { id: '2026-03-21', date: '2026-03-21', workDate: '2026-03-21', day: '21', entry1: '12:30', exit1: '19:45', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', isOvertimeCard: true },
];

function bucketHoursByCode(result: ReturnType<typeof runOvertimeEngine>) {
  return Object.fromEntries(
    result.overtimeBuckets.map((bucket) => [bucket.code, bucket.hours])
  ) as Record<string, number>;
}

describe('runOvertimeEngine - marco/2026 HE card rules', () => {
  it('deve bater os totais consolidados do cartao de HE com bucket semanal independente', () => {
    const result = runOvertimeEngine(marchEntries, buildMarchSettings());
    const hoursByCode = bucketHoursByCode(result);

    expect(hoursByCode['1058']).toBeCloseTo(9.0, 2);
    expect(hoursByCode['3590']).toBeCloseTo(9.0, 2);
    expect(hoursByCode['2038']).toBeCloseTo(20.4, 2);
    expect(hoursByCode['3964']).toBeCloseTo(10.49, 2);
    expect(hoursByCode['1082']).toBeUndefined();
  });

  it('deve validar o desconto de pausa do dia 07 com liquido de 6h54 (6.90 em decimal)', () => {
    const result = runOvertimeEngine([marchEntries[4]], buildMarchSettings());
    const hoursByCode = bucketHoursByCode(result);
    const totalHours = Object.values(hoursByCode).reduce((sum, hours) => sum + hours, 0);
    const discountByCode = Object.fromEntries(
      result.discountBuckets.map((bucket) => [bucket.code, bucket.hours])
    ) as Record<string, number>;

    expect(discountByCode['9192']).toBeCloseTo(0.25, 2);
    expect(totalHours).toBeCloseTo(6.9, 2);
  });

  it('deve expor a mesma apuracao diaria usada pela view do cartao', () => {
    const preview = analyzeDailyOvertimePreview(marchEntries[4], buildMarchSettings());

    expect(preview.discountRealMinutes).toBe(15);
    expect(preview.dayOvertimeMinutes / 60).toBeCloseTo(6.9, 2);
  });

  it('deve manter 15min de desconto no cenario legado quando 4h e 6h estiverem configuradas', () => {
    const preview = analyzeDailyOvertimePreview(
      {
        id: 'legacy-1',
        date: '2026-03-07',
        workDate: '2026-03-07',
        day: '07',
        entry1: '12:00',
        exit1: '19:09',
        entry2: '',
        exit2: '',
        entryExtra: '',
        exitExtra: '',
        totalHours: '',
        isOvertimeCard: true,
      },
      buildLegacyDiscountSettings()
    );

    expect(preview.workedMinutes).toBe(429);
    expect(preview.discountRealMinutes).toBe(15);
    expect(preview.dayOvertimeMinutes).toBe(414);
  });

  it('deve separar horas reais exibidas de minutos financeiros no noturno', () => {
    const preview = analyzeDailyOvertimePreview(marchEntries[0], buildMarchSettings());

    expect(preview.workedMinutes).toBe(94);
    expect(preview.discountRealMinutes).toBe(0);
    expect(preview.dayOvertimeRealMinutes).toBe(94);
    expect(preview.dayOvertimeMinutes).toBeCloseTo(107.43, 2);
  });

  it('deve validar o limite semanal noturno independente e o transbordo para 100/25%', () => {
    const result = runOvertimeEngine(marchEntries, buildMarchSettings());
    const hoursByCode = bucketHoursByCode(result);

    expect(hoursByCode['3590']).toBeCloseTo(9.0, 2);
    expect(hoursByCode['3964']).toBeCloseTo(10.49, 2);
  });
});
