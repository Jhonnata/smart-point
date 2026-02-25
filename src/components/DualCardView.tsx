import React from 'react';
import { ArrowLeft, Save, Upload, Calendar, Clock } from 'lucide-react';
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns';
import { toast } from 'sonner';
import { normalizeOvernightEntries, type TimeEntry, type Settings } from '../lib/calculations';
import { cn } from '../lib/utils';

interface Props {
  entries: TimeEntry[];
  month?: string;
  settings: Settings;
  onSave: (entries: TimeEntry[]) => void;
  onBack?: () => void;
  onUploadClick?: (isOvertime: boolean) => void;
  disableSave?: boolean;
}

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const WEEK_TARGET_HOURS = 44;
type TimeField = 'entry1' | 'exit1' | 'entry2' | 'exit2' | 'entryExtra' | 'exitExtra';

function toMinutes(t: string): number {
  if (!t || !t.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function diffMinutes(start: string, end: string): number {
  if (!start || !end || !start.includes(':') || !end.includes(':')) return 0;
  const s = toMinutes(start);
  const e = toMinutes(end);
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return d;
}

function calcWorkedMinutes(e: TimeEntry): number {
  return (
    diffMinutes(e.entry1, e.exit1) +
    diffMinutes(e.entry2, e.exit2) +
    diffMinutes(e.entryExtra, e.exitExtra)
  );
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function normalizeTimeInput(raw: string, finalize: boolean): string {
  const value = (raw || '').trim();
  if (!value) return '';

  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (!finalize) {
    if (value.includes(':')) {
      const [hRaw = '', mRaw = ''] = value.replace(/[^\d:]/g, '').split(':');
      const h = hRaw.slice(0, 2);
      const m = mRaw.slice(0, 2);
      if (mRaw.length === 0 && value.endsWith(':')) return `${h}:`;
      if (m.length === 0) return h;
      return `${h}:${m}`;
    }
    return digits.slice(0, 4);
  }

  let hStr = '';
  let mStr = '';
  if (value.includes(':')) {
    const [hRaw = '', mRaw = ''] = value.replace(/[^\d:]/g, '').split(':');
    hStr = hRaw;
    mStr = mRaw;
  } else if (digits.length <= 2) {
    hStr = digits;
    mStr = '00';
  } else if (digits.length === 3) {
    hStr = digits.slice(0, 1);
    mStr = digits.slice(1, 3);
  } else {
    hStr = digits.slice(0, 2);
    mStr = digits.slice(2, 4);
  }

  const hour = Math.min(23, Math.max(0, Number(hStr || '0')));
  const minute = Math.min(59, Math.max(0, Number(mStr || '0')));
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function getCorrectDate(day: number, monthStr: string, cycleStartDay: number): string {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-').map(Number);
  let dYear = year;
  let dMonth = month;
  
  if (cycleStartDay > 1 && day > cycleStartDay) {
    dMonth--;
    if (dMonth === 0) {
      dMonth = 12;
      dYear--;
    }
  }
  
  return `${dYear}-${dMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function getCompetenciaPeriodLabel(monthStr: string, cycleStartDay: number): string {
  if (!monthStr) return '';
  const [yearStr, monthStrNum] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStrNum);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';

  const c = Math.max(1, Math.min(31, cycleStartDay || 15));
  const monthLabel = `${month.toString().padStart(2, '0')}/${year}`;
  if (c <= 1) return `Período: 01/${monthLabel} a 31/${monthLabel}`;

  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }

  const startDay = Math.min(c + 1, 31).toString().padStart(2, '0');
  const endDay = c.toString().padStart(2, '0');
  const prevLabel = `${prevMonth.toString().padStart(2, '0')}/${prevYear}`;
  return `Período: ${startDay}/${prevLabel} a ${endDay}/${monthLabel}`;
}

function calcTotal(e: TimeEntry): string {
  const min = calcWorkedMinutes(e);
  if (min === 0) return '';
  return minutesToHHMM(min);
}

export default function DualCardView({ entries, onSave, onBack, month, onUploadClick, settings, disableSave }: Props) {
  const monthStr = React.useMemo(() => month || (entries[0]?.date || '').substring(0,7), [entries, month]);
  const weeklyTargetMinutes = ((settings.weeklyLimit && settings.weeklyLimit > 0 ? settings.weeklyLimit : WEEK_TARGET_HOURS) * 60);
  const competenciaPeriodLabel = React.useMemo(
    () => getCompetenciaPeriodLabel(monthStr, settings.cycleStartDay || 15),
    [monthStr, settings.cycleStartDay]
  );

  const normalList = React.useMemo(() => {
    const cycleStart = settings.cycleStartDay || 15;
    // Key by the physical card line number ("day" field = "01".."31").
    const map: Record<number, TimeEntry> = {};
    entries.forEach(e => {
      if (!!e.isOvertimeCard) return;
      const d = e.day ? parseInt(e.day, 10) : NaN;
      if (!isNaN(d) && d >= 1 && d <= 31) map[d] = e;
    });

    const full: TimeEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = getCorrectDate(d, monthStr, cycleStart);
      const day = d.toString().padStart(2,'0');
      full.push(map[d]
        ? { ...map[d], day, date, workDate: date }
        : { id: `normal-${day}`, date, day, entry1:'',exit1:'',entry2:'',exit2:'',entryExtra:'',exitExtra:'', totalHours:'', isOvertimeCard:false }
      );
    }
    return full;
  }, [entries, monthStr, settings.cycleStartDay]);

  const overtimeList = React.useMemo(() => {
    const cycleStart = settings.cycleStartDay || 15;
    const map: Record<number, TimeEntry> = {};
    entries.forEach(e => {
      if (!e.isOvertimeCard) return;
      const d = e.day ? parseInt(e.day, 10) : NaN;
      if (!isNaN(d) && d >= 1 && d <= 31) map[d] = e;
    });

    const full: TimeEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = getCorrectDate(d, monthStr, cycleStart);
      const day = d.toString().padStart(2,'0');
      full.push(map[d]
        ? { ...map[d], day, date, workDate: date }
        : { id: `overtime-${day}`, date, day, entry1:'',exit1:'',entry2:'',exit2:'',entryExtra:'',exitExtra:'', totalHours:'', isOvertimeCard:true }
      );
    }
    return full;
  }, [entries, monthStr, settings.cycleStartDay]);

  const [left, setLeft] = React.useState(normalList);
  const [right, setRight] = React.useState(overtimeList);

  React.useEffect(() => { setLeft(normalList); }, [normalList]);
  React.useEffect(() => { setRight(overtimeList); }, [overtimeList]);

  const commit = () => {
    if (disableSave) return;
    const leftNormalizedByDay = new Map(
      normalizeOvernightEntries(left).map((row) => [row.day || '', row])
    );
    const rightNormalizedByDay = new Map(
      normalizeOvernightEntries(right).map((row) => [row.day || '', row])
    );

    const leftFinal = left.map((e) => {
      const normalized = leftNormalizedByDay.get(e.day || '') || e;
      return { ...e, totalHours: calcTotal(normalized), isOvertimeCard: false };
    });
    const rightFinal = right.map((e) => {
      const normalized = rightNormalizedByDay.get(e.day || '') || e;
      return { ...e, totalHours: calcTotal(normalized), isOvertimeCard: true };
    });
    onSave([...leftFinal, ...rightFinal]);
  };

  const onEdit = (side: 'left'|'right', id: string, field: keyof TimeEntry, value: string) => {
    if (side === 'left') setLeft(prev => prev.map(e => e.id === id ? { ...e, [field]: value } as TimeEntry : e));
    else setRight(prev => prev.map(e => e.id === id ? { ...e, [field]: value } as TimeEntry : e));
  };

  const onEditTime = (side: 'left'|'right', id: string, field: TimeField, rawValue: string) => {
    onEdit(side, id, field, normalizeTimeInput(rawValue, false));
  };

  const onBlurTime = (side: 'left'|'right', id: string, field: TimeField, rawValue: string) => {
    onEdit(side, id, field, normalizeTimeInput(rawValue, true));
  };

  const toggleJustification = (id: string) => {
    setLeft(prev => prev.map(e => e.id === id ? { ...e, isDPAnnotation: !e.isDPAnnotation } : e));
  };

  const applyStandardSchedule = () => {
    const baseEntry1 = normalizeTimeInput(settings.workStart || "12:00", true);
    const baseExit1 = normalizeTimeInput(settings.lunchStart || "17:00", true);
    const baseEntry2 = normalizeTimeInput(settings.lunchEnd || "18:00", true);
    const baseExit2 = normalizeTimeInput(settings.workEnd || "21:00", true);
    const saturdayEntry = normalizeTimeInput(settings.saturdayWorkStart || "12:00", true);
    const saturdayExit = normalizeTimeInput(settings.saturdayWorkEnd || "16:00", true);

    setLeft(prev => prev.map(e => {
      const date = parseISO(e.date);
      if (!isValid(date)) return e;
      const dayOfWeek = date.getDay();

      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        let exit2 = baseExit2;
        const compDays = (settings.compDays || '1,2,3,4').split(',').map(Number);
        if (settings.saturdayCompensation && compDays.includes(dayOfWeek)) {
          exit2 = minutesToHHMM(toMinutes(baseExit2) + 60);
        }
        return {
          ...e,
          entry1: baseEntry1,
          exit1: baseExit1,
          entry2: baseEntry2,
          exit2
        };
      }

      if (dayOfWeek === 6) {
        if (settings.saturdayCompensation) {
          return {
            ...e,
            entry1: '',
            exit1: '',
            entry2: '',
            exit2: '',
            entryExtra: '',
            exitExtra: ''
          };
        }
        return {
          ...e,
          entry1: saturdayEntry,
          exit1: saturdayExit,
          entry2: '',
          exit2: '',
          entryExtra: '',
          exitExtra: ''
        };
      }

      return e;
    }));
    toast.success("Horario padrao aplicado (segunda a sabado).");
  };

  const renderTable = (list: TimeEntry[], side: 'left'|'right') => (
    <div className="bg-white rounded-[2rem] border border-zinc-100 overflow-hidden shadow-sm">
      <div className={cn("px-6 py-4 text-xs font-black uppercase tracking-widest border-b flex items-center justify-between", side==='right'?"bg-red-50 text-red-700 border-red-100":"bg-zinc-50 text-zinc-600 border-zinc-100")}
      >
        <span>{side==='right'?'Cartão de Horas Extras':'Cartão Normal'}</span>
        <div className="flex items-center gap-2">
           {side === 'left' && (
              <button 
                onClick={applyStandardSchedule}
                className="px-2 py-1 bg-white border border-zinc-200 rounded text-[9px] hover:bg-zinc-900 hover:text-white transition-colors uppercase font-black"
                title="Preenche segunda a sexta com jornada padrao e sabado conforme configuracao"
              >
                Horário Padrão
              </button>
           )}
           <div className={cn("w-2 h-2 rounded-full", side==='right'?"bg-red-500":"bg-zinc-400")} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left bg-zinc-50/50">
              <th rowSpan={2} className="px-4 py-3 w-28 text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100">Dia</th>
              <th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Manhã</th>
              <th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Tarde</th>
              <th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Extra</th>
              <th rowSpan={2} className="px-2 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-right border-b border-zinc-100 border-l border-zinc-100">Total</th>
            </tr>
            <tr className="text-left bg-zinc-50/50">
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th>
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th>
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th>
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th>
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th>
              <th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
          {(() => {
            const normalizedByDay = new Map(
              normalizeOvernightEntries(list).map((row) => [row.day || '', row])
            );
            const rows: React.ReactNode[] = [];
            let weekStartDay: string | null = null;
            let weekStartLabel: string | null = null;
            let weekTotalMinutes = 0;

            list.forEach((e, idx) => {
              const normalizedEntry = normalizedByDay.get(e.day || '') || e;
              const date = parseISO(e.date);
              const validDate = isValid(date);
              const dayOfWeek = validDate ? date.getDay() : -1;
              const isWeekend = validDate && (dayOfWeek === 0 || dayOfWeek === 6);
              const dayDisplayName = validDate ? WEEKDAY_ABBR[dayOfWeek] : '';
              const monthDisplayName = validDate ? MONTH_ABBR[date.getMonth()] : '';
              const isMonToSat = validDate && dayOfWeek >= 1 && dayOfWeek <= 6;

              if (isMonToSat && weekStartDay === null) {
                weekStartDay = e.day || '';
                weekStartLabel = WEEKDAY_ABBR[dayOfWeek];
              }
              if (isMonToSat) {
                weekTotalMinutes += calcWorkedMinutes(normalizedEntry);
              }

              rows.push(
                <tr key={`${side}-${e.day}`} className={cn("group transition-colors", isWeekend ? "bg-zinc-50/30" : "hover:bg-zinc-50/50")}>
                  <td className="px-4 py-2 border-r border-zinc-50">
                    <div className="flex items-center gap-1.5">
                      <span className="font-black text-zinc-900">{e.day}</span>
                      <span className="text-[10px] font-bold text-zinc-400 tracking-tighter truncate max-w-[60px]">{dayDisplayName}</span>
                      <span className="text-[9px] font-semibold text-zinc-400 uppercase">{monthDisplayName}</span>
                      {side === 'left' && (
                        <button
                          type="button"
                          onClick={() => toggleJustification(e.id)}
                          className={cn(
                            "ml-1 inline-flex items-center justify-center w-5 h-5 rounded-md border transition-colors",
                            e.isDPAnnotation
                              ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                              : "bg-white border-zinc-200 text-zinc-300 hover:text-zinc-500 hover:border-zinc-300"
                          )}
                          title={e.isDPAnnotation ? "Atraso justificado" : "Marcar atraso justificado"}
                          aria-label={e.isDPAnnotation ? "Atraso justificado" : "Marcar atraso justificado"}
                        >
                          <Clock className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      value={e.entry1 || ''}
                      onChange={ev => onEditTime(side, e.id, 'entry1', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'entry1', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-1 py-1.5 border-r border-zinc-50">
                    <input
                      value={e.exit1 || ''}
                      onChange={ev => onEditTime(side, e.id, 'exit1', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'exit1', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      value={e.entry2 || ''}
                      onChange={ev => onEditTime(side, e.id, 'entry2', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'entry2', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-1 py-1.5 border-r border-zinc-50">
                    <input
                      value={e.exit2 || ''}
                      onChange={ev => onEditTime(side, e.id, 'exit2', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'exit2', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      value={e.entryExtra || ''}
                      onChange={ev => onEditTime(side, e.id, 'entryExtra', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'entryExtra', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-1 py-1.5 border-r border-zinc-50">
                    <input
                      value={e.exitExtra || ''}
                      onChange={ev => onEditTime(side, e.id, 'exitExtra', ev.target.value)}
                      onBlur={ev => onBlurTime(side, e.id, 'exitExtra', ev.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center"
                      placeholder="--:--"
                      inputMode="numeric"
                      maxLength={5}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right bg-zinc-50/20">
                    {calcTotal(normalizedEntry) ? (
                      <span className="font-black text-zinc-900 text-[11px]">{calcTotal(normalizedEntry)}</span>
                    ) : (
                      <span className="text-zinc-200 text-[11px]">--</span>
                    )}
                  </td>
                </tr>
              );

              const isEndOfWeek = dayOfWeek === 6;
              const isLastRow = idx === list.length - 1;
              const nextEntry = !isLastRow ? list[idx + 1] : null;
              const nextDate = nextEntry ? parseISO(nextEntry.date) : null;
              const nextValidDate = !!nextDate && isValid(nextDate);
              const hasDateDiscontinuity =
                validDate &&
                nextValidDate &&
                differenceInCalendarDays(nextDate as Date, date) !== 1;

              // A card cycle can cross month/year boundaries (e.g. 15/jan -> 16/dez).
              // In these points we must close the current week block even if it's not Saturday.
              const shouldCloseByCycleBreak = !!weekStartDay && !isEndOfWeek && hasDateDiscontinuity;

              if (weekStartDay && (isEndOfWeek || isLastRow || shouldCloseByCycleBreak)) {
                const currentWeekEnd = e.day || '';
                const currentWeekEndLabel = validDate ? WEEKDAY_ABBR[dayOfWeek] : '';
                const achieved = weekTotalMinutes >= weeklyTargetMinutes;
                const missingMinutes = Math.max(0, weeklyTargetMinutes - weekTotalMinutes);

                rows.push(
                  <tr key={`week-total-${side}-${idx}`} className="bg-zinc-50/70">
                    <td colSpan={8} className="px-4 py-2.5 text-[10px] border-t border-zinc-100">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-zinc-400 uppercase tracking-wider">
                          {`${weekStartDay}-${currentWeekEnd} ${weekStartLabel || ''}-${currentWeekEndLabel}`}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-zinc-700">{minutesToHHMM(weekTotalMinutes)}</span>
                          {side === 'left' && (
                            <span className={cn("font-semibold", achieved ? "text-emerald-600" : "text-amber-600")}>
                              {achieved ? `${Math.round(weeklyTargetMinutes / 60)}h ok` : `faltam ${minutesToHHMM(missingMinutes)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );

                weekStartDay = null;
                weekStartLabel = null;
                weekTotalMinutes = 0;
              }
            });

            return rows;
          })()}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-4 border-t border-zinc-100 flex items-center justify-between text-[10px] bg-zinc-50/30">
        <button 
          onClick={() => onUploadClick?.(side === 'right')}
          className="inline-flex items-center gap-1.5 font-bold text-zinc-400 hover:text-zinc-900 transition-colors uppercase tracking-widest"
        >
          <Upload className="w-3 h-3"/> Subir imagens
        </button>
        <span className="text-zinc-400 font-medium italic">Edição manual habilitada</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Area (sem a faixa preta) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm">
        <div className="flex items-center gap-4">
          {onBack && (
            <button 
              onClick={onBack} 
              className="p-3 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 rounded-2xl transition-all border border-zinc-100"
            >
              <ArrowLeft className="w-5 h-5"/>
            </button>
          )}
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
              <Calendar className="w-3 h-3" />
              Conferência de Registros
            </div>
            <div className="text-2xl font-black text-zinc-900 tracking-tighter italic">Lançamento Consolidado</div>
            {competenciaPeriodLabel && (
              <div className="text-[11px] font-semibold text-zinc-500 mt-1">{competenciaPeriodLabel}</div>
            )}
          </div>
        </div>

        <button 
          onClick={commit} 
          disabled={!!disableSave}
          className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold flex items-center gap-3 shadow-xl shadow-zinc-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100"
        >
          <Save className="w-5 h-5"/> {disableSave ? 'Carregando mês...' : 'Salvar Alterações'}
        </button>
      </div>

      {/* Grid de Tabelas */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {renderTable(left, 'left')}
        {renderTable(right, 'right')}
      </div>
    </div>
  );
}





