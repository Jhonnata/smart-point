import React from 'react';
import { LayoutDashboard, FileText, Clock, TrendingUp, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { TimeEntry } from '../services/aiService';
import type { Settings } from '../lib/calculations';
import { formatCurrency } from '../lib/utils';
import { calculateOvertime, normalizeOvernightEntries, sumEntryWorkedMinutes } from '../lib/calculations';

interface Props {
  entries: TimeEntry[];
  settings: Settings;
}

export default function DashboardView({ entries, settings }: Props) {
  const stats = React.useMemo(() => {
    const entryMonthKey = (e: any) => {
      const hMonth = e?.holerithMonth;
      const hYear = e?.holerithYear;
      if (hMonth && hYear) {
        return `${hYear}-${String(hMonth).padStart(2, '0')}`;
      }
      return e?.date ? e.date.substring(0, 7) : '';
    };

    const months = new Set<string>();
    entries.forEach(e => {
      const key = entryMonthKey(e as any);
      if (key) months.add(key);
    });

    const sortedMonths = Array.from(months).sort();
    
    const monthlyStats = sortedMonths.map(month => {
      const monthEntriesRaw = entries.filter(e => entryMonthKey(e as any) === month);
      const monthEntries = normalizeOvernightEntries(monthEntriesRaw);
      const res = calculateOvertime(monthEntries, settings);
      
      const totalMinutes = monthEntries.reduce((acc, entry) => acc + sumEntryWorkedMinutes(entry), 0);

      const dateObj = parseISO(month + '-01');
      return {
        month: isValid(dateObj) ? format(dateObj, 'MMM/yy', { locale: ptBR }) : month,
        extras: res?.grandTotalValue || 0,
        hours: totalMinutes / 60,
        totalEntries: monthEntries.length
      };
    });

    return {
      totalCards: months.size,
      totalHours: monthlyStats.reduce((acc, curr) => acc + curr.hours, 0),
      monthlyStats
    };
  }, [entries, settings]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total de Cartões</div>
              <div className="text-3xl font-black text-zinc-900">{stats.totalCards}</div>
            </div>
          </div>
          <div className="text-xs text-zinc-500 font-medium">Períodos cadastrados no sistema</div>
        </div>

        <div className="bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Horas Trabalhadas</div>
              <div className="text-3xl font-black text-zinc-900">{stats.totalHours.toFixed(1)}h</div>
            </div>
          </div>
          <div className="text-xs text-zinc-500 font-medium text-emerald-600 flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3" />
            Acumulado total de todos os meses
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Média de Extras</div>
              <div className="text-3xl font-black text-zinc-900">
                {formatCurrency(stats.monthlyStats.reduce((acc, curr) => acc + curr.extras, 0) / (stats.totalCards || 1))}
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-500 font-medium">Valor médio por mês</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6 italic tracking-tight">Evolução de Ganhos Extras</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthlyStats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="extras" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
          <h3 className="text-lg font-bold text-zinc-900 mb-6 italic tracking-tight">Evolução de Horas Trabalhadas</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.monthlyStats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Line type="monotone" dataKey="hours" stroke="#6366f1" strokeWidth={4} dot={{fill: '#6366f1', strokeWidth: 2, r: 4}} activeDot={{r: 8}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
