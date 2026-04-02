import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSuggestedCompanyRubrics,
  calculateOvertime,
  convertNightRealMinutesToFinancial,
  resolveDelayMinutes,
  resolveDailyJourneyMinutes,
  resolveDailyOvertimeDiscountMinutes,
  type Settings,
  type TimeEntry,
} from '../src/lib/calculations.ts';
import { buildProjectedCardFromHolerith } from '../src/lib/holerithProjection.ts';
import { calcularHoleriteCompleto, getDiasBaseDsrMensal, getDiasUteisEDomingos } from '../src/lib/payroll.ts';

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

test('DSR usa apenas feriados configurados e nao trata carnaval como feriado automatico', () => {
  const semFeriadoMunicipal = getDiasUteisEDomingos(3, 2026, 16);
  assert.equal(semFeriadoMunicipal.diasUteis, 20);
  assert.equal(semFeriadoMunicipal.domingosEFeriados, 4);
  assert.deepEqual(semFeriadoMunicipal.feriados, []);

  const comFeriadoConfigurado = getDiasUteisEDomingos(3, 2026, 16, ['2026-03-09']);
  assert.equal(comFeriadoConfigurado.diasUteis, 19);
  assert.equal(comFeriadoConfigurado.domingosEFeriados, 5);
  assert.deepEqual(comFeriadoConfigurado.feriados, ['2026-03-09']);
});

test('base mensal de DSR usa calendario do mes para os fatores dos holerites pagos', () => {
  const dezembro = getDiasBaseDsrMensal(12, 2025);
  assert.equal(dezembro.diasBase, 26);
  assert.equal(dezembro.descansos, 5);
  assert.deepEqual(dezembro.feriados, ['2025-12-25']);

  const janeiro = getDiasBaseDsrMensal(1, 2026);
  assert.equal(janeiro.diasBase, 26);
  assert.equal(janeiro.descansos, 5);
  assert.deepEqual(janeiro.feriados, ['2026-01-01']);

  const fevereiro = getDiasBaseDsrMensal(2, 2026);
  assert.equal(fevereiro.diasBase, 24);
  assert.equal(fevereiro.descansos, 4);
  assert.deepEqual(fevereiro.feriados, []);
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

test('holerite separa DSR de HE do DSR de adicional noturno do cartao normal', () => {
  const rubrics = buildSuggestedCompanyRubrics();
  const settings = createSettings({
    baseSalary: 2200,
    monthlyHours: 220,
    cycleStartDay: 1,
    saturdayCompensation: false,
    compDays: '',
    companySettings: {
      cnpj: '00000000000000',
      name: 'Empresa Teste',
      rubrics,
      config: {
        cycleStartDay: 1,
        nightCutoff: '22:00',
        percent50: 50,
        percent100: 100,
        percentNight: 25,
      },
    },
  });

  const normalEntries = [
    createEntry({
      id: 'normal-night',
      date: '2026-03-02',
      start: '22:00',
      end: '23:00',
      isOvertimeCard: false,
    }),
  ];
  const overtimeEntries = [
    createEntry({
      id: 'extra-night',
      date: '2026-03-03',
      start: '22:00',
      end: '23:00',
      isOvertimeCard: true,
    }),
  ];

  const overtime = calculateOvertime(overtimeEntries, settings);
  assert.ok(overtime);

  const payroll = calcularHoleriteCompleto({
    salarioBase: settings.baseSalary,
    horasMensais: settings.monthlyHours,
    he50: overtime.grandTotal50,
    he75: overtime.grandTotal75,
    he100: overtime.grandTotal100,
    he125: overtime.grandTotal125,
    perc50: settings.percent50,
    perc100: settings.percent100,
    percNight: settings.percentNight,
    mes: 3,
    ano: 2026,
    cycleStartDay: 1,
    rubrics,
    companyConfig: settings.companySettings?.config,
    normalEntries,
    overtimeBuckets: overtime.overtimeBuckets,
    discountBuckets: overtime.discountBuckets,
  });

  const adicNot = payroll.lines.find((line) => line.code === rubrics.ADIC_NOT.code);
  const dsrHe = payroll.lines.find((line) => line.code === rubrics.DSR_HE.code);
  const dsrNot = payroll.lines.find((line) => line.code === rubrics.DSR_NOT.code);

  assert.ok(adicNot);
  assert.ok(dsrHe);
  assert.ok(dsrNot);

  const valorHora = settings.baseSalary / settings.monthlyHours;
  const expectedNightHours = Number((convertNightRealMinutesToFinancial(60) / 60).toFixed(2));
  const exactAdicNot = ((convertNightRealMinutesToFinancial(60) / 60) * valorHora) * 0.25;
  const expectedAdicNot = Number(exactAdicNot.toFixed(2));
  const { diasBase, descansos } = getDiasBaseDsrMensal(3, 2026);
  const expectedDsrHe = Number(((overtime.grandTotalValue / diasBase) * descansos).toFixed(2));
  const exactDsrNot = (exactAdicNot / diasBase) * descansos;
  const expectedDsrNot = Number(exactDsrNot.toFixed(2));

  assert.equal(adicNot?.reference, expectedNightHours);
  assert.equal(adicNot?.amount, expectedAdicNot);
  assert.equal(dsrHe?.amount, expectedDsrHe);
  assert.equal(dsrHe?.reference, Number((expectedDsrHe / valorHora).toFixed(2)));
  assert.equal(dsrNot?.amount, expectedDsrNot);
  assert.equal(dsrNot?.reference, Number((exactDsrNot / valorHora).toFixed(2)));
});

test('3948 usa base financeira mensal das HEs nos holerites pagos de 12-2025 a 02-2026', () => {
  const baseParams = {
    salarioBase: 9251.05,
    horasMensais: 220,
    he50: 0,
    he75: 0,
    he100: 0,
    he125: 0,
    perc50: 50,
    perc100: 100,
    percNight: 25,
  };
  const createBucket = (rubricKey: string, amount: number, referenceHours: number) => ({
    rubricKey,
    code: rubricKey,
    label: rubricKey,
    multiplier: 0,
    period: 'any' as const,
    minutes: Math.round(referenceHours * 60),
    amount,
  });

  const dezembro = calcularHoleriteCompleto({
    ...baseParams,
    mes: 12,
    ano: 2025,
    overtimeBuckets: [
      createBucket('HE_50', 567.68, 9.0),
      createBucket('HE_75', 237.16, 3.0),
      createBucket('HE_100', 1118.54, 13.3),
      createBucket('HE_125', 633.91, 6.03),
    ],
  });
  assert.equal(dezembro.diasBaseDsr, 26);
  assert.equal(dezembro.descansosDsr, 5);
  assert.ok(Math.abs(dezembro.valores.dsrSobreHorasExtras - 491.99) < 0.25);
  assert.ok(Math.abs((dezembro.lines.find((line) => line.description === 'DSR sobre HE')?.reference as number) - 11.7) < 0.02);

  const janeiro = calcularHoleriteCompleto({
    ...baseParams,
    mes: 1,
    ano: 2026,
    overtimeBuckets: [
      createBucket('HE_50', 189.23, 3.0),
      createBucket('HE_75', 124.91, 1.58),
      createBucket('HE_100', 708.13, 8.42),
    ],
  });
  assert.equal(janeiro.diasBaseDsr, 26);
  assert.equal(janeiro.descansosDsr, 5);
  assert.ok(Math.abs(janeiro.valores.dsrSobreHorasExtras - 196.37) < 0.25);
  assert.ok(Math.abs((janeiro.lines.find((line) => line.description === 'DSR sobre HE')?.reference as number) - 4.67) < 0.02);

  const fevereiro = calcularHoleriteCompleto({
    ...baseParams,
    mes: 2,
    ano: 2026,
    overtimeBuckets: [
      createBucket('HE_50', 567.68, 9.0),
      createBucket('HE_75', 474.33, 6.0),
      createBucket('HE_100', 1862.83, 22.15),
      createBucket('HE_125', 1393.97, 13.26),
    ],
  });
  assert.equal(fevereiro.diasBaseDsr, 24);
  assert.equal(fevereiro.descansosDsr, 4);
  assert.ok(Math.abs(fevereiro.valores.dsrSobreHorasExtras - 716.54) < 0.25);
  assert.ok(Math.abs((fevereiro.lines.find((line) => line.description === 'DSR sobre HE')?.reference as number) - 17.04) < 0.02);
});
