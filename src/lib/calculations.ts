import { parseISO, format, isValid, startOfWeek, endOfWeek, addDays } from 'date-fns';

export interface Settings {
  baseSalary: number;
  monthlyHours: number;
  dailyJourney: number;
  weeklyLimit: number;
  nightCutoff: string;
  percent50: number;
  percent100: number;
  percentNight: number;
  aiProvider: 'gemini' | 'openai' | 'codex';
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  codexApiKey?: string;
  codexModel?: string;
  // Metadata configuration
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  isOvertimeCard?: boolean;
  dependentes?: number;
  adiantamentoPercent?: number;
  adiantamentoIR?: number;
  saturdayCompensation?: boolean;
  compDays?: string;
  cycleStartDay?: number;
  workStart?: string;
  lunchStart?: string;
  lunchEnd?: string;
  workEnd?: string;
  saturdayWorkStart?: string;
  saturdayWorkEnd?: string;
}

export interface TimeEntry {
  id: string;
  date: string;
  workDate?: string; // Alias for date (used by aiService)
  day?: string;
  entry1: string;
  exit1: string;
  entry2: string;
  exit2: string;
  entryExtra: string;
  exitExtra: string;
  totalHours: string;
  isDPAnnotation?: boolean;
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  isOvertimeCard?: boolean;
  month?: string;
  year?: number;
  frontImage?: string;
  backImage?: string;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  total50: number;
  total50Minutes: number;
  total75: number;
  total75Minutes: number;
  total100: number;
  total100Minutes: number;
  total125: number;
  total125Minutes: number;
  totalValue: number;
  totalBancoHoras: number; // minutes
}

const normalizeClock = (value: unknown): string => {
  const str = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(str) ? str : '';
};

export function normalizeOvernightEntries<T extends TimeEntry>(entries: T[]): T[] {
  if (!Array.isArray(entries) || entries.length === 0) return entries;

  const cloned = entries.map((entry) => ({ ...entry })) as T[];
  const ordered = cloned
    .map((entry) => ({ entry }))
    .sort((a, b) => String(a.entry.date || '').localeCompare(String(b.entry.date || '')));

  const pairs: Array<[keyof TimeEntry, keyof TimeEntry]> = [
    ['entry1', 'exit1'],
    ['entry2', 'exit2'],
    ['entryExtra', 'exitExtra']
  ];

  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].entry;
    const next = ordered[i + 1].entry;

    pairs.forEach(([startKey, endKey]) => {
      const currentStart = normalizeClock(current[startKey]);
      const currentEnd = normalizeClock(current[endKey]);
      const nextStart = normalizeClock(next[startKey]);
      const nextEnd = normalizeClock(next[endKey]);

      // If OCR split an overnight punch across two rows, keep the duration on the start day.
      if (currentStart && !currentEnd && !nextStart && nextEnd) {
        (current as any)[endKey] = nextEnd;
        (next as any)[endKey] = '';
      }
    });
  }

  return cloned;
}

export function timeToMinutes(time: string): number {
  if (!time || !time.includes(':')) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function resolveWorkDateByCompetenciaDay(
  day: number,
  referenceMonth: number,
  referenceYear: number,
  cycleStartDay: number
): string {
  let month = referenceMonth;
  let year = referenceYear;
  if (cycleStartDay > 1 && day > cycleStartDay) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function calculateOvertime(entries: TimeEntry[], settings: Settings) {
  console.log("[DEBUG] calculateOvertime: entries=", entries.length, "settings=", settings);
  if (!settings) throw new Error("Settings are required");
  if (!entries) return null;
  const effectiveEntries = normalizeOvernightEntries(entries);
  
  const hourlyRate = (settings.baseSalary || 0) / (settings.monthlyHours || 1);
  console.log("[DEBUG] hourlyRate=", hourlyRate, "baseSalary=", settings.baseSalary, "monthlyHours=", settings.monthlyHours);
  const rate50 = hourlyRate * (1 + (settings.percent50 || 0) / 100);
  const rate100 = hourlyRate * (1 + (settings.percent100 || 0) / 100);
  
  // Novas regras solicitadas:
  // HE 75% = HE 50% + Adicional Noturno
  const rate75 = hourlyRate * (1 + ((settings.percent50 || 0) + (settings.percentNight || 0)) / 100);
  // HE 125% = HE 100% + Adicional Noturno
  const rate125 = hourlyRate * (1 + ((settings.percent100 || 0) + (settings.percentNight || 0)) / 100);

  const nightCutoffMinutes = timeToMinutes(settings.nightCutoff || '22:00');
  
  // Se for cartão de horas extras, a jornada diária é 0 (tudo é extra)
  const isOvertimeCard = effectiveEntries.length > 0 && !!effectiveEntries[0].isOvertimeCard;
  const dailyJourneyMinutes = isOvertimeCard ? 0 : (settings.dailyJourney || 0) * 60;

  console.log("[DEBUG] isOvertimeCard=", isOvertimeCard, "dailyJourneyMinutes=", dailyJourneyMinutes);

  // Group by week
  // New Rule: First week is the first of the month until first Sunday. Subsequent weeks start on Mondays.
  const weeks: Record<string, TimeEntry[]> = {};
  effectiveEntries.forEach(entry => {
    if (!entry.date) return;
    const date = parseISO(entry.date);
    if (!isValid(date)) return;

    // Use ISO week or start of month to group consistently
    // Option 1: First week of month until first Sunday.
    // Let's stick with the existing logic but make it more robust.
    const dayOfMonth = date.getDate();
    const monthYear = format(date, 'yyyy-MM');
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const dayOfWeekFirstOfMonth = (firstOfMonth.getDay() + 6) % 7 + 1; // Monday = 1, Sunday = 7

    const daysUntilFirstSunday = 7 - (dayOfWeekFirstOfMonth % 7);
    
    let weekIndex = 1;
    if (dayOfMonth > daysUntilFirstSunday) {
      weekIndex = 1 + Math.ceil((dayOfMonth - daysUntilFirstSunday) / 7);
    }
    
    const uniqueWeekKey = `${monthYear}-W${weekIndex}`;
    if (!weeks[uniqueWeekKey]) weeks[uniqueWeekKey] = [];
    weeks[uniqueWeekKey].push(entry);
  });

  let grandTotal50Minutes = 0;
  let grandTotal75Minutes = 0;
  let grandTotal100Minutes = 0;
  let grandTotal125Minutes = 0;
  let grandTotalValue = 0;
  let grandTotalBancoHoras = 0; // minutes

  const weeklySummaries: WeeklySummary[] = [];
  const sortedWeekKeys = Object.keys(weeks).sort((a, b) => {
    // Keys are like "2026-02-W1"
    return a.localeCompare(b, undefined, { numeric: true });
  });

  sortedWeekKeys.forEach(weekKey => {
    const weekEntries = weeks[weekKey];
    let weekOvertimeAccumulator = 0; 
    
    let week50Minutes = 0;
    let week75Minutes = 0;
    let week100Minutes = 0;
    let week125Minutes = 0;
    let weekValue = 0;
    let weekBancoHoras = 0; // minutes

    let weekStartStr = "";
    let weekEndStr = "";

    console.log(`[DEBUG] Processing week: ${weekKey}, entries: ${weekEntries.length}`);

    weekEntries.sort((a, b) => a.date.localeCompare(b.date)).forEach((entry, entryIndex) => {
      if (entryIndex === 0) weekStartStr = entry.date;
      weekEndStr = entry.date;

      const date = parseISO(entry.date);
      const isSunday = date.getDay() === 0;
      const isOvertimeCardEntry = !!entry.isOvertimeCard;
      let dailyJourneyMinutesEntry = isOvertimeCardEntry ? 0 : (settings.dailyJourney || 0) * 60;

      // Compensação de Sábado: Dias selecionados +1h, Sab 0h.
      if (!isOvertimeCardEntry && settings.saturdayCompensation) {
        const compDays = (settings.compDays || '1,2,3,4').split(',').map(Number);
        const dayOfWeek = date.getDay(); // 0-Sun, 1-Mon, ..., 6-Sat
        if (compDays.includes(dayOfWeek)) {
          dailyJourneyMinutesEntry += 60; // +1h nos dias de compensação
        } else if (dayOfWeek === 6) {
          dailyJourneyMinutesEntry = 0; // Sábado compensado
        }
      }

      const periods = [
        [entry.entry1, entry.exit1],
        [entry.entry2, entry.exit2],
        [entry.entryExtra, entry.exitExtra]
      ];

      let dailyTotalMinutes = 0;
      periods.forEach(([start, end]) => {
        // Se ambos vazios, pula
        if (!start && !end) return;
        
        // Se um deles é vazio (ex: virada de dia), trata como 00:00 se o outro existir
        const sVal = start || "00:00";
        const eVal = end || "00:00";
        
        if (!sVal.includes(':') || !eVal.includes(':')) return;

        const sMin = timeToMinutes(sVal);
        const eMin = timeToMinutes(eVal);
        let duration = eMin - sMin;
        // Turno cruzando a meia-noite
        if (duration < 0) duration += 24 * 60;
        
        dailyTotalMinutes += duration;
      });

      // Se não houver jornada configurada (0), tudo vira extra? 
      // Não, assumimos que se dailyJourneyMinutesEntry for 0, o usuário esqueceu de configurar.
      // Se a jornada for 0, mas houver horas trabalhadas, consideramos tudo como extra.
      const dayOvertimeMinutes = isSunday ? dailyTotalMinutes : Math.max(0, dailyTotalMinutes - (dailyJourneyMinutesEntry || (dailyTotalMinutes > 0 ? 0 : Infinity)));
      
      console.log(`[DEBUG] Date: ${entry.date}, DailyTotal: ${dailyTotalMinutes}, Journey: ${dailyJourneyMinutesEntry}, Overtime: ${dayOvertimeMinutes}, isSunday: ${isSunday}, isOvertimeCardEntry: ${isOvertimeCardEntry}`);

      if (!isOvertimeCardEntry) {
        // Cartão Normal: Excedente vai para Banco de Horas (exceto domingos, mas o usuário disse que HE paga só no Cartão de HE)
        // Então até domingo no cartão normal vai pro banco? 
        // No entanto, domingos geralmente são pagos 100%. Vou assumir que o usuário quer que TUDO do normal vá pro banco.
        if (dayOvertimeMinutes > 0) {
          weekBancoHoras += dayOvertimeMinutes;
          grandTotalBancoHoras += dayOvertimeMinutes;
        }
      } else if (dayOvertimeMinutes > 0) {
        // Cartão de Horas Extras: Tudo é extra pago
        const activePeriods = periods.filter(p => p[0] && p[1] && p[0].includes(':') && p[1].includes(':'));
        const lastPeriod = activePeriods[activePeriods.length - 1];
        const dayEndMinutes = lastPeriod ? timeToMinutes(lastPeriod[1]) : 0;

        let processedOvertime = 0;
        const totalOvertimeToProcess = Math.round(dayOvertimeMinutes);

        while (processedOvertime < totalOvertimeToProcess) {
          const currentMinuteFromEnd = dayEndMinutes - (processedOvertime + 0.5);
          let normalizedMinute = currentMinuteFromEnd;
          while (normalizedMinute < 0) normalizedMinute += 24 * 60;
          while (normalizedMinute >= 24 * 60) normalizedMinute -= 24 * 60;

          // Adicional noturno geralmente das 22h às 05h, mas o sistema aceita cutoff customizado
          // Vamos assumir que se o cutoff é 22:00, vai até 05:00 do dia seguinte.
          const isAtNight = normalizedMinute >= nightCutoffMinutes || normalizedMinute < 5 * 60;
          const chunk = 1;

          if (isSunday) {
            if (isAtNight) {
              week125Minutes += chunk;
              grandTotal125Minutes += chunk;
            } else {
              week100Minutes += chunk;
              grandTotal100Minutes += chunk;
            }
          } else {
            // Limite semanal de horas extras (ex: 44h é jornada normal, mas o weeklyLimit aqui 
            // parece ser usado para mudar a taxa de 50% para 100% após X horas extras na SEMANA).
            // No entanto, no Brasil, geralmente é 2h extras por dia a 50%.
            // O código original usava weekOvertimeAccumulator < limitMinutes
            const limitMinutes = (settings.weeklyLimit || 0) * 60;
            const isWithinLimit = limitMinutes > 0 ? weekOvertimeAccumulator < limitMinutes : true;

            if (isWithinLimit) {
              if (isAtNight) {
                week75Minutes += chunk;
                grandTotal75Minutes += chunk;
              } else {
                week50Minutes += chunk;
                grandTotal50Minutes += chunk;
              }
            } else {
              if (isAtNight) {
                week125Minutes += chunk;
                grandTotal125Minutes += chunk;
              } else {
                week100Minutes += chunk;
                grandTotal100Minutes += chunk;
              }
            }
            weekOvertimeAccumulator += chunk;
          }
          processedOvertime += chunk;
        }
      }
    });

    const week50 = week50Minutes / 60;
    const week75 = week75Minutes / 60;
    const week100 = week100Minutes / 60;
    const week125 = week125Minutes / 60;
    weekValue = Number(((week50 * rate50) + (week75 * rate75) + (week100 * rate100) + (week125 * rate125)).toFixed(2));
    grandTotalValue += weekValue;
    
    weeklySummaries.push({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      total50: Number(week50.toFixed(2)),
      total50Minutes: week50Minutes,
      total75: Number(week75.toFixed(2)),
      total75Minutes: week75Minutes,
      total100: Number(week100.toFixed(2)),
      total100Minutes: week100Minutes,
      total125: Number(week125.toFixed(2)),
      total125Minutes: week125Minutes,
      totalValue: weekValue,
      totalBancoHoras: weekBancoHoras
    });
  });

  grandTotalValue = Number(grandTotalValue.toFixed(2));
  const grandTotal50 = grandTotal50Minutes / 60;
  const grandTotal75 = grandTotal75Minutes / 60;
  const grandTotal100 = grandTotal100Minutes / 60;
  const grandTotal125 = grandTotal125Minutes / 60;
  
  return {
    weeklySummaries,
    grandTotal50: Number(grandTotal50.toFixed(2)),
    grandTotal50Minutes,
    grandTotal75: Number(grandTotal75.toFixed(2)),
    grandTotal75Minutes,
    grandTotal100: Number(grandTotal100.toFixed(2)),
    grandTotal100Minutes,
    grandTotal125: Number(grandTotal125.toFixed(2)),
    grandTotal125Minutes,
    grandTotalValue,
    grandTotalBancoHoras,
    hourlyRate,
    rate50,
    rate75,
    rate100,
    rate125
  };
}
