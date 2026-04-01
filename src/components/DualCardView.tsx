import React from 'react';
import { ArrowLeft, Save, Upload, Calendar, Clock, Info, MessageSquareMore } from 'lucide-react';
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns';
import { toast } from 'sonner';
import {
  normalizeOvernightEntries,
  resolveDailyJourneyMinutes,
  resolveDailyOvertimeDiscountMinutes,
  sumEntryWorkedMinutes,
  timeToMinutes,
  type TimeEntry,
  type Settings
} from '../lib/calculations';
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
type EditingCell = { side: 'left' | 'right'; id: string; field: TimeField } | null;

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDiscountLabel(minutes: number): string {
  if (minutes <= 0) return '';
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
}

function normalizePassiveDayLabel(annotationText?: string): string {
  const normalized = String(annotationText || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'domingo') return 'domingo';
  if (normalized === 'feriado') return 'feriado';
  return '';
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
  const min = sumEntryWorkedMinutes(e);
  if (min === 0) return '';
  return minutesToHHMM(min);
}

function resolveEntryDiscountMinutes(entry: TimeEntry, isOvertimeCardEntry: boolean, settings: Settings): number {
  const workedMinutes = sumEntryWorkedMinutes(entry);
  if (workedMinutes <= 0) return 0;

  const date = parseISO(entry.date);
  if (!isValid(date)) return 0;
  const dayOfWeek = date.getDay();
  const journeyMinutes = resolveDailyJourneyMinutes(
    settings.dailyJourney || 0,
    isOvertimeCardEntry,
    dayOfWeek,
    !!settings.saturdayCompensation,
    settings.compDays
  );
  const rawOvertimeMinutes = dayOfWeek === 0 ? workedMinutes : Math.max(0, workedMinutes - journeyMinutes);
  return resolveDailyOvertimeDiscountMinutes(rawOvertimeMinutes, settings);
}

export default function DualCardView({ entries, onSave, onBack, month, onUploadClick, settings, disableSave }: Props) {
  const monthStr = React.useMemo(() => month || (entries[0]?.date || '').substring(0, 7), [entries, month]);
  const weeklyTargetMinutes = ((settings.weeklyLimit && settings.weeklyLimit > 0 ? settings.weeklyLimit : WEEK_TARGET_HOURS) * 60);
  const competenciaPeriodLabel = React.useMemo(
    () => getCompetenciaPeriodLabel(monthStr, settings.cycleStartDay || 15),
    [monthStr, settings.cycleStartDay]
  );

  const normalList = React.useMemo(() => {
    const cycleStart = settings.cycleStartDay || 15;
    const map: Record<number, TimeEntry> = {};
    entries.forEach((e) => {
      if (!!e.isOvertimeCard) return;
      const d = e.day ? parseInt(e.day, 10) : NaN;
      if (!isNaN(d) && d >= 1 && d <= 31) map[d] = e;
    });

    const full: TimeEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = getCorrectDate(d, monthStr, cycleStart);
      const day = d.toString().padStart(2, '0');
      full.push(
        map[d]
          ? { ...map[d], day, date, workDate: date }
          : { id: `normal-${day}`, date, day, entry1: '', exit1: '', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', annotationText: '', isOvertimeCard: false }
      );
    }
    return full;
  }, [entries, monthStr, settings.cycleStartDay]);

  const overtimeList = React.useMemo(() => {
    const cycleStart = settings.cycleStartDay || 15;
    const map: Record<number, TimeEntry> = {};
    entries.forEach((e) => {
      if (!e.isOvertimeCard) return;
      const d = e.day ? parseInt(e.day, 10) : NaN;
      if (!isNaN(d) && d >= 1 && d <= 31) map[d] = e;
    });

    const full: TimeEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = getCorrectDate(d, monthStr, cycleStart);
      const day = d.toString().padStart(2, '0');
      full.push(
        map[d]
          ? { ...map[d], day, date, workDate: date }
          : { id: `overtime-${day}`, date, day, entry1: '', exit1: '', entry2: '', exit2: '', entryExtra: '', exitExtra: '', totalHours: '', annotationText: '', isOvertimeCard: true }
      );
    }
    return full;
  }, [entries, monthStr, settings.cycleStartDay]);

  const [left, setLeft] = React.useState(normalList);
  const [right, setRight] = React.useState(overtimeList);
  const [editingCell, setEditingCell] = React.useState<EditingCell>(null);
  const [activeCardTab, setActiveCardTab] = React.useState<'left' | 'right'>('left');
  const hasOvertimeData = React.useMemo(
    () => right.some((row) =>
      !!calcTotal(row) ||
      !!row.entry1 || !!row.exit1 || !!row.entry2 || !!row.exit2 || !!row.entryExtra || !!row.exitExtra ||
      !!String(row.annotationText || '').trim() ||
      !!row.isDPAnnotation
    ),
    [right]
  );

  React.useEffect(() => {
    setLeft(normalList);
  }, [normalList]);

  React.useEffect(() => {
    setRight(overtimeList);
  }, [overtimeList]);

  React.useEffect(() => {
    if (activeCardTab === 'right' && !hasOvertimeData) {
      setActiveCardTab('left');
    }
  }, [activeCardTab, hasOvertimeData]);

  const commit = () => {
    if (disableSave) return;
    const leftNormalizedByDay = new Map(normalizeOvernightEntries(left).map((row) => [row.day || '', row]));
    const rightNormalizedByDay = new Map(normalizeOvernightEntries(right).map((row) => [row.day || '', row]));

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

  const onEdit = (side: 'left' | 'right', id: string, field: keyof TimeEntry, value: string) => {
    if (side === 'left') {
      setLeft((prev) => prev.map((e) => (e.id === id ? ({ ...e, [field]: value } as TimeEntry) : e)));
    } else {
      setRight((prev) => prev.map((e) => (e.id === id ? ({ ...e, [field]: value } as TimeEntry) : e)));
    }
  };

  const onEditTime = (side: 'left' | 'right', id: string, field: TimeField, rawValue: string) => {
    onEdit(side, id, field, normalizeTimeInput(rawValue, false));
  };

  const onBlurTime = (side: 'left' | 'right', id: string, field: TimeField, rawValue: string) => {
    onEdit(side, id, field, normalizeTimeInput(rawValue, true));
  };

  const startEditing = (side: 'left' | 'right', id: string, field: TimeField) => {
    setEditingCell({ side, id, field });
  };

  const stopEditing = () => {
    setEditingCell(null);
  };

  const renderTimeCell = (entry: TimeEntry, side: 'left' | 'right', field: TimeField, bordered?: boolean) => {
    const isEditing = editingCell?.side === side && editingCell?.id === entry.id && editingCell?.field === field;
    const value = entry[field] || '';

    return (
      <td className={cn("px-0 py-0.5 text-center", bordered && "border-r border-zinc-100")}>
        {isEditing ? (
          <input
            autoFocus
            value={value}
            onChange={(ev) => onEditTime(side, entry.id, field, ev.target.value)}
            onBlur={(ev) => {
              onBlurTime(side, entry.id, field, ev.target.value);
              stopEditing();
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                onBlurTime(side, entry.id, field, (ev.target as HTMLInputElement).value);
                stopEditing();
              }
              if (ev.key === 'Escape') {
                stopEditing();
              }
            }}
            className="mx-auto h-6 w-[48px] rounded-md border border-zinc-300 bg-white px-1 text-center text-[10px] font-bold text-zinc-900 outline-none transition-all focus:border-zinc-900"
            placeholder="--:--"
            inputMode="numeric"
            maxLength={5}
          />
        ) : (
          <button
            type="button"
            onClick={() => startEditing(side, entry.id, field)}
            className={cn(
              "mx-auto flex h-6 min-w-[48px] items-center justify-center rounded-md border px-0.5 text-center text-[10px] font-bold transition-colors focus:outline-none",
              value
                ? "border-transparent text-zinc-900 hover:border-zinc-200 hover:bg-zinc-100 focus:border-zinc-200 focus:bg-zinc-100"
                : "border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-100 focus:border-zinc-200 focus:bg-zinc-100"
            )}
            title="Clique para editar"
          >
            {value || '--:--'}
          </button>
        )}
      </td>
    );
  };

  const toggleJustification = (id: string) => {
    setLeft((prev) => prev.map((e) => (e.id === id ? { ...e, isDPAnnotation: !e.isDPAnnotation } : e)));
  };

  const applyStandardSchedule = () => {
    const baseEntry1 = normalizeTimeInput(settings.workStart || '12:00', true);
    const baseExit1 = normalizeTimeInput(settings.lunchStart || '17:00', true);
    const baseEntry2 = normalizeTimeInput(settings.lunchEnd || '18:00', true);
    const baseExit2 = normalizeTimeInput(settings.workEnd || '21:00', true);
    const saturdayEntry = normalizeTimeInput(settings.saturdayWorkStart || '12:00', true);
    const saturdayExit = normalizeTimeInput(settings.saturdayWorkEnd || '16:00', true);

    setLeft((prev) =>
      prev.map((e) => {
        const date = parseISO(e.date);
        if (!isValid(date)) return e;
        const dayOfWeek = date.getDay();

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          let exit2 = baseExit2;
          const compDays = (settings.compDays || '1,2,3,4').split(',').map(Number);
          if (settings.saturdayCompensation && compDays.includes(dayOfWeek)) {
            exit2 = minutesToHHMM(timeToMinutes(baseExit2) + 60);
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
      })
    );
    toast.success('Horario padrao aplicado (segunda a sabado).');
  };

  const renderTable = (list: TimeEntry[], side: 'left' | 'right') => (
    <div className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
      <div
        className={cn(
          "flex items-center justify-between border-b px-4 py-3 text-[11px] font-black uppercase tracking-[0.12em]",
          side === 'right' ? 'border-red-200 bg-red-50 text-red-700' : 'border-zinc-200 bg-zinc-50 text-zinc-700'
        )}
      >
        <div className="flex items-center gap-2">
          <span>{side === 'right' ? 'Cartão de Horas Extras' : 'Cartão Normal'}</span>
          <div className={cn('h-2.5 w-2.5 rounded-full', side === 'right' ? 'bg-red-500' : 'bg-zinc-400')} />
        </div>
        {side === 'left' && (
          <button
            onClick={applyStandardSchedule}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[9px] font-black uppercase transition-colors hover:bg-zinc-900 hover:text-white"
            title="Preenche segunda a sexta com jornada padrao e sabado conforme configuracao"
          >
            Horário Padrão
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[10px]">
          <thead>
            <tr className="bg-zinc-50">
              <th rowSpan={2} className="w-[58px] border-b border-r border-zinc-200 px-2 py-2 text-left text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">Dia</th>
              <th colSpan={2} className="border-b border-l border-zinc-200 px-1 py-2 text-center text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">Manhã</th>
              <th colSpan={2} className="border-b border-l border-zinc-200 px-1 py-2 text-center text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">Tarde</th>
              <th colSpan={2} className="border-b border-l border-zinc-200 px-1 py-2 text-center text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">Extra</th>
              <th rowSpan={2} className="w-[64px] border-b border-l border-zinc-200 px-2 py-2 text-right text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">Total</th>
            </tr>
            <tr className="bg-zinc-50/70">
              <th className="border-l border-zinc-200 px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Ent.</th>
              <th className="px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Sai.</th>
              <th className="border-l border-zinc-200 px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Ent.</th>
              <th className="px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Sai.</th>
              <th className="border-l border-zinc-200 px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Ent.</th>
              <th className="px-0.5 py-1 text-center text-[8px] font-black uppercase text-zinc-500">Sai.</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const normalizedByDay = new Map(normalizeOvernightEntries(list).map((row) => [row.day || '', row]));
              const rows: React.ReactNode[] = [];
              let weekStartDay: string | null = null;
              let weekStartLabel: string | null = null;
              let weekTotalMinutes = 0;

              list.forEach((e, idx) => {
                const normalizedEntry = normalizedByDay.get(e.day || '') || e;
                const isOvertimeCardEntry = side === 'right';
                const discountMinutes = resolveEntryDiscountMinutes(normalizedEntry, isOvertimeCardEntry, settings);
                const discountLabel = formatDiscountLabel(discountMinutes);
                const date = parseISO(e.date);
                const validDate = isValid(date);
                const dayOfWeek = validDate ? date.getDay() : -1;
                const isWeekend = validDate && (dayOfWeek === 0 || dayOfWeek === 6);
                const passiveDayLabel = normalizePassiveDayLabel(e.annotationText);
                const showAnnotationIcon = !!String(e.annotationText || '').trim() && !passiveDayLabel;
                const dayDisplayName = validDate ? WEEKDAY_ABBR[dayOfWeek] : '';
                const monthDisplayName = validDate ? MONTH_ABBR[date.getMonth()] : '';
                const isMonToSat = validDate && dayOfWeek >= 1 && dayOfWeek <= 6;

                if (isMonToSat && weekStartDay === null) {
                  weekStartDay = e.day || '';
                  weekStartLabel = WEEKDAY_ABBR[dayOfWeek];
                }
                if (isMonToSat) {
                  weekTotalMinutes += sumEntryWorkedMinutes(normalizedEntry);
                }

                rows.push(
                  <tr key={`${side}-${e.day}`} className={cn('border-b border-zinc-100 transition-colors', (isWeekend || !!passiveDayLabel) ? 'bg-zinc-50/40' : 'hover:bg-zinc-50')}>
                    <td className="w-[58px] border-r border-zinc-100 px-2 py-0.5 align-top">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex flex-col gap-1 leading-none">
                          <span className="text-[13px] font-black text-zinc-950">{e.day}</span>
                          <span className="text-[8px] font-extrabold uppercase tracking-[0.08em] text-zinc-500">{dayDisplayName || '--'}</span>
                          <span className="text-[8px] font-bold uppercase text-zinc-400">{monthDisplayName}</span>
                        </div>
                        <div className="mt-0.5 flex flex-col items-center gap-1">
                          {showAnnotationIcon && (
                            <div className="group relative">
                              <span
                                className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-600"
                                title={String(e.annotationText || '').trim()}
                                aria-label="Anotacoes do dia"
                              >
                                <MessageSquareMore className="h-3 w-3" />
                              </span>
                              <div className="pointer-events-none absolute left-[calc(100%+0.4rem)] top-0 z-20 hidden min-w-[180px] max-w-[240px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[10px] font-medium leading-4 text-zinc-700 shadow-lg group-hover:block">
                                <div className="mb-1 text-[9px] font-black uppercase tracking-[0.08em] text-zinc-500">Anotacoes</div>
                                <div className="whitespace-pre-line break-words">{String(e.annotationText || '').trim()}</div>
                              </div>
                            </div>
                          )}
                          {side === 'left' && (
                            <button
                              type="button"
                              onClick={() => toggleJustification(e.id)}
                              className={cn(
                                'inline-flex h-4.5 w-4.5 items-center justify-center rounded-md border transition-colors',
                                e.isDPAnnotation
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                  : 'border-zinc-200 bg-white text-zinc-300 hover:border-zinc-300 hover:text-zinc-500'
                              )}
                              title={e.isDPAnnotation ? 'Atraso justificado' : 'Marcar atraso justificado'}
                              aria-label={e.isDPAnnotation ? 'Atraso justificado' : 'Marcar atraso justificado'}
                            >
                              <Clock className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    {renderTimeCell(e, side, 'entry1')}
                    {renderTimeCell(e, side, 'exit1', true)}
                    {renderTimeCell(e, side, 'entry2')}
                    {renderTimeCell(e, side, 'exit2', true)}
                    {renderTimeCell(e, side, 'entryExtra')}
                    {renderTimeCell(e, side, 'exitExtra', true)}
                    <td className="w-[64px] px-2 py-0.5 text-right">
                      {calcTotal(normalizedEntry) ? (
                        <span className="inline-flex items-center justify-end gap-1 text-[10px] font-black text-zinc-950">
                          {calcTotal(normalizedEntry)}
                          {side === 'right' && discountMinutes > 0 && (
                            <span
                              className="inline-flex items-center text-amber-600"
                              title={`Desconto diario aplicado: ${discountLabel}`}
                              aria-label={`Desconto diario aplicado: ${discountLabel}`}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black text-zinc-300">--</span>
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

                const shouldCloseByCycleBreak = !!weekStartDay && !isEndOfWeek && hasDateDiscontinuity;

                if (weekStartDay && (isEndOfWeek || isLastRow || shouldCloseByCycleBreak)) {
                  const currentWeekEnd = e.day || '';
                  const currentWeekEndLabel = validDate ? WEEKDAY_ABBR[dayOfWeek] : '';
                  const achieved = weekTotalMinutes >= weeklyTargetMinutes;
                  const missingMinutes = Math.max(0, weeklyTargetMinutes - weekTotalMinutes);

                  rows.push(
                    <tr key={`week-total-${side}-${idx}`} className="bg-zinc-50">
                      <td colSpan={8} className="border-t border-zinc-200 px-2.5 py-2 text-[10px]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-zinc-500">
                            {`${weekStartDay}-${currentWeekEnd} ${weekStartLabel || ''}-${currentWeekEndLabel}`}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-zinc-900">{minutesToHHMM(weekTotalMinutes)}</span>
                            {side === 'left' && (
                              <span className={cn('text-[10px] font-bold', achieved ? 'text-emerald-600' : 'text-amber-600')}>
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

      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50/40 px-4 py-3 text-[9px]">
        <button
          onClick={() => onUploadClick?.(side === 'right')}
          className="inline-flex items-center gap-1.5 font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-900"
        >
          <Upload className="h-3 w-3" />
          Subir imagens
        </button>
        <span className="font-medium italic text-zinc-400">Edição manual habilitada</span>
      </div>
    </div>
  );

  return (
    <div className="animate-in space-y-6 fade-in slide-in-from-bottom-4 duration-500 sm:space-y-8">
      <div className="rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm sm:p-6 md:rounded-[2rem] md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3 text-zinc-600 transition-all hover:bg-zinc-100"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                <Calendar className="h-3 w-3" />
                Conferência de Registros
              </div>
              <div className="text-xl font-black italic tracking-tighter text-zinc-900 sm:text-2xl">Lançamento Consolidado</div>
              {competenciaPeriodLabel && <div className="mt-1 text-[11px] font-semibold text-zinc-500">{competenciaPeriodLabel}</div>}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
            <div className="inline-flex w-full rounded-2xl border border-zinc-200 bg-zinc-100 p-1 sm:w-auto">
              <button
                type="button"
                onClick={() => setActiveCardTab('left')}
                className={cn(
                  "flex-1 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition-all sm:flex-none",
                  activeCardTab === 'left' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                )}
              >
                Cartão Normal
              </button>
              <button
                type="button"
                onClick={() => hasOvertimeData && setActiveCardTab('right')}
                className={cn(
                  "flex-1 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition-all sm:flex-none",
                  activeCardTab === 'right' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                  !hasOvertimeData && "cursor-not-allowed opacity-50 hover:text-zinc-500"
                )}
                disabled={!hasOvertimeData}
                title={hasOvertimeData ? 'Ver cartao extra' : 'Nao ha lancamentos no cartao extra'}
              >
                Cartão Extra
              </button>
            </div>

            <button
              onClick={commit}
              disabled={!!disableSave}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-900 bg-zinc-900 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-zinc-200 transition-all hover:-translate-y-0.5 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <Save className="h-4 w-4" />
              {disableSave ? 'Carregando mês...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:gap-8">
        {activeCardTab === 'left' ? renderTable(left, 'left') : renderTable(right, 'right')}
      </div>
    </div>
  );
}
