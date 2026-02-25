// ---------------------------------------------------------
//  FERIADOS FIXOS DO BRASIL
// ---------------------------------------------------------
const FERIADOS_FIXOS = [
  "01-01", "04-21", "05-01", "09-07",
  "10-12", "11-02", "11-15", "12-25"
];

// ---------------------------------------------------------
//  CÁLCULO DA PÁSCOA – ALGORITMO DE GAUSS
// ---------------------------------------------------------
function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

// ---------------------------------------------------------
//  FERIADOS MÓVEIS (CARNAVAL, SEXTA SANTA, CORPUS CHRISTI)
// ---------------------------------------------------------
function gerarFeriadosMoveis(ano: number): string[] {
  const pascoa = calcularPascoa(ano);

  const carnavalSeg = new Date(pascoa);
  carnavalSeg.setDate(pascoa.getDate() - 48);

  const carnavalTer = new Date(pascoa);
  carnavalTer.setDate(pascoa.getDate() - 47);

  const sextaSanta = new Date(pascoa);
  sextaSanta.setDate(pascoa.getDate() - 2);

  const corpusChristi = new Date(pascoa);
  corpusChristi.setDate(pascoa.getDate() + 60);

  const format = (d: Date) => d.toISOString().slice(5, 10);

  return [ format(carnavalSeg), format(carnavalTer), format(sextaSanta), format(corpusChristi) ];
}

// ---------------------------------------------------------
//  DIAS ÚTEIS E DOMINGOS/FERIADOS
// ---------------------------------------------------------
export function getDiasUteisEDomingos(mes: number, ano: number, cycleStartDay: number = 1) {
  const feriadosAnoCorrente = [...FERIADOS_FIXOS, ...gerarFeriadosMoveis(ano)];
  const feriadosAnoAnterior = [...FERIADOS_FIXOS, ...gerarFeriadosMoveis(ano - 1)];

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

  const current = new Date(startDate);
  while (current <= endDate) {
    const diaSemana = current.getDay(); // 0 domingo, 6 sábado
    const mesDia = current.toISOString().slice(5, 10);
    const anoRef = current.getFullYear();
    const feriados = anoRef === ano ? feriadosAnoCorrente : feriadosAnoAnterior;
    
    const isFeriado = feriados.includes(mesDia);
    const isDomingo = diaSemana === 0;
    const isSabado = diaSemana === 6;

    if (isFeriado || isDomingo) domingosEFeriados++;
    else if (!isSabado) diasUteis++;

    current.setDate(current.getDate() + 1);
  }

  return { diasUteis, domingosEFeriados, feriados: feriadosAnoCorrente };
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
  cycleStartDay = 1
}: PayrollParams) {
  // 1) Dias úteis e domingos/feriados
  const { diasUteis, domingosEFeriados, feriados } = getDiasUteisEDomingos(mes, ano, cycleStartDay);

  // 2) Valor hora
  const valorHora = salarioBase / (horasMensais || 1);

  // 3) Horas extras
  // Novas regras solicitadas:
  // HE 75% = HE 50% + Adicional Noturno
  // HE 125% = HE 100% + Adicional Noturno
  const rate50 = valorHora * (1 + perc50 / 100);
  const rate75 = valorHora * (1 + (perc50 + percNight) / 100);
  const rate100 = valorHora * (1 + perc100 / 100);
  const rate125 = valorHora * (1 + (perc100 + percNight) / 100);

  const v50 = he50 * rate50;
  const v75 = he75 * rate75;
  const v100 = he100 * rate100;
  const v125 = he125 * rate125;
  
  const totalHorasExtras = v50 + v75 + v100 + v125;

  // 4) DSR sobre horas extras
  const valorDSR = diasUteis > 0 ? (totalHorasExtras / diasUteis) * domingosEFeriados : 0;
  const descontoDSRAtraso = diasUteis > 0 ? (atraso / diasUteis) * domingosEFeriados : 0;

  // 5) Total proventos
  const totalProventos = salarioBase + totalHorasExtras + valorDSR;

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
  const totalDescontosReal = atraso + descontoDSRAtraso + inss + irRetidoNoFechamento + adiantamentoBruto;

  // 11) Arredondamento automático e totalDescontos arredondado
  const totalDescontos = Number(totalDescontosReal.toFixed(2));
  const arredondamento = Number((totalDescontos - totalDescontosReal).toFixed(2));

  // 12) Liquido do pagamento final
  const liquido = Number((totalProventos - totalDescontos).toFixed(2));

  // 13) Liquido total recebido no mês
  const liquidoTotalRecebido = Number((liquido + adiantamentoLiquido).toFixed(2));

  // 14) Informações sobre IR do mês
  const totalIRRetidoNoMes = Number((irRetidoNoAdiantamento + irRetidoNoFechamento).toFixed(2));

  return {
    mes,
    ano,
    diasUteis,
    domingosEFeriados,
    feriadosConsiderados: feriados,
    valores: {
      salarioBase: Number(salarioBase.toFixed(2)),
      valorHora: Number(valorHora.toFixed(2)),
      totalHorasExtras: Number(totalHorasExtras.toFixed(2)),
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
      arredondamento: Number(arredondamento.toFixed(2)),
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
