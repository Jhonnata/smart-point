import React from 'react';
import { Printer } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  calculateOvertime,
  normalizeOvernightEntries,
  resolveDailyJourneyMinutes,
  sumEntryWorkedMinutes,
  type Settings,
  type TimeEntry
} from '../lib/calculations';
import { calcularHoleriteCompleto } from '../lib/payroll';
import { formatCurrency } from '../lib/utils';

interface MetaData {
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  month?: string;
  year?: number;
}

interface Props {
  entries: TimeEntry[];
  normalEntries?: TimeEntry[];
  overtimeEntries?: TimeEntry[];
  settings: Settings;
  metadata?: MetaData;
  selectedMonth?: string;
}

export default function HolerithView({
  entries,
  normalEntries,
  overtimeEntries,
  settings,
  metadata,
  selectedMonth
}: Props) {
  const data = React.useMemo(() => {
    if (!entries || entries.length === 0) return null;

    const effectiveEntries = normalizeOvernightEntries(entries);
    const normals = normalizeOvernightEntries(normalEntries ?? effectiveEntries.filter(e => !e.isOvertimeCard));
    const overs = normalizeOvernightEntries(overtimeEntries ?? effectiveEntries.filter(e => !!e.isOvertimeCard));
    const calc = calculateOvertime(effectiveEntries, settings);
    if (!calc) return null;

    let totalAtrasoMinutes = 0;
    normals.forEach((entry) => {
      const date = parseISO(entry.date);
      if (!isValid(date)) return;
      if (date.getDay() === 0) return;

      const dailyMinutes = sumEntryWorkedMinutes(entry);
      const journey = resolveDailyJourneyMinutes(
        settings.dailyJourney || 0,
        !!entry.isOvertimeCard,
        date.getDay(),
        !!settings.saturdayCompensation,
        settings.compDays
      );

      if (entry.isDPAnnotation) return;
      if (dailyMinutes < journey && dailyMinutes > 0) totalAtrasoMinutes += (journey - dailyMinutes);
      else if (dailyMinutes === 0) totalAtrasoMinutes += journey;
    });

    const valorHora = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
    const atrasoValor = (totalAtrasoMinutes / 60) * valorHora;

    const selectedRef = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth) ? selectedMonth : null;
    let month: number;
    let year: number;
    if (selectedRef) {
      const [yearStr, monthStr] = selectedRef.split('-');
      month = Number(monthStr);
      year = Number(yearStr);
    } else {
      const sampleDate = parseISO(entries[0].date);
      month = isValid(sampleDate) ? sampleDate.getMonth() + 1 : Number((metadata?.month || '01'));
      year = isValid(sampleDate) ? sampleDate.getFullYear() : (metadata?.year || new Date().getFullYear());
    }

    const payroll = calcularHoleriteCompleto({
      salarioBase: settings.baseSalary || 0,
      horasMensais: settings.monthlyHours || 220,
      he50: calc.grandTotal50,
      he75: calc.grandTotal75,
      he100: calc.grandTotal100,
      he125: calc.grandTotal125,
      perc50: settings.percent50 || 50,
      perc100: settings.percent100 || 100,
      percNight: settings.percentNight || 25,
      mes: month,
      ano: year,
      atraso: atrasoValor,
      dependentes: settings.dependentes || 0,
      adiantamentoPercent: settings.adiantamentoPercent || 45,
      adiantamentoPago: settings.adiantamentoIR ? { bruto: 0, irRetido: settings.adiantamentoIR } : null,
      cycleStartDay: settings.cycleStartDay || 15
    });

    return { calc, payroll, atrasoValor, month, year, normals, overs };
  }, [entries, normalEntries, overtimeEntries, settings, metadata, selectedMonth]);

  if (!data) {
    return (
      <div className="bg-white border border-zinc-100 rounded-3xl p-10 text-center text-zinc-500">
        Nenhum dado disponível para gerar holerith.
      </div>
    );
  }

  const monthLabel = selectedMonth && isValid(parseISO(`${selectedMonth}-01`))
    ? format(parseISO(`${selectedMonth}-01`), 'MMMM/yyyy', { locale: ptBR })
    : `${String(data.month).padStart(2, '0')}/${data.year}`;

  const proventos = [
    { code: '011', desc: 'SALARIO FIXO', hours: settings.monthlyHours || 220, value: data.payroll.valores.salarioBase },
    { code: '105', desc: 'HORA EXTRA 50%', hours: data.calc.grandTotal50, value: data.payroll.valores.v50 },
    { code: '109', desc: 'HORA EXTRA 75%', hours: data.calc.grandTotal75, value: data.payroll.valores.v75 },
    { code: '203', desc: 'HORA EXTRA 100%', hours: data.calc.grandTotal100, value: data.payroll.valores.v100 },
    { code: '359', desc: 'HORA EXTRA 125%', hours: data.calc.grandTotal125, value: data.payroll.valores.v125 },
    { code: '394', desc: 'DSR S/ HORAS EXTRAS', hours: null, value: data.payroll.valores.valorDSR }
  ].filter((r) => r.value > 0);

  const descontos = [
    { code: '514', desc: 'DESCONTO DE ATRASO', hours: (data.atrasoValor / (data.payroll.valores.valorHora || 1)), value: data.atrasoValor },
    { code: '531', desc: 'DESCONTO D.S.R.', hours: null, value: data.payroll.valores.descontoDSRAtraso || 0 },
    { code: '535', desc: 'ADIANTAMENTO', hours: null, value: data.payroll.valores.adiantamentoBruto },
    { code: '987', desc: 'INSS', hours: null, value: data.payroll.valores.inss },
    { code: '989', desc: 'IRF S/ SALARIO', hours: null, value: data.payroll.valores.irRetidoNoFechamento },
    { code: '930', desc: 'ARREDONDAMENTO', hours: null, value: Math.abs(data.payroll.valores.arredondamento) }
  ].filter((r) => r.value > 0);

  const fgtsBase = data.payroll.valores.totalProventos;
  const fgtsValue = fgtsBase * 0.08;

  return (
    <div className="space-y-6">
      <div className="print:hidden flex justify-end">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-zinc-200 rounded-2xl font-bold text-zinc-700 hover:bg-zinc-50"
        >
          <Printer className="w-4 h-4" />
          Imprimir Holerith
        </button>
      </div>

      <div className="mx-auto max-w-[210mm] min-h-[297mm] bg-white border border-zinc-300 shadow-sm p-8 text-zinc-900">
        <div className="border-b border-zinc-300 pb-4 mb-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-widest text-zinc-500">Demonstrativo de Pagamento</div>
              <h2 className="text-xl font-black">{metadata?.companyName || 'Empresa não informada'}</h2>
              <div className="text-sm text-zinc-600">CNPJ: {metadata?.companyCnpj || '--'}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-zinc-500">Mês/Ano</div>
              <div className="text-lg font-black capitalize">{monthLabel}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-5">
          <div><span className="font-bold">Nome:</span> {metadata?.employeeName || '--'}</div>
          <div><span className="font-bold">Matrícula:</span> {metadata?.employeeCode || '--'}</div>
          <div><span className="font-bold">Função:</span> {metadata?.role || '--'}</div>
          <div><span className="font-bold">Local:</span> {metadata?.location || '--'}</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Proventos</h3>
            <table className="w-full text-sm border border-zinc-300">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="text-left px-2 py-1">Cód.</th>
                  <th className="text-left px-2 py-1">Descrição</th>
                  <th className="text-right px-2 py-1">Horas</th>
                  <th className="text-right px-2 py-1">Valor</th>
                </tr>
              </thead>
              <tbody>
                {proventos.map((row) => (
                  <tr key={`${row.code}-${row.desc}`} className="border-t border-zinc-200">
                    <td className="px-2 py-1">{row.code}</td>
                    <td className="px-2 py-1">{row.desc}</td>
                    <td className="px-2 py-1 text-right">{row.hours == null ? '-' : Number(row.hours).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-semibold">{formatCurrency(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Descontos</h3>
            <table className="w-full text-sm border border-zinc-300">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="text-left px-2 py-1">Cód.</th>
                  <th className="text-left px-2 py-1">Descrição</th>
                  <th className="text-right px-2 py-1">Horas</th>
                  <th className="text-right px-2 py-1">Valor</th>
                </tr>
              </thead>
              <tbody>
                {descontos.map((row) => (
                  <tr key={`${row.code}-${row.desc}`} className="border-t border-zinc-200">
                    <td className="px-2 py-1">{row.code}</td>
                    <td className="px-2 py-1">{row.desc}</td>
                    <td className="px-2 py-1 text-right">{row.hours == null ? '-' : Number(row.hours).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-semibold">{formatCurrency(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
          <div className="border border-zinc-300 p-3 rounded">
            <div className="text-xs uppercase tracking-widest text-zinc-500">Total Proventos</div>
            <div className="text-lg font-black text-emerald-700">{formatCurrency(data.payroll.valores.totalProventos)}</div>
          </div>
          <div className="border border-zinc-300 p-3 rounded">
            <div className="text-xs uppercase tracking-widest text-zinc-500">Total Descontos</div>
            <div className="text-lg font-black text-rose-700">{formatCurrency(data.payroll.valores.totalDescontos)}</div>
          </div>
          <div className="border border-zinc-900 bg-zinc-900 text-white p-3 rounded">
            <div className="text-xs uppercase tracking-widest text-zinc-300">Líquido</div>
            <div className="text-lg font-black">{formatCurrency(data.payroll.valores.liquido)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
          <div><span className="font-bold">Base FGTS:</span> {formatCurrency(fgtsBase)}</div>
          <div><span className="font-bold">FGTS:</span> {formatCurrency(fgtsValue)}</div>
          <div><span className="font-bold">Base IR:</span> {formatCurrency(data.payroll.valores.baseIR)}</div>
          <div><span className="font-bold">Base INSS:</span> {formatCurrency(data.payroll.valores.baseINSS || data.payroll.valores.totalProventos)}</div>
          <div><span className="font-bold">Salário:</span> {formatCurrency(data.payroll.valores.salarioBase)}</div>
          <div><span className="font-bold">Carga Horária:</span> {(settings.monthlyHours || 220).toFixed(2)}</div>
        </div>

        <div className="mt-10 text-xs text-zinc-500">
          São Paulo, {format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </div>
      </div>
    </div>
  );
}
