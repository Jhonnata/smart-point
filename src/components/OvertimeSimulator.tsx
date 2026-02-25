import React from 'react';
import { parseISO, isValid } from 'date-fns';
import { Calculator, Save, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings, TimeEntry } from '../lib/calculations';
import { resolveWorkDateByCompetenciaDay, timeToMinutes } from '../lib/calculations';
import { apiFetch } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';

type RateMode = 'auto' | 'fixed';
type ExtraRateType = '50' | '75' | '100' | '125';
type TimeField = 'entry1' | 'exit1' | 'entry2' | 'exit2' | 'entryExtra' | 'exitExtra';

interface BaseSchedule {
  entry1: string;
  exit1: string;
  entry2: string;
  exit2: string;
}

interface PlanRow {
  key: string;
  day: string;
  date: string;
  selected: boolean;
  entry1: string;
  exit1: string;
  entry2: string;
  exit2: string;
  entryExtra: string;
  exitExtra: string;
  capacityHours: string;
}

interface DayResult extends PlanRow {
  minutes: number;
  value: number;
  invalidInsideSchedule: boolean;
  invalidSaturdayWithoutCompensation: boolean;
  truncatedSaturdayLimit: boolean;
}

interface SavedPlanPayload {
  version: number;
  targetValueInput: string;
  rateMode: RateMode;
  fixedRateType: ExtraRateType;
  defaultCapacityHours: string;
  preferSaturdayMax?: boolean;
  allowSaturdayExtra2?: boolean;
  baseSchedule: BaseSchedule;
  rows: PlanRow[];
}

interface Props {
  entries: TimeEntry[];
  settings: Settings;
  month?: string;
}

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

function normalizeTime(raw: string, finalize: boolean): string {
  const v = (raw || '').trim();
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  if (!d) return '';
  if (!finalize) {
    if (v.includes(':')) {
      const [hRaw = '', mRaw = ''] = v.replace(/[^\d:]/g, '').split(':');
      const h = hRaw.slice(0, 2);
      const m = mRaw.slice(0, 2);
      if (mRaw.length === 0 && v.endsWith(':')) return `${h}:`;
      if (m.length === 0) return h;
      return `${h}:${m}`;
    }
    return d.slice(0, 4);
  }
  let hStr = '';
  let mStr = '';
  if (v.includes(':')) {
    const [hRaw = '', mRaw = ''] = v.replace(/[^\d:]/g, '').split(':');
    hStr = hRaw;
    mStr = mRaw;
  } else if (d.length <= 2) {
    hStr = d;
    mStr = '00';
  } else if (d.length === 3) {
    hStr = d.slice(0, 1);
    mStr = d.slice(1, 3);
  } else {
    hStr = d.slice(0, 2);
    mStr = d.slice(2, 4);
  }
  const hh = Math.min(23, Math.max(0, Number(hStr || '0')));
  const mm = Math.min(59, Math.max(0, Number(mStr || '0')));
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function diffMinutes(start: string, end: string): number {
  if (!start || !end || !start.includes(':') || !end.includes(':')) return 0;
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return Math.max(0, d);
}

function formatHHMM(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function parseMoneyInput(raw: string): number {
  const clean = (raw || '').trim().replace(/[^\d,.-]/g, '');
  if (!clean) return 0;
  let normalized = clean;
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isExtraOutsideSchedule(
  extraStart: string,
  extraEnd: string,
  scheduleStart: string,
  scheduleEnd: string
): boolean {
  if (!extraStart || !extraEnd || !scheduleStart || !scheduleEnd) return false;
  if (!extraStart.includes(':') || !extraEnd.includes(':')) return false;
  if (!scheduleStart.includes(':') || !scheduleEnd.includes(':')) return false;

  const es = timeToMinutes(extraStart);
  const ee = timeToMinutes(extraEnd);
  const ss = timeToMinutes(scheduleStart);
  const se = timeToMinutes(scheduleEnd);
  const crossesMidnight = ee <= es;

  const isBefore = !crossesMidnight && ee <= ss;
  const isAfter = es >= se;
  return isBefore || isAfter;
}

function monthKeyToReference(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return year && month ? `${month}${year}` : '';
}

function mergeRows(baseRows: PlanRow[], savedRows?: PlanRow[]): PlanRow[] {
  const byDay: Record<string, PlanRow> = {};
  (savedRows || []).forEach((r) => { if (r?.day) byDay[r.day] = r; });
  return baseRows.map((base) => {
    const saved = byDay[base.day];
    if (!saved) return base;
    return {
      ...base,
      selected: !!saved.selected,
      entry1: saved.entry1 || base.entry1,
      exit1: saved.exit1 || base.exit1,
      entry2: saved.entry2 || base.entry2,
      exit2: saved.exit2 || base.exit2,
      entryExtra: saved.entryExtra || base.entryExtra,
      exitExtra: saved.exitExtra || base.exitExtra,
      capacityHours: saved.capacityHours || base.capacityHours,
    };
  });
}

export default function OvertimeSimulator({ entries, settings, month }: Props) {
  const hourlyRate = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
  const rates = React.useMemo(() => ({
    '50': hourlyRate * (1 + (settings.percent50 || 0) / 100),
    '75': hourlyRate * (1 + ((settings.percent50 || 0) + (settings.percentNight || 0)) / 100),
    '100': hourlyRate * (1 + (settings.percent100 || 0) / 100),
    '125': hourlyRate * (1 + ((settings.percent100 || 0) + (settings.percentNight || 0)) / 100),
  }), [hourlyRate, settings.percent50, settings.percent100, settings.percentNight]);

  const [targetValueInput, setTargetValueInput] = React.useState('');
  const [rateMode, setRateMode] = React.useState<RateMode>('auto');
  const [fixedRateType, setFixedRateType] = React.useState<ExtraRateType>('50');
  const [defaultCapacityHours, setDefaultCapacityHours] = React.useState('02');
  const [preferSaturdayMax, setPreferSaturdayMax] = React.useState(true);
  const [allowSaturdayExtra2, setAllowSaturdayExtra2] = React.useState(false);
  const [isPlanLoading, setIsPlanLoading] = React.useState(false);
  const [isPlanSaving, setIsPlanSaving] = React.useState(false);

  const referenceMonth = React.useMemo(() => {
    if (month && /^\d{4}-\d{2}$/.test(month)) return month;
    const sample = entries.find((e) => !!e.date)?.date?.slice(0, 7);
    if (sample && /^\d{4}-\d{2}$/.test(sample)) return sample;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [entries, month]);
  const reference = React.useMemo(() => monthKeyToReference(referenceMonth), [referenceMonth]);
  const initialBaseSchedule = React.useMemo<BaseSchedule>(() => {
    return {
      entry1: normalizeTime(settings.workStart || '12:00', true),
      exit1: normalizeTime(settings.lunchStart || '17:00', true),
      entry2: normalizeTime(settings.lunchEnd || '18:00', true),
      exit2: normalizeTime(settings.workEnd || '21:00', true),
    };
  }, [settings.workStart, settings.lunchStart, settings.lunchEnd, settings.workEnd]);

  const [baseSchedule, setBaseSchedule] = React.useState<BaseSchedule>(initialBaseSchedule);

  const initialRows = React.useMemo(() => {
    const [yearStr, monthStr] = referenceMonth.split('-');
    const refYear = Number(yearStr);
    const refMonth = Number(monthStr);
    const cycle = settings.cycleStartDay || 15;
    const byDay: Record<string, TimeEntry> = {};
    entries.filter((e) => !!e.isOvertimeCard).forEach((e) => {
      const d = e.day || (e.date || '').slice(8, 10);
      if (d) byDay[d] = e;
    });
    const out: PlanRow[] = [];
    for (let day = 1; day <= 31; day++) {
      const dayStr = day.toString().padStart(2, '0');
      const date = resolveWorkDateByCompetenciaDay(day, refMonth, refYear, cycle);
      const src = byDay[dayStr];
      const d = parseISO(date);
      const selected = isValid(d) ? d.getDay() >= 1 && d.getDay() <= 6 : false;
      out.push({
        key: `${date}-${dayStr}`,
        day: dayStr,
        date,
        selected,
        entry1: normalizeTime(src?.entry1 || '', true),
        exit1: normalizeTime(src?.exit1 || '', true),
        entry2: normalizeTime(src?.entry2 || '', true),
        exit2: normalizeTime(src?.exit2 || '', true),
        entryExtra: normalizeTime(src?.entryExtra || '', true),
        exitExtra: normalizeTime(src?.exitExtra || '', true),
        capacityHours: '02',
      });
    }
    return out;
  }, [entries, referenceMonth, settings.cycleStartDay]);

  const [rows, setRows] = React.useState<PlanRow[]>(initialRows);

  React.useEffect(() => {
    setBaseSchedule(initialBaseSchedule);
    setRows(initialRows);
  }, [initialBaseSchedule, initialRows]);

  React.useEffect(() => {
    let cancelled = false;
    const loadPlan = async () => {
      if (!reference) return;
      setIsPlanLoading(true);
      try {
        const res = await apiFetch(`/api/simulator-plan/${reference}`);
        if (!res.ok) return;
        const data = await res.json();
        const plan = (data?.plan || null) as SavedPlanPayload | null;
        if (!plan || cancelled) return;
        if (typeof plan.targetValueInput === 'string') setTargetValueInput(plan.targetValueInput);
        if (plan.rateMode === 'auto' || plan.rateMode === 'fixed') setRateMode(plan.rateMode);
        if (['50', '75', '100', '125'].includes(plan.fixedRateType)) setFixedRateType(plan.fixedRateType);
        if (typeof plan.defaultCapacityHours === 'string') setDefaultCapacityHours(plan.defaultCapacityHours);
        if (typeof plan.preferSaturdayMax === 'boolean') setPreferSaturdayMax(plan.preferSaturdayMax);
        if (typeof plan.allowSaturdayExtra2 === 'boolean') setAllowSaturdayExtra2(plan.allowSaturdayExtra2);
        if (plan.baseSchedule) {
          setBaseSchedule({
            entry1: normalizeTime(plan.baseSchedule.entry1 || '', true),
            exit1: normalizeTime(plan.baseSchedule.exit1 || '', true),
            entry2: normalizeTime(plan.baseSchedule.entry2 || '', true),
            exit2: normalizeTime(plan.baseSchedule.exit2 || '', true),
          });
        }
        setRows(mergeRows(initialRows, plan.rows));
      } catch (err) {
        console.error('Failed to load simulator plan', err);
      } finally {
        if (!cancelled) setIsPlanLoading(false);
      }
    };
    loadPlan();
    return () => { cancelled = true; };
  }, [initialRows, reference]);

  const nightCutoffMinutes = timeToMinutes(settings.nightCutoff || '22:00');
  const targetValue = parseMoneyInput(targetValueInput);
  const parsedCompDays = React.useMemo(
    () => (settings.compDays || '1,2,3,4')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6),
    [settings.compDays]
  );
  const compDaysLabel = React.useMemo(() => {
    const labels = parsedCompDays
      .filter((d) => d >= 0 && d < WEEKDAY_ABBR.length)
      .map((d) => WEEKDAY_ABBR[d]);
    return labels.length > 0 ? labels.join(', ') : 'nenhum';
  }, [parsedCompDays]);
  const saturdayLimitMinutes = React.useMemo(
    () => (allowSaturdayExtra2 ? 8 * 60 : 6 * 60),
    [allowSaturdayExtra2]
  );

  const getMinuteRate = React.useCallback((dateStr: string, minuteOfDay: number): number => {
    if (rateMode === 'fixed') return rates[fixedRateType];
    const d = parseISO(dateStr);
    const day = isValid(d) ? d.getDay() : 1;
    if (day === 6 && settings.saturdayCompensation) return rates['100'];
    const isNight = minuteOfDay >= nightCutoffMinutes || minuteOfDay < 5 * 60;
    if (day === 0) return isNight ? rates['125'] : rates['100'];
    return isNight ? rates['75'] : rates['50'];
  }, [rateMode, rates, fixedRateType, settings.saturdayCompensation, nightCutoffMinutes]);

  const dayResults = React.useMemo<DayResult[]>(() => rows.map((row) => {
    if (!row.selected) {
      return {
        ...row,
        minutes: 0,
        value: 0,
        invalidInsideSchedule: false,
        invalidSaturdayWithoutCompensation: false,
        truncatedSaturdayLimit: false
      };
    }

    const dateObj = parseISO(row.date);
    const dayOfWeek = isValid(dateObj) ? dateObj.getDay() : -1;
    const scheduleStart = normalizeTime(baseSchedule.entry1 || settings.workStart || '12:00', true);
    const scheduleEnd = normalizeTime(baseSchedule.exit2 || settings.workEnd || '21:00', true);
    const periods: Array<[string, string]> = [
      [normalizeTime(row.entry1, true), normalizeTime(row.exit1, true)],
      [normalizeTime(row.entry2, true), normalizeTime(row.exit2, true)],
      [normalizeTime(row.entryExtra, true), normalizeTime(row.exitExtra, true)],
    ];

    let totalMinutes = 0;
    let totalValue = 0;
    let invalidInsideSchedule = false;
    let invalidSaturdayWithoutCompensation = false;
    let truncatedSaturdayLimit = false;
    let saturdayAllocatedMinutes = 0;

    for (const [start, end] of periods) {
      const duration = diffMinutes(start, end);
      if (duration <= 0) continue;

      if (dayOfWeek === 6 && !settings.saturdayCompensation) {
        invalidSaturdayWithoutCompensation = true;
        continue;
      }

      if (dayOfWeek === 6 && settings.saturdayCompensation) {
        const available = Math.max(0, saturdayLimitMinutes - saturdayAllocatedMinutes);
        if (available <= 0) {
          truncatedSaturdayLimit = true;
          continue;
        }
        const countedDuration = Math.min(duration, available);
        if (countedDuration < duration) truncatedSaturdayLimit = true;

        const startMin = timeToMinutes(start);
        totalMinutes += countedDuration;
        saturdayAllocatedMinutes += countedDuration;
        for (let i = 0; i < countedDuration; i++) {
          const minuteOfDay = (startMin + i) % (24 * 60);
          totalValue += getMinuteRate(row.date, minuteOfDay) / 60;
        }
        continue;
      }

      if (dayOfWeek !== 0 && !(dayOfWeek === 6 && settings.saturdayCompensation)) {
        const outsideSchedule = isExtraOutsideSchedule(start, end, scheduleStart, scheduleEnd);
        if (!outsideSchedule) {
          invalidInsideSchedule = true;
          continue;
        }
      }

      const startMin = timeToMinutes(start);
      totalMinutes += duration;
      for (let i = 0; i < duration; i++) {
        const minuteOfDay = (startMin + i) % (24 * 60);
        totalValue += getMinuteRate(row.date, minuteOfDay) / 60;
      }
    }

    return {
      ...row,
      minutes: totalMinutes,
      value: totalValue,
      invalidInsideSchedule,
      invalidSaturdayWithoutCompensation,
      truncatedSaturdayLimit
    };
  }), [rows, baseSchedule, settings.workStart, settings.workEnd, settings.saturdayCompensation, saturdayLimitMinutes, getMinuteRate]);

  const totals = React.useMemo(() => {
    const selected = dayResults.filter((r) => r.selected);
    const totalMinutes = selected.reduce((a, r) => a + r.minutes, 0);
    const totalValue = selected.reduce((a, r) => a + r.value, 0);
    const remaining = Math.max(0, targetValue - totalValue);
    const exceed = Math.max(0, totalValue - targetValue);
    return { totalMinutes, totalValue, remaining, exceed };
  }, [dayResults, targetValue]);
  const invalidInsideScheduleCount = React.useMemo(
    () => dayResults.filter((r) => r.selected && r.invalidInsideSchedule).length,
    [dayResults]
  );
  const invalidSaturdayCount = React.useMemo(
    () => dayResults.filter((r) => r.selected && r.invalidSaturdayWithoutCompensation).length,
    [dayResults]
  );
  const saturdayLimitCount = React.useMemo(
    () => dayResults.filter((r) => r.selected && r.truncatedSaturdayLimit).length,
    [dayResults]
  );

  const estimatedHoursNeeded = React.useMemo(() => {
    const refRate = rateMode === 'fixed' ? rates[fixedRateType] : rates['50'];
    if (refRate <= 0 || targetValue <= 0) return 0;
    return targetValue / refRate;
  }, [rateMode, rates, fixedRateType, targetValue]);
  const toggleDay = (key: string, checked: boolean) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: checked } : r)));
  };

  const updateTime = (key: string, field: TimeField, value: string, finalize = false) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: normalizeTime(value, finalize) } : r)));
  };

  const updateCapacity = (key: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, capacityHours: value } : r)));
  };

  const updateBase = (field: keyof BaseSchedule, value: string, finalize = false) => {
    setBaseSchedule((prev) => ({ ...prev, [field]: normalizeTime(value, finalize) }));
  };

  const applyBaseSchedule = () => {
    toast.success('Jornada normal de referencia atualizada.');
  };

  const applyDefaultCapacity = () => {
    const n = Number(defaultCapacityHours.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Informe uma capacidade padrao valida.');
      return;
    }
    const v = n.toFixed(2);
    setRows((prev) => prev.map((r) => ({ ...r, capacityHours: v })));
    toast.success('Capacidade aplicada para todos os dias.');
  };

  const suggestDistribution = () => {
    if (targetValue <= 0) {
      toast.error('Informe o valor alvo para simular.');
      return;
    }
    if (rows.filter((r) => r.selected).length === 0) {
      toast.error('Selecione ao menos um dia para distribuir.');
      return;
    }

    let remaining = targetValue;
    const next = rows.map((r) => ({
      ...r,
      entry1: '',
      exit1: '',
      entry2: '',
      exit2: '',
      entryExtra: '',
      exitExtra: ''
    }));
    const priorityOrder = [...next]
      .filter((r) => r.selected)
      .sort((a, b) => {
        const dateA = parseISO(a.date);
        const dateB = parseISO(b.date);
        const dayA = isValid(dateA) ? dateA.getDay() : -1;
        const dayB = isValid(dateB) ? dateB.getDay() : -1;
        const prioA = (preferSaturdayMax && dayA === 6 && settings.saturdayCompensation) ? 0 : (parsedCompDays.includes(dayA) ? 1 : 2);
        const prioB = (preferSaturdayMax && dayB === 6 && settings.saturdayCompensation) ? 0 : (parsedCompDays.includes(dayB) ? 1 : 2);
        if (prioA !== prioB) return prioA - prioB;
        return a.date.localeCompare(b.date);
      });

    for (const row of priorityOrder) {
      if (!row.selected) continue;
      const dateObj = parseISO(row.date);
      const isSaturday = isValid(dateObj) && dateObj.getDay() === 6;
      if (isSaturday && !settings.saturdayCompensation) continue;

      const startRaw = isSaturday
        ? normalizeTime(settings.saturdayWorkStart || '12:00', true)
        : normalizeTime(baseSchedule.exit2 || settings.workEnd || '21:00', true);
      const start = normalizeTime(startRaw, true);
      if (!start || !start.includes(':')) continue;
      const capH = Number((row.capacityHours || '0').replace(',', '.'));
      const rawCapMin = Math.max(0, Math.round((Number.isFinite(capH) ? capH : 0) * 60));
      const capMin = isSaturday ? Math.min(rawCapMin, saturdayLimitMinutes) : rawCapMin;
      if (capMin <= 0) continue;
      const startMin = timeToMinutes(start);
      let allocated = 0;
      for (let i = 0; i < capMin; i++) {
        if (remaining <= 0) break;
        const minuteOfDay = (startMin + i) % (24 * 60);
        remaining -= getMinuteRate(row.date, minuteOfDay) / 60;
        allocated += 1;
      }
      if (allocated > 0) {
        row.entry1 = start;
        row.exit1 = formatHHMM(startMin + allocated);
      }
      if (remaining <= 0) break;
    }

    setRows(next);
    if (remaining > 0) toast.warning(`Capacidade insuficiente para atingir o alvo. Faltam ${formatCurrency(remaining)}.`);
    else toast.success('Distribuicao sugerida aplicada.');
  };

  const savePlan = async () => {
    if (!reference) {
      toast.error('Referencia invalida para salvar o planejamento.');
      return;
    }
    const payload: SavedPlanPayload = {
      version: 3,
      targetValueInput,
      rateMode,
      fixedRateType,
      defaultCapacityHours,
      preferSaturdayMax,
      allowSaturdayExtra2,
      baseSchedule,
      rows,
    };
    setIsPlanSaving(true);
    try {
      const res = await apiFetch(`/api/simulator-plan/${reference}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Erro ao salvar planejamento (${res.status})`);
      }
      toast.success('Planejamento salvo com sucesso.');
    } catch (err: any) {
      console.error('Failed to save simulator plan', err);
      toast.error(err?.message || 'Nao foi possivel salvar o planejamento.');
    } finally {
      setIsPlanSaving(false);
    }
  };
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="bg-white p-6 rounded-[2rem] border border-zinc-100 shadow-sm space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-zinc-700">
            <Calculator className="w-5 h-5" />
            <h3 className="text-base font-black">Simulador de Horas Extras</h3>
          </div>
          <button type="button" onClick={savePlan} disabled={isPlanSaving || isPlanLoading} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-2">
            <Save className="w-4 h-4" />
            {isPlanSaving ? 'Salvando...' : 'Salvar planejamento'}
          </button>
        </div>

        <div className="text-[11px] text-zinc-500 font-medium">Referencia: {referenceMonth} {isPlanLoading ? '(carregando planejamento...)' : ''}</div>
        {settings.saturdayCompensation && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Regra ativa: com compensacao semanal, sabado e calculado em 100% (maximo {Math.round(saturdayLimitMinutes / 60)}h por sabado no sugestor).</div>}
        <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          Dias configurados para compensacao: <span className="font-bold uppercase">{compDaysLabel}</span>. A sugestao prioriza: {preferSaturdayMax ? 'sabado, depois dias de compensacao, depois demais dias' : 'dias de compensacao, depois demais dias'}.
        </div>
        <div className="text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
          Regra de simulacao: somente periodos fora da jornada normal contam como HE (antes da entrada ou apos a saida).
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-[11px] font-bold text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={preferSaturdayMax}
              onChange={(e) => setPreferSaturdayMax(e.target.checked)}
              className="w-4 h-4 accent-zinc-900"
            />
            Priorizar sabados no sugestor (meta de maximo {Math.round(saturdayLimitMinutes / 60)}h)
          </label>
          <label className="flex items-center gap-2 text-[11px] font-bold text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
            <input
              type="checkbox"
              checked={allowSaturdayExtra2}
              onChange={(e) => setAllowSaturdayExtra2(e.target.checked)}
              className="w-4 h-4 accent-zinc-900"
            />
            Permitir +2h no sabado (limite vai para 8h)
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Valor alvo (R$)</label><input value={targetValueInput} onChange={(e) => setTargetValueInput(e.target.value)} placeholder="Ex.: 1200" className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none" /></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Modo de taxa</label><select value={rateMode} onChange={(e) => setRateMode(e.target.value as RateMode)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none bg-white"><option value="auto">Automatico (dia/horario)</option><option value="fixed">Fixo</option></select></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Tipo fixo</label><select value={fixedRateType} onChange={(e) => setFixedRateType(e.target.value as ExtraRateType)} disabled={rateMode !== 'fixed'} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none bg-white disabled:bg-zinc-100 disabled:text-zinc-400"><option value="50">HE 50%</option><option value="75">HE 75%</option><option value="100">HE 100%</option><option value="125">HE 125%</option></select></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Capacidade padrao (h/dia)</label><div className="flex gap-2"><input value={defaultCapacityHours} onChange={(e) => setDefaultCapacityHours(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none" /><button type="button" onClick={applyDefaultCapacity} className="px-3 py-2.5 rounded-xl bg-zinc-100 text-zinc-700 text-xs font-black uppercase tracking-wide hover:bg-zinc-200">Aplicar</button></div></div>
          <div className="flex items-end"><button type="button" onClick={suggestDistribution} className="w-full px-4 py-2.5 rounded-xl bg-zinc-900 text-white text-xs font-black uppercase tracking-wide hover:bg-zinc-800 inline-flex items-center justify-center gap-2"><WandSparkles className="w-4 h-4" />Sugerir distribuicao</button></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Entrada</label><input value={baseSchedule.entry1} onChange={(e) => updateBase('entry1', e.target.value)} onBlur={(e) => updateBase('entry1', e.target.value, true)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none text-center" placeholder="12:00" inputMode="numeric" maxLength={5} /></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Saida almoco</label><input value={baseSchedule.exit1} onChange={(e) => updateBase('exit1', e.target.value)} onBlur={(e) => updateBase('exit1', e.target.value, true)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none text-center" placeholder="17:00" inputMode="numeric" maxLength={5} /></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Retorno almoco</label><input value={baseSchedule.entry2} onChange={(e) => updateBase('entry2', e.target.value)} onBlur={(e) => updateBase('entry2', e.target.value, true)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none text-center" placeholder="18:00" inputMode="numeric" maxLength={5} /></div>
          <div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Saida</label><input value={baseSchedule.exit2} onChange={(e) => updateBase('exit2', e.target.value)} onBlur={(e) => updateBase('exit2', e.target.value, true)} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-zinc-900 outline-none text-center" placeholder="21:00" inputMode="numeric" maxLength={5} /></div>
          <div className="flex items-end"><button type="button" onClick={applyBaseSchedule} className="w-full px-4 py-2.5 rounded-xl bg-zinc-100 text-zinc-800 text-xs font-black uppercase tracking-wide hover:bg-zinc-200">Confirmar jornada</button></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100"><div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Valor alvo</div><div className="text-lg font-black text-zinc-900">{formatCurrency(targetValue)}</div></div>
          <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100"><div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Valor planejado</div><div className="text-lg font-black text-emerald-600">{formatCurrency(totals.totalValue)}</div></div>
          <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100"><div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Horas planejadas</div><div className="text-lg font-black text-zinc-900">{(totals.totalMinutes / 60).toFixed(2)}h</div></div>
          <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100"><div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Horas estimadas alvo</div><div className="text-lg font-black text-zinc-900">{estimatedHoursNeeded.toFixed(2)}h</div></div>
        </div>

        <div className="text-xs font-medium text-zinc-500">{totals.remaining > 0 ? `Ainda faltam ${formatCurrency(totals.remaining)} para atingir o alvo.` : totals.exceed > 0 ? `Voce ultrapassou o alvo em ${formatCurrency(totals.exceed)}.` : 'Alvo atingido no planejamento atual.'}</div>
        {invalidInsideScheduleCount > 0 && (
          <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {invalidInsideScheduleCount} dia(s) com HE dentro da jornada normal foram ignorados no calculo.
          </div>
        )}
        {invalidSaturdayCount > 0 && (
          <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {invalidSaturdayCount} sabado(s) ignorados: so contam como extra quando a compensacao de sabado esta ativa.
          </div>
        )}
        {saturdayLimitCount > 0 && (
          <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {saturdayLimitCount} sabado(s) limitados em {Math.round(saturdayLimitMinutes / 60)}h para manter a regra de simulacao.
          </div>
        )}
      </div>

      <div className="bg-white rounded-[2rem] border border-zinc-100 overflow-hidden shadow-sm">
        <div className={cn('px-6 py-4 text-xs font-black uppercase tracking-widest border-b flex items-center justify-between', 'bg-red-50 text-red-700 border-red-100')}><span>Planejamento de Horas Extras</span><div className="w-2 h-2 rounded-full bg-red-500" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]"><thead><tr className="text-left bg-zinc-50/50"><th rowSpan={2} className="px-4 py-3 w-36 text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100">Dia</th><th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Manha</th><th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Tarde</th><th colSpan={2} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-zinc-100 border-l border-zinc-100 bg-zinc-100/30">Extra</th><th rowSpan={2} className="px-2 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center border-b border-zinc-100 border-l border-zinc-100">Cap. h</th><th rowSpan={2} className="px-2 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-right border-b border-zinc-100 border-l border-zinc-100">Total</th><th rowSpan={2} className="px-2 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-right border-b border-zinc-100 border-l border-zinc-100">Valor</th></tr><tr className="text-left bg-zinc-50/50"><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 border-l border-zinc-100 text-center">Ent.</th><th className="px-2 py-1.5 text-[9px] font-black uppercase text-zinc-400 text-center">Sai.</th></tr></thead>
            <tbody className="divide-y divide-zinc-50">{dayResults.map((row) => { const d = parseISO(row.date); const validDate = isValid(d); const dayOfWeek = validDate ? d.getDay() : -1; const isWeekend = validDate && (dayOfWeek === 0 || dayOfWeek === 6); const dayDisplayName = validDate ? WEEKDAY_ABBR[dayOfWeek] : ''; const monthDisplayName = validDate ? MONTH_ABBR[d.getMonth()] : ''; return (<tr key={row.key} className={isWeekend ? 'bg-zinc-50/30' : 'hover:bg-zinc-50/40'}><td className="px-4 py-2 border-r border-zinc-50"><div className="flex items-center gap-2"><input type="checkbox" checked={row.selected} onChange={(e) => toggleDay(row.key, e.target.checked)} className="w-4 h-4 accent-zinc-900" /><span className="font-black text-zinc-900">{row.day}</span><span className="text-[10px] font-bold text-zinc-400 tracking-tighter">{dayDisplayName}</span><span className="text-[9px] font-semibold text-zinc-400 uppercase">{monthDisplayName}</span></div></td><td className="px-1 py-1.5"><input value={row.entry1} onChange={(e) => updateTime(row.key, 'entry1', e.target.value)} onBlur={(e) => updateTime(row.key, 'entry1', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-1 py-1.5 border-r border-zinc-50"><input value={row.exit1} onChange={(e) => updateTime(row.key, 'exit1', e.target.value)} onBlur={(e) => updateTime(row.key, 'exit1', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-1 py-1.5"><input value={row.entry2} onChange={(e) => updateTime(row.key, 'entry2', e.target.value)} onBlur={(e) => updateTime(row.key, 'entry2', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-1 py-1.5 border-r border-zinc-50"><input value={row.exit2} onChange={(e) => updateTime(row.key, 'exit2', e.target.value)} onBlur={(e) => updateTime(row.key, 'exit2', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-1 py-1.5"><input value={row.entryExtra} onChange={(e) => updateTime(row.key, 'entryExtra', e.target.value)} onBlur={(e) => updateTime(row.key, 'entryExtra', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-1 py-1.5 border-r border-zinc-50"><input value={row.exitExtra} onChange={(e) => updateTime(row.key, 'exitExtra', e.target.value)} onBlur={(e) => updateTime(row.key, 'exitExtra', e.target.value, true)} disabled={!row.selected} className="w-full px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="--:--" inputMode="numeric" maxLength={5} /></td><td className="px-2 py-1.5 border-r border-zinc-50"><input value={row.capacityHours} onChange={(e) => updateCapacity(row.key, e.target.value)} disabled={!row.selected} className="w-14 mx-auto block px-1.5 py-1.5 rounded-lg border border-zinc-200 text-[11px] font-bold focus:ring-2 focus:ring-zinc-900 outline-none transition-all text-center disabled:bg-zinc-100" placeholder="2" /></td><td className="px-2 py-1.5 text-right bg-zinc-50/20"><span className="font-black text-zinc-900 text-[11px]">{(row.minutes / 60).toFixed(2)}h</span></td><td className="px-2 py-1.5 text-right bg-zinc-50/20"><span className="font-black text-emerald-600 text-[11px]">{formatCurrency(row.value)}</span></td></tr>); })}</tbody></table>
        </div>
      </div>
    </div>
  );
}
