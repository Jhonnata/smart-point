import React, { useEffect } from 'react';
import { Edit2, Save, Trash2, Plus, FileText, ArrowLeft, Clock } from 'lucide-react';
import { format, parseISO, isValid, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { TimeEntry } from '../services/aiService';
import { minutesToTime, sumEntryWorkedMinutes } from '../lib/calculations';
import { cn } from '../lib/utils';

interface Props {
  entries: TimeEntry[];
  onSave: (entries: TimeEntry[]) => void;
  onBack?: () => void;
}

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

export default function DigitalCardView({ entries, onSave, onBack }: Props) {
  const sortEntries = (list: TimeEntry[]) => {
    if (list.length === 0) return [];

    // Build a map keyed by the card line number ("day" field, "01"–"31").
    // The server already sends 31 entries with the correct workDate per entry;
    // we must NOT reconstruct dates from a single year-month because with
    // cycleStartDay entries in lines 15-31 belong to the PREVIOUS month.
    const map: Record<string, TimeEntry> = {};
    for (const e of list) {
      const dayKey = e.day || ((e as any).workDate || e.date || '').slice(8, 10);
      if (dayKey) map[dayKey] = e;
    }

    const fullMonth: TimeEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      const dayStr = d.toString().padStart(2, '0');
      const existing = map[dayStr];
      if (existing) {
        const wd = (existing as any).workDate || existing.date || '';
        fullMonth.push({ ...existing, workDate: wd, date: wd });
      } else {
        // Placeholder row — we have no date context here, so leave date as empty.
        // This only happens when the server omits a day (should not occur normally).
        fullMonth.push({
          id: `empty-day-${dayStr}`,
          workDate: '',
          date: '',
          day: dayStr,
          entry1: '', exit1: '',
          entry2: '', exit2: '',
          entryExtra: '', exitExtra: '',
          totalHours: ''
        } as any);
      }
    }

    return fullMonth;
  };

  const [localEntries, setLocalEntries] = React.useState(() => sortEntries(entries));
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [isOvertimeCard, setIsOvertimeCard] = React.useState(!!entries[0]?.isOvertimeCard);

  useEffect(() => {
    setLocalEntries(sortEntries(entries));
    setIsOvertimeCard(!!entries[0]?.isOvertimeCard);
  }, [entries]);

  const handleEdit = (id: string, field: keyof TimeEntry, value: string) => {
    setLocalEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const calculateDailyTotal = (entry: TimeEntry) => {
    return minutesToTime(sumEntryWorkedMinutes(entry));
  };

  const saveChanges = () => {
    const updated = localEntries.map(e => ({
      ...e,
      totalHours: calculateDailyTotal(e)
    }));
    
    // Preserve metadata from the first entry of the current batch
    const metadata = (entries[0] || {}) as TimeEntry;
    const { 
      id: _id, date: _date, day: _day, 
      entry1: _e1, exit1: _x1, entry2: _e2, exit2: _x2, 
      entryExtra: _ex, exitExtra: _xx, totalHours: _th, 
      isDPAnnotation: _dp, ...rest 
    } = metadata;
    
    const finalEntries = updated.map(ue => ({ ...ue, ...rest, isOvertimeCard }));
    onSave(finalEntries);
    setEditingId(null);
  };

  return (
    <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
      <div className="p-8 bg-zinc-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {onBack && (
            <button 
              onClick={onBack}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-2xl transition-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2 text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-1">
              <FileText className="w-3 h-3" />
              Cartão de Ponto Digital
            </div>
            <h3 className="text-2xl font-black tracking-tighter">Conferência de Registros</h3>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOvertimeCard(!isOvertimeCard)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all border",
              isOvertimeCard 
                ? "bg-red-500/20 border-red-500 text-red-400" 
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
            )}
            title="Se marcado, todos os horários deste cartão serão contados como Extras (jornada 0h)"
          >
            <Clock className="w-3 h-3" />
            {isOvertimeCard ? "Cartão de Horas Extras" : "Cartão Normal"}
          </button>

          <button 
            onClick={saveChanges}
            className="px-8 py-3 bg-emerald-500 text-white rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-900/20"
          >
            <Save className="w-4 h-4" />
            Salvar Alterações
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="bg-zinc-50 text-[10px] uppercase tracking-widest font-black text-zinc-400 border-b border-zinc-100">
              <th className="px-6 py-4">Dia</th>
              <th className="px-4 py-4 text-center border-x border-zinc-100" colSpan={2}>Manhã</th>
              <th className="px-4 py-4 text-center border-x border-zinc-100" colSpan={2}>Tarde</th>
              <th className="px-4 py-4 text-center border-x border-zinc-100" colSpan={2}>Extra</th>
              <th className="px-6 py-4 text-right">Total</th>
            </tr>
            <tr className="bg-zinc-50/50 text-[9px] uppercase tracking-widest font-bold text-zinc-400 border-b border-zinc-100">
              <th className="px-6 py-2"></th>
              <th className="px-2 py-2 text-center border-l border-zinc-100">Entrada</th>
              <th className="px-2 py-2 text-center border-r border-zinc-100">Saída</th>
              <th className="px-2 py-2 text-center border-l border-zinc-100">Entrada</th>
              <th className="px-2 py-2 text-center border-r border-zinc-100">Saída</th>
              <th className="px-2 py-2 text-center border-l border-zinc-100">Entrada</th>
              <th className="px-2 py-2 text-center border-r border-zinc-100">Saída</th>
              <th className="px-6 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {localEntries.map((entry) => (
              <tr key={entry.id} className={cn(
                "group transition-colors",
                entry.isDPAnnotation ? "bg-amber-50/30" : "hover:bg-zinc-50/50"
              )}>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-black text-zinc-900 text-base">
                      {entry.day || (isValid(parseISO(entry.date)) ? format(parseISO(entry.date), 'dd') : '--')}
                    </span>
                    <span className="text-[10px] font-bold text-zinc-400">
                      {isValid(parseISO(entry.date)) ? WEEKDAY_ABBR[parseISO(entry.date).getDay()] : '-'}
                    </span>
                  </div>
                </td>
                
                {/* Inputs */}
                {[
                  ['entry1', 'exit1'],
                  ['entry2', 'exit2'],
                  ['entryExtra', 'exitExtra']
                ].map(([f1, f2], idx) => (
                  <React.Fragment key={idx}>
                    <td className="px-1 py-4 border-l border-zinc-50/50">
                      <input 
                        type="text" 
                        value={entry[f1 as keyof TimeEntry] as string}
                        onChange={e => handleEdit(entry.id, f1 as keyof TimeEntry, e.target.value)}
                        className="w-16 text-center bg-zinc-50/50 border-none focus:ring-2 focus:ring-emerald-500 rounded-lg py-2 text-sm font-bold text-zinc-700"
                        placeholder="--"
                      />
                    </td>
                    <td className="px-1 py-4 border-r border-zinc-50/50">
                      <input 
                        type="text" 
                        value={entry[f2 as keyof TimeEntry] as string}
                        onChange={e => handleEdit(entry.id, f2 as keyof TimeEntry, e.target.value)}
                        className="w-16 text-center bg-zinc-50/50 border-none focus:ring-2 focus:ring-emerald-500 rounded-lg py-2 text-sm font-bold text-zinc-700"
                        placeholder="--"
                      />
                    </td>
                  </React.Fragment>
                ))}

                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end">
                    <span className="font-black text-zinc-900 text-base">
                      {calculateDailyTotal(entry)}
                    </span>
                    {entry.isDPAnnotation && (
                      <span className="text-[9px] font-bold text-amber-600 uppercase bg-amber-100 px-1.5 py-0.5 rounded">Anotação DP</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
