import React from 'react';
import { Calendar, Trash2, ChevronRight, FileText, Clock } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { TimeEntry } from '../services/aiService';
import { cn } from '../lib/utils';

interface Props {
  entries: TimeEntry[];
  availableMonths: string[];
  onSelectMonth: (month: string) => void;
  onDeleteMonth: (month: string) => void;
}

export default function CardListView({ entries, availableMonths, onSelectMonth, onDeleteMonth }: Props) {
  const entryMonthKey = (e: any) => {
    const hMonth = e?.holerithMonth;
    const hYear = e?.holerithYear;
    if (hMonth && hYear) {
      return `${hYear}-${String(hMonth).padStart(2, '0')}`;
    }
    return e?.date ? e.date.substring(0, 7) : '';
  };

  const getMonthMetadata = (month: string) => {
    return entries.find(e => entryMonthKey(e as any) === month) || {};
  };

  const getMonthStats = (month: string) => {
    const monthEntries = entries.filter(e => entryMonthKey(e as any) === month);
    const hasAnyTime = (e: TimeEntry) =>
      !!(e.entry1 || '').trim() ||
      !!(e.exit1 || '').trim() ||
      !!(e.entry2 || '').trim() ||
      !!(e.exit2 || '').trim() ||
      !!(e.entryExtra || '').trim() ||
      !!(e.exitExtra || '').trim();

    // Conta dias únicos da competência (01..31), evitando duplicidade entre cartão normal e extra.
    const uniqueDays = new Set(
      monthEntries
        .filter(hasAnyTime)
        .map((e) => (e.day || '').toString().padStart(2, '0'))
        .filter(Boolean)
    );
    const totalDays = uniqueDays.size;
    return { totalDays };
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {availableMonths.map(month => {
        const meta = getMonthMetadata(month) as TimeEntry;
        const stats = getMonthStats(month);
        const dateObj = parseISO(month + '-01');
        const isValidDate = isValid(dateObj);

        return (
          <div 
            key={month}
            className="bg-white rounded-3xl md:rounded-[2rem] border border-zinc-100 shadow-sm hover:shadow-xl hover:shadow-zinc-200 transition-all group overflow-hidden flex flex-col"
          >
            <div className="p-5 sm:p-8 flex-1">
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-200">
                  <Calendar className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteMonth(month);
                  }}
                  className="p-3 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1 mb-6">
                <h3 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tighter capitalize">
                  {isValidDate ? format(dateObj, 'MMMM yyyy', { locale: ptBR }) : month}
                </h3>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                  Cartão: {meta.cardNumber || '--'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 p-4 rounded-2xl">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Registros</div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-zinc-900" />
                    <span className="font-black text-zinc-900">{stats.totalDays} dias</span>
                  </div>
                </div>
                <div className="bg-zinc-50 p-4 rounded-2xl">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Mídia</div>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      meta.frontImage && meta.backImage ? "bg-emerald-500" : 
                      meta.frontImage || meta.backImage ? "bg-amber-500" : "bg-red-400"
                    )} />
                    <span className="font-black text-zinc-900 text-[10px]">
                      {meta.frontImage && meta.backImage ? 'F+V' : meta.frontImage ? 'Frente' : meta.backImage ? 'Verso' : 'Sem imagem'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onSelectMonth(month)}
              className="w-full p-4 sm:p-6 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between font-bold text-sm sm:text-base text-zinc-900 hover:bg-zinc-900 hover:text-white transition-all group-hover:bg-zinc-900 group-hover:text-white"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Ver Detalhes do Cartão
              </div>
              <ChevronRight className="w-5 h-5 opacity-50" />
            </button>
          </div>
        );
      })}

      {availableMonths.length === 0 && (
        <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-6">
          <div className="w-24 h-24 bg-zinc-100 rounded-full flex items-center justify-center">
            <FileText className="w-10 h-10 text-zinc-300" />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-zinc-900">Nenhum cartão encontrado</h3>
            <p className="text-zinc-500 max-w-xs">Digitalize seu primeiro cartão para começar a gerenciar suas horas.</p>
          </div>
        </div>
      )}
    </div>
  );
}
