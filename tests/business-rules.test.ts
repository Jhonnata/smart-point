import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateOvertime,
  resolveDelayMinutes,
  resolveDailyJourneyMinutes,
  resolveDailyOvertimeDiscountMinutes,
  type Settings,
  type TimeEntry,
} from '../src/lib/calculations.ts';
import { buildProjectedCardFromHolerith } from '../src/lib/holerithProjection.ts';

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    baseSalary: 2200,
    monthlyHours: 220,
    dailyJourney: 8,
    weeklyLimit: 3,
    nightCutoff: '22:00',
    percent50: 50,
    percent100: 100,
    percentNight: 25,
    aiProvider: 'gemini',
    geminiModel: 'gemini-3-flash-preview',
    saturdayCompensation: true,
    compDays: '1,2,3,4',
    cycleStartDay: 15,
    workStart: '12:00',
    lunchStart: '17:00',
    lunchEnd: '18:00',
    workEnd: '21:00',
    saturdayWorkStart: '12:00',
    saturdayWorkEnd: '16:00',
    ...overrides,
  };
}

function createEntry(params: {
  id: string;
  date: string;
  day?: string;
  start: string;
  end: string;
  isOvertimeCard?: boolean;
}): TimeEntry {
  return {
    id: params.id,
    date: params.date,
    workDate: params.date,
    day: params.day || params.date.slice(8, 10),
    entry1: params.start,
    exit1: params.end,
    entry2: '',
    exit2: '',
    entryExtra: '',
    exitExtra: '',
    totalHours: '',
    isOvertimeCard: !!params.isOvertimeCard,
  };
}

test('desconto diario de HE respeita os limiares >4h e >6h', () => {
  assert.equal(resolveDailyOvertimeDiscountMinutes(4 * 60), 0);
  assert.equal(resolveDailyOvertimeDiscountMinutes(4 * 60 + 1), 15);
  assert.equal(resolveDailyOvertimeDiscountMinutes(6 * 60), 15);
  assert.equal(resolveDailyOvertimeDiscountMinutes(6 * 60 + 1), 60);
});

test('compensacao de sabado adiciona +1h apenas nos dias configurados e zera o sabado', () => {
  const settings = createSettings({ saturdayCompensation: true, compDays: '1,2,3,4' });

  assert.equal(resolveDailyJourneyMinutes(8, false, 1, true, settings.compDays), 9 * 60);
  assert.equal(resolveDailyJourneyMinutes(8, false, 4, true, settings.compDays), 9 * 60);
  assert.equal(resolveDailyJourneyMinutes(8, false, 5, true, settings.compDays), 8 * 60);
  assert.equal(resolveDailyJourneyMinutes(8, false, 6, true, settings.compDays), 0);
});

test('atraso aplica tolerancia de 5 minutos e conta o excedente real da entrada', () => {
  const settings = createSettings({
    workStart: '12:00',
    saturdayCompensation: false,
  });

  assert.equal(resolveDelayMinutes(createEntry({
    id: 'ok',
    date: '2026-03-02',
    start: '12:05',
    end: '21:00',
  }), 1, {
    workStart: settings.workStart,
    saturdayWorkStart: settings.saturdayWorkStart,
    saturdayCompensation: settings.saturdayCompensation,
    toleranceMinutes: 5,
  }), 0);

  assert.equal(resolveDelayMinutes(createEntry({
    id: 'late',
    date: '2026-03-02',
    start: '12:09',
    end: '21:00',
  }), 1, {
    workStart: settings.workStart,
    saturdayWorkStart: settings.saturdayWorkStart,
    saturdayCompensation: settings.saturdayCompensation,
    toleranceMinutes: 5,
  }), 9);
});

test('as 3 primeiras horas extras semanais sao classificadas em ordem cronologica', () => {
  const settings = createSettings({ weeklyLimit: 3, saturdayCompensation: false });
  const entries: TimeEntry[] = [
    createEntry({
      id: 'mon',
      date: '2026-03-02',
      start: '21:00',
      end: '23:30',
      isOvertimeCard: true,
    }),
    createEntry({
      id: 'tue',
      date: '2026-03-03',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
  ];

  const result = calculateOvertime(entries, settings);
  assert.ok(result);
  assert.equal(result.grandTotal50Minutes, 90);
  assert.equal(result.grandTotal75Minutes, 90);
  assert.equal(result.grandTotal100Minutes, 30);
  assert.equal(result.grandTotal125Minutes, 60);
});

test('o limite semanal de 3h continua em semana real mesmo na virada de mes', () => {
  const settings = createSettings({ weeklyLimit: 3, saturdayCompensation: false });
  const entries: TimeEntry[] = [
    createEntry({
      id: 'apr30',
      date: '2026-04-30',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
    createEntry({
      id: 'may01',
      date: '2026-05-01',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
  ];

  const result = calculateOvertime(entries, settings);
  assert.ok(result);
  assert.equal(result.grandTotal50Minutes, 120);
  assert.equal(result.grandTotal75Minutes, 60);
  assert.equal(result.grandTotal100Minutes, 0);
  assert.equal(result.grandTotal125Minutes, 60);
});

test('a projecao respeita jornada compensada ate 22h em Seg-Qui e 21h na Sexta', () => {
  const settings = createSettings({ saturdayCompensation: true, compDays: '1,2,3,4' });
  const projected = buildProjectedCardFromHolerith({
    referenceMonth: '2026-03',
    settings,
    parsed: {
      rawText: '',
      normalizedText: '',
      employeeName: 'Teste',
      competenceMonth: 3,
      competenceYear: 2026,
      he50Minutes: 0,
      he75Minutes: 0,
      he100Minutes: 0,
      he125Minutes: 0,
      atrasoMinutes: 0,
    },
  });

  const monday = projected.hours.find((row) => row.date === '2026-03-02');
  const thursday = projected.hours.find((row) => row.date === '2026-03-05');
  const friday = projected.hours.find((row) => row.date === '2026-03-06');

  assert.ok(monday);
  assert.ok(thursday);
  assert.ok(friday);
  assert.equal(monday?.exit2, '22:00');
  assert.equal(thursday?.exit2, '22:00');
  assert.equal(friday?.exit2, '21:00');
});
