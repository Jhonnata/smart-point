import React from 'react';
import { DollarSign, TrendingUp, Clock, Calendar, Printer, AlertTriangle, ChevronDown, ChevronUp, FileText, Calculator } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
import { formatCurrency, cn, formatMinutesAsHoursClock } from '../lib/utils';
import { calcularHoleriteCompleto } from '../lib/payroll';
import DualCardView from './DualCardView';
import OvertimeSimulator from './OvertimeSimulator';

interface Props {
  entries: TimeEntry[];
  normalEntries?: TimeEntry[];
  overtimeEntries?: TimeEntry[];
  settings: Settings;
  month?: string;
  onSaveEntries: (entries: TimeEntry[]) => void;
  onUploadClick?: (isOvertime: boolean) => void;
  disableSave?: boolean;
}

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
const hoursToMinutes = (hours: number) => Math.max(0, Math.round((Number.isFinite(hours) ? hours : 0) * 60));

export default function SummaryView({ entries, normalEntries, overtimeEntries, settings, month, onSaveEntries, onUploadClick, disableSave }: Props) {
  const [activeView, setActiveView] = React.useState<'financeiro' | 'extras' | 'simulador' | 'lancamentos'>('financeiro');
  const [showDetails, setShowDetails] = React.useState(false);

  const results = React.useMemo(() => {
    console.log("[DEBUG] SummaryView: entries=", entries?.length, "settings=", !!settings);
    if (!entries || entries.length === 0 || !settings) return null;
    try {
      const effectiveEntries = normalizeOvernightEntries(entries);
      // 1) Calcula horas extras base (jornada, domingo, adicional noturno)
      const res = calculateOvertime(effectiveEntries, settings);
      if (!res) return null;

      // Extra: mapear detalhes dia a dia para a aba de HE
      const dailyDetails: any[] = [];
      
      // 2) Calcula descontos de atraso/falta (baseado no dailyJourney)
      let totalAtrasoMinutes = 0;
      effectiveEntries.forEach(entry => {
        // Ignora se for cartão de apenas extras ou se não houver registros
        const isOvertimeCard = !!entry.isOvertimeCard;
        
        const date = parseISO(entry.date);
        if (!isValid(date)) return;
        const isSunday = date.getDay() === 0;

        const dailyMinutes = sumEntryWorkedMinutes(entry);
        const journeyMin = resolveDailyJourneyMinutes(
          settings.dailyJourney || 0,
          isOvertimeCard,
          date.getDay(),
          !!settings.saturdayCompensation,
          settings.compDays
        );
        
        if (!isOvertimeCard && !isSunday) {
          if (entry.isDPAnnotation) return;
          if (dailyMinutes < journeyMin && dailyMinutes > 0) {
            totalAtrasoMinutes += (journeyMin - dailyMinutes);
          } else if (dailyMinutes === 0) {
            totalAtrasoMinutes += journeyMin;
          }
        }

        // Armazenar para o gráfico/lista de HE detalhado
        if ((dailyMinutes > 0 || isSunday) && isOvertimeCard) {
           dailyDetails.push({
             date: entry.date,
             totalMinutes: dailyMinutes,
             journey: journeyMin,
             isSunday,
             entry
           });
        }
      });

      const valorHora = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
      const totalAtrasoValue = (totalAtrasoMinutes / 60) * valorHora;

      // 3) Calcula Holerite Completo (INSS, IRRF, DSR, etc)
      const selectedRef = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
      let payrollMonth: number;
      let payrollYear: number;
      if (selectedRef) {
        const [yearStr, monthStr] = selectedRef.split('-');
        payrollMonth = Number(monthStr);
        payrollYear = Number(yearStr);
      } else {
        const dateSample = parseISO(entries[0].date);
        if (isValid(dateSample)) {
          payrollMonth = dateSample.getMonth() + 1;
          payrollYear = dateSample.getFullYear();
        } else {
          payrollMonth = Number((entries[0] as any)?.month || 1);
          payrollYear = Number((entries[0] as any)?.year || new Date().getFullYear());
        }
      }

      const payroll = calcularHoleriteCompleto({
        salarioBase: settings.baseSalary || 0,
        horasMensais: settings.monthlyHours || 220,
        he50: res.grandTotal50,
        he75: res.grandTotal75,
        he100: res.grandTotal100,
        he125: res.grandTotal125,
        perc50: settings.percent50 || 50,
        perc100: settings.percent100 || 100,
        percNight: settings.percentNight || 25,
        mes: payrollMonth,
        ano: payrollYear,
        atraso: totalAtrasoValue,
        dependentes: settings.dependentes || 0,
        adiantamentoPercent: settings.adiantamentoPercent || 45,
        adiantamentoPago: settings.adiantamentoIR ? { bruto: 0, irRetido: settings.adiantamentoIR } : null,
        cycleStartDay: settings.cycleStartDay || 15
      });

      return { ...res, payroll, totalAtrasoValue, totalAtrasoMinutes, dailyDetails };
    } catch (err) {
      console.error("Error in Summary calculations", err);
      return null;
    }
  }, [entries, settings, month]);

  const bancoHorasHours = React.useMemo(() => {
    if (!results) return '0h00';
    const m = (results as any).grandTotalBancoHoras || 0;
    return formatMinutesAsHoursClock(m);
  }, [results]);

  if (!results) {
    return (
      <div className="p-6 sm:p-12 text-center bg-white rounded-3xl md:rounded-[2rem] border border-zinc-100 flex flex-col items-center gap-4">
        <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center">
          <Clock className="w-8 h-8 text-zinc-300" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-zinc-900">Configurações incompletas</h3>
          <p className="text-zinc-500 max-w-xs mx-auto">Verifique as configurações financeiras para calcular o resumo.</p>
        </div>
      </div>
    );
  }

  if (results.weeklySummaries.length === 0) {
    return (
      <div className="p-6 sm:p-12 text-center bg-white rounded-3xl md:rounded-[2rem] border border-zinc-100 flex flex-col items-center gap-4">
        <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center">
          <Calendar className="w-8 h-8 text-zinc-300" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-zinc-900">Nenhum dado encontrado</h3>
          <p className="text-zinc-500 max-w-xs mx-auto">Não há registros de ponto para o período selecionado.</p>
        </div>
      </div>
    );
  }

  const dsrValue = (results.grandTotalValue || 0) * (1/6);
  const totalWithDsr = (results.grandTotalValue || 0) + dsrValue;

  const handlePrint = () => {
    window.print();
  };

  const payroll = results.payroll;

  const chartData = results.weeklySummaries.map((week, i) => ({
    name: `Semana ${i + 1}`,
    valor: week.totalValue,
    fullDate: `${format(parseISO(week.weekStart), 'dd/MM', { locale: ptBR })} - ${format(parseISO(week.weekEnd), 'dd/MM', { locale: ptBR })}`
  }));

  return (
    <div className="space-y-6 sm:space-y-8 print:p-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-6 sm:mb-8 gap-4 sm:gap-6 print:hidden">
        <div className="grid grid-cols-2 sm:flex p-1 bg-zinc-100 rounded-2xl w-full lg:w-fit gap-1">
          <button 
            onClick={() => setActiveView('financeiro')}
            className={cn(
              "px-3 sm:px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2",
              activeView === 'financeiro' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <DollarSign className="w-4 h-4" />
            Resumo Financeiro
          </button>
          <button 
            onClick={() => setActiveView('extras')}
            className={cn(
              "px-3 sm:px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2",
              activeView === 'extras' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <Clock className="w-4 h-4" />
            Cálculo de Extras
          </button>
          <button
            onClick={() => setActiveView('lancamentos')}
            className={cn(
              "px-3 sm:px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2",
              activeView === 'lancamentos' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <FileText className="w-4 h-4" />
            Lançamentos
          </button>
          <button
            onClick={() => setActiveView('simulador')}
            className={cn(
              "px-3 sm:px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2",
              activeView === 'simulador' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            )}
          >
            <Calculator className="w-4 h-4" />
            Simulador
          </button>
        </div>
        
        {(activeView === 'financeiro' || activeView === 'extras') && (
          <button 
            onClick={handlePrint}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-white border border-zinc-100 rounded-2xl font-bold text-zinc-600 hover:bg-zinc-50 transition-all shadow-sm w-full sm:w-fit"
          >
            <Printer className="w-5 h-5" />
            Exportar PDF
          </button>
        )}
      </div>

      {activeView === 'financeiro' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
          {/* Main Stats: Holerite Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="bg-zinc-900 p-5 sm:p-8 rounded-3xl md:rounded-[2rem] text-white shadow-xl shadow-zinc-200 relative overflow-hidden md:col-span-2">
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4">
                <DollarSign className="w-4 h-4" />
                Líquido Final a Receber (Fechamento)
              </div>
              <div className="text-4xl sm:text-5xl lg:text-7xl font-black mb-2 tracking-tighter italic break-words">{formatCurrency(payroll.valores.liquido)}</div>
              <div className="text-zinc-400 text-xs sm:text-sm font-bold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Total Recebido no Mês: {formatCurrency(payroll.valores.liquidoTotalRecebido)}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 pt-6 border-t border-white/10 mt-6 sm:mt-8">
              <div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Proventos</div>
                <div className="text-xl sm:text-2xl font-black text-emerald-400 break-words">{formatCurrency(payroll.valores.totalProventos)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Descontos</div>
                <div className="text-xl sm:text-2xl font-black text-rose-400 break-words">-{formatCurrency(payroll.valores.totalDescontos)}</div>
              </div>
            </div>
          </div>
          <div className="absolute -right-8 -bottom-8 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl" />
        </div>

        <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest mb-6">
              <Clock className="w-4 h-4" />
              Horas Extras Consolidadas
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-xl">
                <span className="text-xs font-bold text-zinc-500 uppercase">HE 50%</span>
                <span className="text-lg font-black text-zinc-900">{formatMinutesAsHoursClock((results as any).grandTotal50Minutes ?? hoursToMinutes(results.grandTotal50))}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-xl">
                <span className="text-xs font-bold text-zinc-500 uppercase">HE 100%</span>
                <span className="text-lg font-black text-zinc-900">{formatMinutesAsHoursClock((results as any).grandTotal100Minutes ?? hoursToMinutes(results.grandTotal100))}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl">
                <span className="text-xs font-bold text-emerald-600 uppercase">Banco de Horas (Normal)</span>
                <span className="text-lg font-black text-emerald-700">{bancoHorasHours}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-red-50 rounded-xl">
                <span className="text-xs font-bold text-red-500 uppercase flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Atrasos/Faltas
                </span>
                <span className="text-lg font-black text-red-600">{formatMinutesAsHoursClock(results.totalAtrasoMinutes)}</span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setShowDetails(!showDetails)}
            className="mt-6 flex items-center justify-center gap-2 py-3 w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? 'Ocultar Detalhes' : 'Ver Detalhes do Cálculo'}
          </button>
        </div>
      </div>

      {/* Collapsible Details */}
      {showDetails && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 animate-in slide-in-from-top-4 duration-300">
          <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-6 border-b border-zinc-50 pb-4">Detalhamento de Proventos</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium">Salário Base</span>
                <span className="font-bold text-zinc-900">{formatCurrency(payroll.valores.salarioBase)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium italic">Horas Extras (Total)</span>
                <span className="font-bold text-zinc-900">{formatCurrency(payroll.valores.totalHorasExtras)}</span>
              </div>
              <div className="pl-4 space-y-2 border-l-2 border-zinc-50">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>HE 50% ({formatMinutesAsHoursClock((results as any).grandTotal50Minutes ?? hoursToMinutes(results.grandTotal50))})</span>
                  <span>{formatCurrency(payroll.valores.v50)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>HE 75% ({formatMinutesAsHoursClock((results as any).grandTotal75Minutes ?? hoursToMinutes(results.grandTotal75))})</span>
                  <span>{formatCurrency(payroll.valores.v75)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>HE 100% ({formatMinutesAsHoursClock((results as any).grandTotal100Minutes ?? hoursToMinutes(results.grandTotal100))})</span>
                  <span>{formatCurrency(payroll.valores.v100)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>HE 125% ({formatMinutesAsHoursClock((results as any).grandTotal125Minutes ?? hoursToMinutes(results.grandTotal125))})</span>
                  <span>{formatCurrency(payroll.valores.v125)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium italic">DSR s/ Horas Extras</span>
                <span className="font-bold text-emerald-500">+{formatCurrency(payroll.valores.valorDSR)}</span>
              </div>
              <div className="pt-4 mt-4 border-t border-zinc-50 flex justify-between items-center">
                <span className="text-sm font-bold text-zinc-900 uppercase">Total Proventos</span>
                <span className="text-xl font-black text-emerald-600">{formatCurrency(payroll.valores.totalProventos)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm">
            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest mb-6 border-b border-zinc-50 pb-4">Detalhamento de Descontos</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium">INSS (Folha 2026)</span>
                <span className="font-bold text-rose-500">-{formatCurrency(payroll.valores.inss)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium italic">IRRF s/ Salário + HE</span>
                <span className="font-bold text-rose-500">-{formatCurrency(payroll.valores.irRetidoNoFechamento)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium italic">Atrasos / Faltas</span>
                <span className="font-bold text-rose-500">-{formatCurrency(results.totalAtrasoValue)}</span>
              </div>
              {payroll.valores.descontoDSRAtraso > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-500 font-medium italic">DSR s/ Atrasos / Faltas</span>
                  <span className="font-bold text-rose-500">-{formatCurrency(payroll.valores.descontoDSRAtraso)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-zinc-500 font-medium">Adiantamento Bruto</span>
                <span className="font-bold text-zinc-900">-{formatCurrency(payroll.valores.adiantamentoBruto)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] text-zinc-400 italic">
                <span>IR retido no adiantamento</span>
                <span>{formatCurrency(payroll.valores.irRetidoNoAdiantamento)}</span>
              </div>
              <div className="pt-4 mt-4 border-t border-zinc-50 flex justify-between items-center">
                <span className="text-sm font-bold text-zinc-900 uppercase">Total Descontos</span>
                <span className="text-xl font-black text-rose-600">{formatCurrency(payroll.valores.totalDescontos)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Summary (Visible only when printing) */}
      <div className="hidden print:block space-y-12">
         {/* Reutilizar cabeçalho de impressão existente no arquivo */}
      </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
            <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm">
              <h3 className="text-lg font-bold text-zinc-900 mb-6 italic tracking-tight">Evolução Semanal de Extras (R$)</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                    <Tooltip 
                      cursor={{fill: '#f8fafc'}}
                      contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                      labelFormatter={(label, payload) => {
                        const item = payload[0]?.payload;
                        return item ? `${label} (${item.fullDate})` : label;
                      }}
                    />
                    <Bar dataKey="valor" fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

              <div className="space-y-3 sm:space-y-4">
                <h3 className="text-lg font-bold text-zinc-900 italic tracking-tight">Resumo por Semana</h3>
              {results.weeklySummaries.map((week, i) => (
                <div key={i} className="bg-white p-4 sm:p-6 rounded-2xl border border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group hover:border-emerald-500 transition-all">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-12 h-12 bg-zinc-50 rounded-xl flex items-center justify-center text-zinc-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-all">
                      <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-zinc-900">Semana {i + 1}</div>
                      <div className="text-[10px] font-bold text-zinc-400 uppercase">
                      {isValid(parseISO(week.weekStart)) && isValid(parseISO(week.weekEnd)) 
                        ? `${format(parseISO(week.weekStart), 'dd/MM', { locale: ptBR })} - ${format(parseISO(week.weekEnd), 'dd/MM', { locale: ptBR })}`
                        : '--/--'}
                    </div>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-lg font-black text-zinc-900">{formatCurrency(week.totalValue)}</div>
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">
                      {formatMinutesAsHoursClock((week as any).total50Minutes ?? hoursToMinutes(week.total50))} | {formatMinutesAsHoursClock((week as any).total100Minutes ?? hoursToMinutes(week.total100))} | {formatMinutesAsHoursClock((week as any).total125Minutes ?? hoursToMinutes(week.total125))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeView === 'extras' ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm lg:col-span-1">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-6">Taxas Aplicadas</h3>
              <div className="space-y-4">
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Adicional 1 ({settings.percent50}%)</div>
                  <div className="text-xl font-black text-zinc-900">{formatCurrency(results.rate50)}/h</div>
                </div>
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Adicional 2 ({settings.percent100}%)</div>
                  <div className="text-xl font-black text-zinc-900">{formatCurrency(results.rate100)}/h</div>
                </div>
                <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Adicional Noturno (+{settings.percentNight}%)</div>
                  <div className="text-xl font-black text-zinc-900">+{formatCurrency(results.hourlyRate * (settings.percentNight / 100))}/h</div>
                </div>
                <div className="pt-4 mt-4 border-t border-zinc-100">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase mb-2 italic">Composições de Noite:</div>
                  <div className="flex justify-between text-xs font-medium text-zinc-600 mb-1">
                    <span>50% + Noturno (75%)</span>
                    <span className="font-bold">{formatCurrency(results.rate75)}/h</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-zinc-600">
                    <span>100% + Noturno (125%)</span>
                    <span className="font-bold">{formatCurrency(results.rate125)}/h</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white p-5 sm:p-8 rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm">
                <h3 className="text-lg font-black text-zinc-900 italic tracking-tight mb-6">Detalhamento Diário de Horas Extras</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr className="text-left border-b border-zinc-100">
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Data</th>
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Tipo</th>
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Total Trab.</th>
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Jornada</th>
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Extra (h)</th>
                        <th className="pb-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Valor Est.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {results.dailyDetails.map((day: any, i: number) => {
                        const date = parseISO(day.date);
                        const isSunday = day.isSunday;
                        const overtimeMin = isSunday ? day.totalMinutes : Math.max(0, day.totalMinutes - day.journey);

                        // O detalhamento diario de HE deve exibir apenas o cartao de horas extras.
                        if (!day.entry?.isOvertimeCard) return null;
                        if (overtimeMin <= 0) return null;

                        return (
                          <tr key={i} className="group hover:bg-zinc-50/50 transition-all">
                            <td className="py-4">
                              <div className="font-bold text-zinc-900">{format(date, 'dd/MM/yyyy')}</div>
                              <div className="text-[10px] font-medium text-zinc-400">{WEEKDAY_ABBR[date.getDay()]}</div>
                            </td>
                            <td className="py-4 text-center">
                              {isSunday ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase rounded-md border border-amber-200">DSR/Feriado</span>
                              ) : day.entry.isOvertimeCard ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[8px] font-black uppercase rounded-md border border-red-200">Cartão Extras</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 text-[8px] font-black uppercase rounded-md border border-zinc-200">Normal</span>
                              )}
                            </td>
                            <td className="py-4 text-center text-sm font-medium text-zinc-600">{formatMinutesAsHoursClock(day.totalMinutes)}</td>
                            <td className="py-4 text-center text-sm font-medium text-zinc-400">{formatMinutesAsHoursClock(day.journey)}</td>
                            <td className="py-4 text-right text-sm font-black text-zinc-900">{formatMinutesAsHoursClock(overtimeMin)}</td>
                            <td className="py-4 text-right">
                              <div className="font-black text-emerald-600">{formatCurrency((overtimeMin / 60) * results.hourlyRate * 1.5)}*</div>
                              <div className="text-[8px] text-zinc-400 font-medium">*Base 1.5x ref.</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : activeView === 'simulador' ? (
        <OvertimeSimulator
          entries={overtimeEntries && overtimeEntries.length > 0 ? overtimeEntries : entries.filter(e => !!e.isOvertimeCard)}
          settings={settings}
          month={month}
        />
      ) : (
        <DualCardView
          entries={entries}
          month={month}
          settings={settings}
          onSave={onSaveEntries}
          onUploadClick={onUploadClick}
          disableSave={disableSave}
        />
      )}
    </div>
  );
}





