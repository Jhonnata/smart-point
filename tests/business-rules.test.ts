import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateOvertime,
  convertNightRealMinutesToFinancial,
  resolveDelayMinutes,
  resolveDailyJourneyMinutes,
  resolveDailyOvertimeDiscountMinutes,
  type Settings,
  type TimeEntry,
} from '../src/lib/calculations.ts';
import { buildProjectedCardFromHolerith } from '../src/lib/holerithProjection.ts';
import { calcularHoleriteCompleto } from '../src/lib/payroll.ts';

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
    overtimeDiscountEnabled: true,
    overtimeDiscountThresholdOneHours: 4,
    overtimeDiscountMinutesOne: 15,
    overtimeDiscountThresholdTwoHours: 6,
    overtimeDiscountMinutesTwo: 40,
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
    annotationText: '',
  };
}

test('desconto diario de HE usa as faixas configuradas e prioriza a primeira faixa aplicavel', () => {
  const settings = createSettings();
  assert.equal(resolveDailyOvertimeDiscountMinutes(3 * 60 + 59, settings), 0);
  assert.equal(resolveDailyOvertimeDiscountMinutes(4 * 60, settings), 15);
  assert.equal(resolveDailyOvertimeDiscountMinutes(5 * 60, settings), 15);
  assert.equal(resolveDailyOvertimeDiscountMinutes(6 * 60, settings), 15);
  assert.equal(resolveDailyOvertimeDiscountMinutes(5 * 60 + 56, settings), 15);
});

test('desconto diario de HE pode ser desativado nas configuracoes', () => {
  const settings = createSettings({ overtimeDiscountEnabled: false });
  assert.equal(resolveDailyOvertimeDiscountMinutes(8 * 60, settings), 0);
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
  assert.equal(result.grandTotal50Minutes, 120);
  assert.ok(Math.abs(result.grandTotal75Minutes - 171.4286) < 0.01);
  assert.equal(result.grandTotal100Minutes, 0);
  assert.equal(result.grandTotal125Minutes, 0);
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
  assert.ok(Math.abs(result.grandTotal75Minutes - 137.1429) < 0.01);
  assert.equal(result.grandTotal100Minutes, 0);
  assert.equal(result.grandTotal125Minutes, 0);
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

test('taxas noturnas usam multiplicacao composta no motor e na folha', () => {
  const settings = createSettings({ baseSalary: 2200, monthlyHours: 220, percent50: 50, percent100: 100, percentNight: 25 });
  const result = calculateOvertime([], settings);
  assert.ok(result);
  assert.equal(result.rate50, 15);
  assert.equal(result.rate75, 18.75);
  assert.equal(result.rate100, 20);
  assert.equal(result.rate125, 25);

  const payroll = calcularHoleriteCompleto({
    salarioBase: 2200,
    horasMensais: 220,
    he50: 1,
    he75: 1,
    he100: 1,
    he125: 1,
    perc50: 50,
    perc100: 100,
    percNight: 25,
    mes: 3,
    ano: 2026,
    cycleStartDay: 16,
  });
  assert.equal(payroll.valores.rate75, 18.75);
  assert.equal(payroll.valores.rate125, 25);
  assert.ok(payroll.valores.dsrSobreHeDiurna >= 0);
  assert.ok(payroll.valores.dsrSobreHeNoturna >= 0);
});

test('limite mensal de 15h por faixa faz transbordo da 50/75 para 100/125', () => {
  const settings = createSettings({
    weeklyLimit: 99,
    saturdayCompensation: false,
    companySettings: {
      cnpj: '00000000000000',
      name: 'Empresa Teste',
      rubrics: {
        SALARIO_FIXO: { code: '', label: '' },
        HE_50: { code: '', label: '' },
        HE_75: { code: '', label: '' },
        HE_100: { code: '', label: '' },
        HE_125: { code: '', label: '' },
        ADIC_NOT: { code: '', label: '' },
        DSR_HE: { code: '', label: '' },
        DSR_NOT: { code: '', label: '' },
        ATRASO: { code: '', label: '' },
        DSR_ATRASO: { code: '', label: '' },
      },
      config: {
        monthlyLimitHE: 900,
      },
    },
  });
  const entries: TimeEntry[] = [];

  for (let day = 2; day <= 23; day++) {
    if ([7, 8, 14, 15, 21, 22].includes(day)) continue;
    entries.push(createEntry({
      id: `d${day}`,
      date: `2026-03-${String(day).padStart(2, '0')}`,
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }));
  }

  const result = calculateOvertime(entries, settings);
  assert.ok(result);
  assert.ok(Math.abs(result.grandTotal50Minutes - 900) < 1);
  assert.ok(Math.abs(result.grandTotal75Minutes - 900) < 1);
  assert.ok(result.grandTotal100Minutes > 0);
  assert.ok(result.grandTotal125Minutes > 0);
});

test('anotacao ABONADO ignora o dia e anotacao BCO manda o tempo para banco', () => {
  const settings = createSettings({ weeklyLimit: 3, saturdayCompensation: false });
  const abonado: TimeEntry = {
    ...createEntry({
      id: 'abonado',
      date: '2026-03-02',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
    annotationText: 'ABONADO',
  };
  const bco: TimeEntry = {
    ...createEntry({
      id: 'bco',
      date: '2026-03-03',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
    annotationText: 'BCO',
  };

  const result = calculateOvertime([abonado, bco], settings);
  assert.ok(result);
  assert.equal(result.grandTotal50Minutes, 0);
  assert.equal(result.grandTotal75Minutes, 0);
  assert.equal(result.grandTotal100Minutes, 0);
  assert.equal(result.grandTotal125Minutes, 0);
  assert.ok(Math.abs(result.grandTotalBancoHoras - 128.5714) < 0.01);
});

test('empresa com HE 60 sem faixa de HE 100 contabiliza tudo na rubrica configurada', () => {
  const settings = createSettings({
    weeklyLimit: 0,
    percentNight: 25,
    companySettings: {
      cnpj: '11111111111111',
      name: 'Empresa HE60',
      rubrics: {
        SALARIO_FIXO: { code: '0116', label: 'Salario Fixo' },
        HE_60: { code: '2060', label: 'Hora Extra 60%' },
        HE_85: { code: '2085', label: 'Hora Extra 85%' },
        ADIC_NOT: { code: '1082', label: 'Adicional Noturno' },
        DSR_HE: { code: '3948', label: 'DSR HE' },
        DSR_NOT: { code: '3930', label: 'DSR Noturno' },
        ATRASO: { code: '5142', label: 'Atrasos' },
        DSR_ATRASO: { code: '5312', label: 'DSR Atraso' },
      },
      config: {
        overtimeRules: [
          {
            id: 'he60-day',
            label: 'HE 60 Diurna',
            rubricKey: 'HE_60',
            multiplier: 1.6,
            period: 'day',
            dayType: 'weekday',
            priority: 1,
          },
          {
            id: 'he85-night',
            label: 'HE 85 Noturna',
            rubricKey: 'HE_85',
            multiplier: 2.0,
            period: 'night',
            dayType: 'weekday',
            priority: 2,
          },
        ],
      },
    },
  });

  const result = calculateOvertime([
    createEntry({
      id: 'he60',
      date: '2026-03-02',
      start: '21:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
  ], settings);

  assert.ok(result);
  assert.equal(result.overtimeBuckets.length, 2);
  assert.equal(result.overtimeBuckets.find((bucket) => bucket.rubricKey === 'HE_60')?.minutes, 60);
  assert.ok(Math.abs((result.overtimeBuckets.find((bucket) => bucket.rubricKey === 'HE_85')?.minutes || 0) - 68.5714) < 0.01);

  const payroll = calcularHoleriteCompleto({
    salarioBase: 2200,
    horasMensais: 220,
    he50: 0,
    he75: 0,
    he100: 0,
    he125: 0,
    perc50: 50,
    perc100: 100,
    percNight: 25,
    mes: 3,
    ano: 2026,
    rubrics: settings.companySettings?.rubrics,
    companyConfig: settings.companySettings?.config,
    overtimeBuckets: result.overtimeBuckets,
  });

  assert.ok(payroll.lines.some((line) => line.code === '2060'));
  assert.ok(payroll.lines.some((line) => line.code === '2085'));
  assert.equal(payroll.lines.some((line) => line.description === 'Hora Extra 100%'), false);
});

test('hora noturna reduzida converte minutos reais em financeiros', () => {
  assert.ok(Math.abs(convertNightRealMinutesToFinancial(52.5) - 60) < 0.0001);
  assert.ok(Math.abs(convertNightRealMinutesToFinancial(60) - 68.5714285714) < 0.0001);
});

test('interjornada inferior a 11 horas gera bucket de indenizacao', () => {
  const settings = createSettings({ saturdayCompensation: false });
  const result = calculateOvertime([
    createEntry({
      id: 'd1',
      date: '2026-03-02',
      start: '20:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
    createEntry({
      id: 'd2',
      date: '2026-03-03',
      start: '08:00',
      end: '10:00',
      isOvertimeCard: true,
    }),
  ], settings);

  assert.ok(result);
  const interjornada = result.overtimeBuckets.find((bucket) => bucket.rubricKey === 'INTERJORNADA');
  assert.ok(interjornada);
  assert.equal(interjornada?.minutes, 120);
});
