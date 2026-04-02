import {
  normalizeOvernightEntries,
  summarizeNightWorkedMinutes,
  timeToMinutes,
  type CompanyCalculationConfig,
  type CompanyRubricKey,
  type CompanyRubricMap,
  type Settings,
  type TimeEntry,
} from './calculations';
import { NIGHT_END_MINUTES } from './timeMath';

// ---------------------------------------------------------
//  FERIADOS FIXOS DO BRASIL
// ---------------------------------------------------------
const FERIADOS_NACIONAIS_FIXOS = [
  '01-01', '04-21', '05-01', '09-07',
  '10-12', '11-02', '11-15', '11-20', '12-25',
];

// ---------------------------------------------------------
//  CÁLCULO DA PÁSCOA – ALGORITMO DE GAUSS
// ---------------------------------------------------------
function normalizeHolidayToken(value: string): string | null {
  const normalized = String(value || '').trim();
  if (/^\d{2}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return null;
}

// ---------------------------------------------------------
//  FERIADOS MÓVEIS (CARNAVAL, SEXTA SANTA, CORPUS CHRISTI)
// ---------------------------------------------------------
function resolveHolidayMatchers(customHolidays: string[] = []) {
  const monthDayHolidays = new Set(FERIADOS_NACIONAIS_FIXOS);
  const exactDateHolidays = new Set<string>();

  for (const rawHoliday of customHolidays) {
    const normalized = normalizeHolidayToken(rawHoliday);
    if (!normalized) continue;
    if (normalized.length === 5) monthDayHolidays.add(normalized);
    else exactDateHolidays.add(normalized);
  }

  return { monthDayHolidays, exactDateHolidays };
}

export function getDiasBaseDsrMensal(
  mes: number,
  ano: number,
  customHolidays: string[] = []
) {
  const startDate = new Date(ano, mes - 1, 1);
  const endDate = new Date(ano, mes, 0);
  let diasBase = 0;
  let descansos = 0;
  const feriadosConsiderados = new Set<string>();
  const { monthDayHolidays, exactDateHolidays } = resolveHolidayMatchers(customHolidays);

  const current = new Date(startDate);
  while (current <= endDate) {
    const isoDate = current.toISOString().slice(0, 10);
    const mesDia = isoDate.slice(5, 10);
    const isFeriado = monthDayHolidays.has(mesDia) || exactDateHolidays.has(isoDate);
    const isDomingo = current.getDay() === 0;

    if (isFeriado || isDomingo) descansos++;
    else diasBase++;
    if (isFeriado) feriadosConsiderados.add(isoDate);

    current.setDate(current.getDate() + 1);
  }

  return {
    diasBase,
    descansos,
    feriados: Array.from(feriadosConsiderados).sort(),
  };
}

// ---------------------------------------------------------
//  DIAS ÚTEIS E DOMINGOS/FERIADOS
// ---------------------------------------------------------
export function getDiasUteisEDomingos(
  mes: number,
  ano: number,
  cycleStartDay: number = 1,
  customHolidays: string[] = []
) {

  let startDate: Date;
  let endDate: Date;

  if (cycleStartDay <= 1) {
    startDate = new Date(ano, mes - 1, 1);
    endDate = new Date(ano, mes, 0);
  } else {
    // Regra de competência (day > cycleStartDay => mês anterior):
    // período da referência MM/YYYY é de (cycleStartDay + 1) do mês anterior
    // até cycleStartDay do mês da referência.
    startDate = new Date(ano, mes - 2, cycleStartDay + 1);
    endDate = new Date(ano, mes - 1, cycleStartDay);
  }

  let diasUteis = 0;
  let domingosEFeriados = 0;
  const feriadosConsiderados = new Set<string>();
  const { monthDayHolidays, exactDateHolidays } = resolveHolidayMatchers(customHolidays);

  const current = new Date(startDate);
  while (current <= endDate) {
    const diaSemana = current.getDay(); // 0 domingo, 6 sábado
    const isoDate = current.toISOString().slice(0, 10);
    const mesDia = isoDate.slice(5, 10);
    const isFeriado = monthDayHolidays.has(mesDia) || exactDateHolidays.has(isoDate);
    const isDomingo = diaSemana === 0;
    const isSabado = diaSemana === 6;

    if (isFeriado || isDomingo) domingosEFeriados++;
    else if (!isSabado) diasUteis++;
    if (isFeriado) feriadosConsiderados.add(isoDate);

    current.setDate(current.getDate() + 1);
  }

  return {
    diasUteis,
    domingosEFeriados,
    feriados: Array.from(feriadosConsiderados).sort(),
  };
}

// ---------------------------------------------------------
//  FUNÇÃO PRINCIPAL (AGORA COM SUPORTE A ADIANTAMENTO PAGO)
// ---------------------------------------------------------
export interface AdiantamentoPago {
  bruto: number;
  irRetido: number;
}

export interface PayrollParams {
  salarioBase: number;
  horasMensais: number;
  horasExtras?: number; // deprecated: use he50/he75/he100/he125 individuais
  he50: number;
  he75: number;
  he100: number;
  he125: number;
  perc50: number;
  perc100: number;
  percNight: number;
  mes: number;
  ano: number;
  atraso?: number;
  dependentes?: number;
  adiantamentoPercent?: number;
  adiantamentoPago?: AdiantamentoPago | null;
  cycleStartDay?: number;
  rubrics?: Partial<CompanyRubricMap>;
  companyConfig?: Partial<CompanyCalculationConfig>;
  normalEntries?: TimeEntry[];
  roundingCarryover?: number;
  overtimeBuckets?: Array<{
    rubricKey: string;
    code: string;
    label: string;
    multiplier: number;
    period?: 'day' | 'night' | 'any';
    minutes: number;
    amount: number;
  }>;
  discountBuckets?: Array<{
    rubricKey: string;
    code: string;
    label: string;
    minutes: number;
    amount: number;
  }>;
}

export interface PayrollLine {
  code: string;
  description: string;
  reference: number | string | null;
  amount: number;
}

const EMPTY_RUBRICS: CompanyRubricMap = {
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
};

const RUBRIC_FALLBACK_LABELS: Record<CompanyRubricKey, string> = {
  SALARIO_FIXO: 'Salario Fixo',
  HE_50: 'Hora Extra 50%',
  HE_75: 'Hora Extra 75%',
  HE_100: 'Hora Extra 100%',
  HE_125: 'Hora Extra 125%',
  ADIC_NOT: 'Adicional Noturno',
  DSR_HE: 'DSR sobre HE',
  DSR_NOT: 'DSR sobre Adicional Noturno',
  ATRASO: 'Atrasos',
  DSR_ATRASO: 'DSR sobre Atraso',
};

function buildEffectiveRubrics(rubrics?: Partial<CompanyRubricMap>): CompanyRubricMap {
  const output = { ...EMPTY_RUBRICS };
  for (const key of Object.keys(output) as CompanyRubricKey[]) {
    const entry = rubrics?.[key];
    output[key] = {
      code: String(entry?.code || '').trim(),
      label: String(entry?.label || RUBRIC_FALLBACK_LABELS[key]).trim(),
    };
  }
  return output;
}

function buildEffectiveCompanyConfig(companyConfig: Partial<CompanyCalculationConfig>, legacy?: Partial<Settings>) {
  return {
    cycleStartDay: Number(companyConfig.cycleStartDay ?? legacy?.cycleStartDay ?? 1),
    nightCutoff: String(companyConfig.nightCutoff ?? legacy?.nightCutoff ?? '22:00'),
    percent50: Number(companyConfig.percent50 ?? legacy?.percent50 ?? 0),
    percent100: Number(companyConfig.percent100 ?? legacy?.percent100 ?? 0),
    percentNight: Number(companyConfig.percentNight ?? legacy?.percentNight ?? 0),
    roundingCarryover: Number(companyConfig.roundingCarryover ?? 0),
    customHolidays: Array.isArray(companyConfig.customHolidays)
      ? companyConfig.customHolidays
        .map((holiday) => normalizeHolidayToken(String(holiday || '')))
        .filter((holiday): holiday is string => !!holiday)
      : [],
  };
}

export function calcularHoleriteCompleto({
  salarioBase,
  horasMensais,
  he50,
  he75,
  he100,
  he125,
  perc50,
  perc100,
  percNight,
  mes,
  ano,
  atraso = 0,
  dependentes = 0,
  adiantamentoPercent = 45,
  adiantamentoPago = null,
  cycleStartDay = 1,
  rubrics = {},
  companyConfig = {},
  normalEntries = [],
  roundingCarryover = 0
  ,
  overtimeBuckets = [],
  discountBuckets = []
}: PayrollParams) {
  const effectiveRubrics = buildEffectiveRubrics(rubrics);
  const effectiveConfig = buildEffectiveCompanyConfig(companyConfig, {
    cycleStartDay,
    nightCutoff: companyConfig.nightCutoff,
    percent50: perc50,
    percent100: perc100,
    percentNight: percNight,
  } as Partial<Settings>);
  const effectiveCycleStartDay = effectiveConfig.cycleStartDay;
  const effectivePercentNight = effectiveConfig.percentNight;
  const effectivePercent50 = effectiveConfig.percent50;
  const effectivePercent100 = effectiveConfig.percent100;
  const previousRoundingCarryover = Math.max(0, Number(effectiveConfig.roundingCarryover ?? roundingCarryover ?? 0));
  // 1) Dias úteis e domingos/feriados
  const { diasUteis, domingosEFeriados, feriados } = getDiasUteisEDomingos(
    mes,
    ano,
    effectiveCycleStartDay,
    effectiveConfig.customHolidays
  );
  const {
    diasBase: diasBaseDsr,
    descansos: descansosDsr,
    feriados: feriadosDsr,
  } = getDiasBaseDsrMensal(mes, ano, effectiveConfig.customHolidays);

  // 2) Valor hora
  const valorHora = salarioBase / (horasMensais || 1);

  // 3) Horas extras
  // Novas regras solicitadas:
  // HE 75% = HE 50% + Adicional Noturno
  // HE 125% = HE 100% + Adicional Noturno
  const rate50 = valorHora * (1 + effectivePercent50 / 100);
  const rate100 = valorHora * (1 + effectivePercent100 / 100);
  const rate75 = rate50 * (1 + effectivePercentNight / 100);
  const rate125 = rate100 * (1 + effectivePercentNight / 100);

  const v50 = he50 * rate50;
  const v75 = he75 * rate75;
  const v100 = he100 * rate100;
  const v125 = he125 * rate125;
  const hasDynamicBuckets = overtimeBuckets.length > 0;
  const totalHorasExtras = hasDynamicBuckets
    ? overtimeBuckets.reduce((sum, bucket) => sum + bucket.amount, 0)
    : v50 + v75 + v100 + v125;
  const baseHorasExtrasParaDsr = hasDynamicBuckets
    ? overtimeBuckets
        .filter((bucket) => bucket.rubricKey !== 'INTERJORNADA')
        .reduce((sum, bucket) => sum + bucket.amount, 0)
    : v50 + v75 + v100 + v125;

  const normalizedNormalEntries = normalizeOvernightEntries(
    (normalEntries || []).filter((entry) => !entry?.isOvertimeCard)
  );
  const normalNightSummary = summarizeNightWorkedMinutes(
    normalizedNormalEntries,
    timeToMinutes(effectiveConfig.nightCutoff || '22:00'),
    NIGHT_END_MINUTES
  );
  const adicionalNoturno = (normalNightSummary.financialMinutes / 60) * valorHora * (effectivePercentNight / 100);

  // 4) DSR sobre horas extras
  const dsrSobreHorasExtras = diasBaseDsr > 0 ? (baseHorasExtrasParaDsr / diasBaseDsr) * descansosDsr : 0;
  const dsrSobreAdicionalNoturno = diasBaseDsr > 0 ? (adicionalNoturno / diasBaseDsr) * descansosDsr : 0;
  const valorDSR = dsrSobreHorasExtras + dsrSobreAdicionalNoturno;
  const descontoDSRAtraso = diasUteis > 0 ? (atraso / diasUteis) * domingosEFeriados : 0;

  // 5) Total proventos
  const totalProventos = salarioBase + totalHorasExtras + adicionalNoturno + valorDSR;

  // 6) INSS progressivo (faixas oficiais de 2026)
  const INSS_FAIXAS_2026 = [
    { limite: 1621.00, aliquota: 0.075 },
    { limite: 2902.84, aliquota: 0.09 },
    { limite: 4354.27, aliquota: 0.12 },
    { limite: 8475.55, aliquota: 0.14 },
  ];
  const tetoINSS = INSS_FAIXAS_2026[INSS_FAIXAS_2026.length - 1].limite;
  const baseINSS = Math.min(Math.max(0, totalProventos), tetoINSS);
  let inss = 0;
  let restanteINSS = baseINSS;
  let limiteAnterior = 0;
  for (const faixa of INSS_FAIXAS_2026) {
    if (restanteINSS <= 0) break;
    const amplitude = faixa.limite - limiteAnterior;
    const baseFaixa = Math.min(restanteINSS, amplitude);
    inss += baseFaixa * faixa.aliquota;
    restanteINSS -= baseFaixa;
    limiteAnterior = faixa.limite;
  }

  // 7) IR total devido no mês (Tabela TRADICIONAL + Redutor 2026 simultâneo)
  const valorDependente = 189.59;
  const baseIR = totalProventos - inss - dependentes * valorDependente;

  // Imposto calculado pela tabela tradicional mensal (valores vigentes 2025/2026)
  let irBaseTradicional = 0;
  if (baseIR <= 2428.80) irBaseTradicional = 0;
  else if (baseIR <= 2826.65) irBaseTradicional = baseIR * 0.075 - 182.16;
  else if (baseIR <= 3751.05) irBaseTradicional = baseIR * 0.15 - 394.16;
  else if (baseIR <= 4664.68) irBaseTradicional = baseIR * 0.225 - 675.49;
  else irBaseTradicional = baseIR * 0.275 - 908.73;
  if (irBaseTradicional < 0) irBaseTradicional = 0;

  // Redutor mensal 2026 (aplicado simultaneamente à tabela tradicional)
  const rendaMensal = totalProventos;
  let redutorMensal2026 = 0;
  if (rendaMensal <= 5000) {
    // isenção total até R$ 5.000/mês
    redutorMensal2026 = irBaseTradicional;
  } else if (rendaMensal <= 7350) {
    // fórmula oficial: 978,62 – (0,133145 × renda mensal)
    redutorMensal2026 = 978.62 - 0.133145 * rendaMensal;
    if (redutorMensal2026 < 0) redutorMensal2026 = 0;
  } else {
    redutorMensal2026 = 0;
  }

  let irTotal = irBaseTradicional - redutorMensal2026;
  if (irTotal < 0) irTotal = 0;

  // 8) Adiantamento
  let adiantamentoBruto = salarioBase * (adiantamentoPercent / 100);
  let irRetidoNoAdiantamento = 0;
  
  if (adiantamentoPago && typeof adiantamentoPago.bruto === 'number' && adiantamentoPago.bruto > 0) {
    adiantamentoBruto = Number(adiantamentoPago.bruto);
    irRetidoNoAdiantamento = Number(adiantamentoPago.irRetido || 0);
  } else {
    // se não houver bruto informado, calculamos a partir do percentual.
    // O IR pode vir fixo do settings ou ser 27.5% do bruto
    if (adiantamentoPago && typeof adiantamentoPago.irRetido === 'number' && adiantamentoPago.irRetido > 0) {
       irRetidoNoAdiantamento = adiantamentoPago.irRetido;
    } else {
       irRetidoNoAdiantamento = Number((adiantamentoBruto * 0.275).toFixed(2));
    }
  }
  const adiantamentoLiquido = Number((adiantamentoBruto - irRetidoNoAdiantamento).toFixed(2));

  // 9) IR a lançar no fechamento
  let irRetidoNoFechamento = Number((irTotal - irRetidoNoAdiantamento).toFixed(2));
  if (irRetidoNoFechamento < 0) irRetidoNoFechamento = 0;

  // 10) Total de descontos
  const totalDescontosReal = atraso + descontoDSRAtraso + inss + irRetidoNoFechamento + adiantamentoBruto + previousRoundingCarryover;

  // 11) Arredondamento automático e totalDescontos arredondado
  const totalDescontos = Number(totalDescontosReal.toFixed(2));
  const liquidoSemArredondamento = Number((totalProventos - totalDescontos).toFixed(2));
  const liquidoArredondado = liquidoSemArredondamento > 0 && !Number.isInteger(liquidoSemArredondamento)
    ? Math.ceil(liquidoSemArredondamento)
    : liquidoSemArredondamento;
  const arredondamentoAplicado = Number((liquidoArredondado - liquidoSemArredondamento).toFixed(2));

  // 12) Liquido do pagamento final
  const liquido = Number(liquidoArredondado.toFixed(2));

  // 13) Liquido total recebido no mês
  const liquidoTotalRecebido = Number((liquido + adiantamentoLiquido).toFixed(2));

  // 14) Informações sobre IR do mês
  const totalIRRetidoNoMes = Number((irRetidoNoAdiantamento + irRetidoNoFechamento).toFixed(2));

  const overtimeLines: PayrollLine[] = hasDynamicBuckets
    ? overtimeBuckets.map((bucket) => {
        const rubric = effectiveRubrics[bucket.rubricKey] || { code: bucket.code || '', label: bucket.label || bucket.rubricKey };
        return {
          code: rubric.code || bucket.code || '',
          description: rubric.label || bucket.label || bucket.rubricKey,
          reference: Number((bucket.minutes / 60).toFixed(2)),
          amount: Number(bucket.amount.toFixed(2)),
        };
      })
    : [
        { code: effectiveRubrics.HE_50.code, description: effectiveRubrics.HE_50.label, reference: Number(he50.toFixed(2)), amount: Number(v50.toFixed(2)) },
        { code: effectiveRubrics.HE_75.code, description: effectiveRubrics.HE_75.label, reference: Number(he75.toFixed(2)), amount: Number(v75.toFixed(2)) },
        { code: effectiveRubrics.HE_100.code, description: effectiveRubrics.HE_100.label, reference: Number(he100.toFixed(2)), amount: Number(v100.toFixed(2)) },
        { code: effectiveRubrics.HE_125.code, description: effectiveRubrics.HE_125.label, reference: Number(he125.toFixed(2)), amount: Number(v125.toFixed(2)) },
      ].filter((line) => Math.abs(line.amount) > 0);

  const lines: PayrollLine[] = [
    { code: effectiveRubrics.SALARIO_FIXO.code, description: effectiveRubrics.SALARIO_FIXO.label, reference: horasMensais, amount: Number(salarioBase.toFixed(2)) },
    ...overtimeLines,
    { code: effectiveRubrics.ADIC_NOT.code, description: effectiveRubrics.ADIC_NOT.label, reference: Number((normalNightSummary.financialMinutes / 60).toFixed(2)), amount: Number(adicionalNoturno.toFixed(2)) },
    { code: effectiveRubrics.DSR_HE.code, description: effectiveRubrics.DSR_HE.label, reference: Number((dsrSobreHorasExtras / (valorHora || 1)).toFixed(2)), amount: Number(dsrSobreHorasExtras.toFixed(2)) },
    { code: effectiveRubrics.DSR_NOT.code, description: effectiveRubrics.DSR_NOT.label, reference: Number((dsrSobreAdicionalNoturno / (valorHora || 1)).toFixed(2)), amount: Number(dsrSobreAdicionalNoturno.toFixed(2)) },
    ...discountBuckets.map((bucket) => {
      const rubric = effectiveRubrics[bucket.rubricKey] || { code: bucket.code || '', label: bucket.label || bucket.rubricKey };
      return {
        code: rubric.code || bucket.code || '',
        description: rubric.label || bucket.label || bucket.rubricKey,
        reference: Number((bucket.minutes / 60).toFixed(2)),
        amount: Number((-Math.abs(bucket.amount)).toFixed(2)),
      };
    }),
    { code: effectiveRubrics.ATRASO.code, description: effectiveRubrics.ATRASO.label, reference: Number(atraso > 0 ? (atraso / (valorHora || 1)).toFixed(2) : 0), amount: Number((-atraso).toFixed(2)) },
    { code: effectiveRubrics.DSR_ATRASO.code, description: effectiveRubrics.DSR_ATRASO.label, reference: null, amount: Number((-descontoDSRAtraso).toFixed(2)) },
  ].filter((line) => Math.abs(line.amount) > 0);

  return {
    mes,
    ano,
    diasUteis,
    domingosEFeriados,
    feriadosConsiderados: feriados,
    diasBaseDsr,
    descansosDsr,
    feriadosDsrConsiderados: feriadosDsr,
    lines,
    valores: {
      salarioBase: Number(salarioBase.toFixed(2)),
      valorHora: Number(valorHora.toFixed(2)),
      totalHorasExtras: Number(totalHorasExtras.toFixed(2)),
      baseHorasExtrasParaDsr: Number(baseHorasExtrasParaDsr.toFixed(2)),
      adicionalNoturno: Number(adicionalNoturno.toFixed(2)),
      adicionalNoturnoHoras: Number((normalNightSummary.financialMinutes / 60).toFixed(2)),
      dsrSobreHorasExtras: Number(dsrSobreHorasExtras.toFixed(2)),
      dsrSobreAdicionalNoturno: Number(dsrSobreAdicionalNoturno.toFixed(2)),
      dsrSobreHeDiurna: Number(dsrSobreHorasExtras.toFixed(2)),
      dsrSobreHeNoturna: Number(dsrSobreAdicionalNoturno.toFixed(2)),
      diasBaseDsr,
      descansosDsr,
      valorDSR: Number(valorDSR.toFixed(2)),
      totalProventos: Number(totalProventos.toFixed(2)),

      inss: Number(inss.toFixed(2)),
      baseINSS: Number(baseINSS.toFixed(2)),
      baseIR: Number(baseIR.toFixed(2)),
      irBaseTradicional: Number(irBaseTradicional.toFixed(2)),
      redutorMensal2026: Number(redutorMensal2026.toFixed(2)),
      rendaMensalConsiderada: Number(rendaMensal.toFixed(2)),
      irTotal: Number(irTotal.toFixed(2)),
      irRetidoNoAdiantamento: Number(irRetidoNoAdiantamento.toFixed(2)),
      irRetidoNoFechamento: Number(irRetidoNoFechamento.toFixed(2)),
      totalIRRetidoNoMes: Number(totalIRRetidoNoMes.toFixed(2)),

      adiantamentoBruto: Number(adiantamentoBruto.toFixed(2)),
      adiantamentoLiquido: Number(adiantamentoLiquido.toFixed(2)),

      atraso: Number(atraso.toFixed(2)),
      descontoDSRAtraso: Number(descontoDSRAtraso.toFixed(2)),
      arredondamentoAnterior: Number(previousRoundingCarryover.toFixed(2)),
      arredondamento: Number(arredondamentoAplicado.toFixed(2)),
      proximoArredondamento: Number(arredondamentoAplicado.toFixed(2)),
      liquidoSemArredondamento: Number(liquidoSemArredondamento.toFixed(2)),
      totalDescontos: Number(totalDescontos.toFixed(2)),

      liquido: Number(liquido.toFixed(2)),
      liquidoTotalRecebido: Number(liquidoTotalRecebido.toFixed(2)),
      
      v50: Number(v50.toFixed(2)),
      v75: Number(v75.toFixed(2)),
      v100: Number(v100.toFixed(2)),
      v125: Number(v125.toFixed(2)),
      rate50,
      rate75,
      rate100,
      rate125
    }
  };
}
