import type {
  CompanyCalculationConfig,
  CompanyDailyOvertimeDiscountRule,
  CompanyOvertimeRule,
  CompanyRubricEntry,
  CompanyRubricKey,
  CompanyRubricMap,
  CompanySettingsProfile,
  Settings
} from './calculations';
import { buildSuggestedCompanyRubrics, buildSuggestedDailyOvertimeDiscountRules, buildSuggestedOvertimeRules } from './calculations';
import { supabase, SUPABASE_CARDS_BUCKET } from './supabase';

type CardType = 'normal' | 'overtime';

type ReferencePayload = {
  companyName?: string;
  companyCnpj?: string;
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  cardNumber?: string;
  month: string;
  year: number;
  hours?: any[];
  he?: any[];
  frontImage?: string;
  backImage?: string;
  frontImageHe?: string;
  backImageHe?: string;
};

type SaveReferenceResult = {
  skippedInvalidDates: number;
};

const COMPANY_RUBRIC_KEYS: CompanyRubricKey[] = [
  'SALARIO_FIXO',
  'HE_50',
  'HE_75',
  'HE_100',
  'HE_125',
  'ADIC_NOT',
  'DSR_HE',
  'DSR_NOT',
  'DESC_HE_1',
  'DESC_HE_2',
  'ATRASO',
  'DSR_ATRASO',
];

const DEFAULT_SETTINGS: Settings = {
  baseSalary: 9251.05,
  monthlyHours: 220,
  dailyJourney: 8,
  weeklyLimit: 3,
  nightCutoff: '22:00',
  percent50: 50,
  percent100: 100,
  percentNight: 25,
  aiProvider: 'gemini',
  geminiModel: 'gemini-3-flash-preview',
  dependentes: 0,
  adiantamentoPercent: 40,
  adiantamentoIR: 0,
  saturdayCompensation: false,
  cycleStartDay: 16,
  compDays: '1,2,3,4',
  workStart: '12:00',
  lunchStart: '17:00',
  lunchEnd: '18:00',
  workEnd: '21:00',
  saturdayWorkStart: '12:00',
  saturdayWorkEnd: '16:00',
  employeeName: '',
  employeeCode: '',
  role: '',
  location: '',
  companyName: '',
  companyCnpj: '',
  cardNumber: '',
  companySettings: null,
};

function createEmptyCompanyRubrics(): CompanyRubricMap {
  const suggestions = buildSuggestedCompanyRubrics();
  return COMPANY_RUBRIC_KEYS.reduce((acc, key) => {
    acc[key] = suggestions[key] || { code: '', label: '' };
    return acc;
  }, {} as CompanyRubricMap);
}

function normalizeRubricEntry(key: CompanyRubricKey, value: any): CompanyRubricEntry {
  if (value && typeof value === 'object') {
    return {
      code: String(value.code || '').trim(),
      label: String(value.label || '').trim(),
    };
  }
  if (typeof value === 'string') {
    return {
      code: value.trim(),
      label: '',
    };
  }
  return { code: '', label: '' };
}

function normalizeCompanyRubrics(value: any): CompanyRubricMap {
  const raw = value && typeof value === 'object' ? value : {};
  return COMPANY_RUBRIC_KEYS.reduce((acc, key) => {
    acc[key] = normalizeRubricEntry(key, raw[key]);
    return acc;
  }, createEmptyCompanyRubrics());
}

function normalizeCompanyConfig(value: any): CompanyCalculationConfig {
  const raw = value && typeof value === 'object' ? value : {};
  const config: CompanyCalculationConfig = {};
  if (raw.dailyJourney != null && raw.dailyJourney !== '') config.dailyJourney = Number(raw.dailyJourney);
  if (raw.weeklyLimit != null && raw.weeklyLimit !== '') config.weeklyLimit = Number(raw.weeklyLimit);
  if (raw.monthlyLimitHE != null && raw.monthlyLimitHE !== '') config.monthlyLimitHE = Number(raw.monthlyLimitHE);
  if (raw.nightCutoff != null && raw.nightCutoff !== '') config.nightCutoff = String(raw.nightCutoff);
  if (raw.percent50 != null && raw.percent50 !== '') config.percent50 = Number(raw.percent50);
  if (raw.percent100 != null && raw.percent100 !== '') config.percent100 = Number(raw.percent100);
  if (raw.percentNight != null && raw.percentNight !== '') config.percentNight = Number(raw.percentNight);
  if (raw.cycleStartDay != null && raw.cycleStartDay !== '') config.cycleStartDay = clampCycleStartDay(raw.cycleStartDay);
  if (raw.roundingCarryover != null && raw.roundingCarryover !== '') config.roundingCarryover = Number(raw.roundingCarryover);
  if (Array.isArray(raw.overtimeRules)) {
    config.overtimeRules = raw.overtimeRules
      .filter((rule: any) => rule && typeof rule === 'object')
      .map((rule: any, index: number): CompanyOvertimeRule => ({
        id: String(rule.id || `rule-${index + 1}`),
        label: String(rule.label || rule.rubricKey || `Regra ${index + 1}`),
        rubricKey: String(rule.rubricKey || ''),
        multiplier: Number(rule.multiplier || 0),
        period: rule.period === 'day' || rule.period === 'night' || rule.period === 'any' ? rule.period : 'any',
        dayType: rule.dayType === 'weekday' || rule.dayType === 'sunday' || rule.dayType === 'any' ? rule.dayType : 'weekday',
        weeklyLimitMinutes: rule.weeklyLimitMinutes == null || rule.weeklyLimitMinutes === '' ? undefined : Number(rule.weeklyLimitMinutes),
        weeklyLimitGroup: String(rule.weeklyLimitGroup || '').trim() || undefined,
        monthlyLimitMinutes: rule.monthlyLimitMinutes == null || rule.monthlyLimitMinutes === '' ? undefined : Number(rule.monthlyLimitMinutes),
        monthlyLimitGroup: String(rule.monthlyLimitGroup || '').trim() || undefined,
        priority: rule.priority == null || rule.priority === '' ? undefined : Number(rule.priority),
        active: rule.active == null ? true : !!rule.active,
      }))
      .filter((rule) => rule.rubricKey && Number.isFinite(rule.multiplier) && rule.multiplier > 0);
  }
  if (Array.isArray(raw.dailyOvertimeDiscountRules)) {
    config.dailyOvertimeDiscountRules = raw.dailyOvertimeDiscountRules
      .filter((rule: any) => rule && typeof rule === 'object')
      .map((rule: any, index: number): CompanyDailyOvertimeDiscountRule => ({
        id: String(rule.id || `discount-rule-${index + 1}`),
        label: String(rule.label || `Desconto ${index + 1}`),
        rubricKey: String(rule.rubricKey || '').trim(),
        thresholdHours: Number(rule.thresholdHours || 0),
        discountMinutes: Number(rule.discountMinutes || 0),
        priority: rule.priority == null || rule.priority === '' ? undefined : Number(rule.priority),
        active: rule.active == null ? true : !!rule.active,
      }))
      .filter((rule) => rule.rubricKey && rule.thresholdHours > 0 && rule.discountMinutes > 0);
  }
  return config;
}

function sanitizeCompanyRubrics(value: CompanyRubricMap | undefined): CompanyRubricMap {
  return normalizeCompanyRubrics(value);
}

function sanitizeCompanyConfig(value: CompanyCalculationConfig | undefined): CompanyCalculationConfig {
  return normalizeCompanyConfig(value);
}

function ensureSupabase() {
  if (!supabase) throw new Error('Supabase nao configurado.');
  return supabase;
}

async function getCurrentUserId(): Promise<string> {
  const client = ensureSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const sessionUserId = String(sessionData.session?.user?.id || '').trim();
  if (sessionUserId) return sessionUserId;
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const userId = String(data.user?.id || '').trim();
  if (!userId) throw new Error('Usuario nao autenticado.');
  return userId;
}

function clampCycleStartDay(raw: any): number {
  const value = Number(raw || 15);
  return Math.max(1, Math.min(31, Number.isFinite(value) ? value : 15));
}

function normalizeTextValue(value: any): string | null {
  const txt = String(value ?? '').trim();
  return txt === '' ? null : txt;
}

function normalizeCnpj(value: any): string {
  return String(value ?? '').replace(/\D/g, '');
}

function buildDefaultCompanySettings(cnpj: string, name?: string): CompanySettingsProfile {
  const config: CompanyCalculationConfig = {
    dailyJourney: 8,
    weeklyLimit: 3,
    monthlyLimitHE: 900,
    nightCutoff: '22:00',
    percent50: 50,
    percent100: 100,
    percentNight: 25,
    cycleStartDay: 16,
  };
  config.overtimeRules = buildSuggestedOvertimeRules(config);
  config.dailyOvertimeDiscountRules = buildSuggestedDailyOvertimeDiscountRules();
  return {
    cnpj: normalizeCnpj(cnpj),
    name: String(name || '').trim(),
    rubrics: createEmptyCompanyRubrics(),
    config,
  };
}

function companySettingsFromRow(row: any): CompanySettingsProfile | null {
  const cnpj = normalizeCnpj(row?.cnpj);
  if (!cnpj) return null;
  const settingsJson = row?.settings_json && typeof row.settings_json === 'object' ? row.settings_json : {};
  return {
    id: row?.id ? String(row.id) : undefined,
    cnpj,
    name: String(row?.name || '').trim(),
    rubrics: normalizeCompanyRubrics(settingsJson.rubrics),
    config: normalizeCompanyConfig(settingsJson.config),
  };
}

function companySettingsToRow(userId: string, company: CompanySettingsProfile) {
  const normalized = buildDefaultCompanySettings(company.cnpj, company.name);
  const rubrics = sanitizeCompanyRubrics(company.rubrics);
  const config = sanitizeCompanyConfig(company.config);
  return {
    user_id: userId,
    cnpj: normalized.cnpj,
    name: String(company.name || normalized.name || '').trim(),
    settings_json: {
      rubrics,
      config,
    },
  };
}

function normalizeClockValue(value: any): string {
  const txt = String(value ?? '').trim();
  return /^\d{1,2}:\d{2}$/.test(txt) ? txt : '';
}

function getDayNumberFromRow(row: any): number | null {
  const dayRaw = row?.day || String(row?.date || row?.workDate || '').slice(8, 10);
  const dayNum = Number(dayRaw);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return null;
  return dayNum;
}

function normalizeOvernightRows(rows: any[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const cloned = rows.map((row) => ({ ...row }));
  const ordered = cloned
    .map((row) => ({ row, dayNum: getDayNumberFromRow(row) }))
    .filter((item) => item.dayNum !== null)
    .sort((a, b) => (a.dayNum as number) - (b.dayNum as number));

  const pairs: Array<[string, string]> = [
    ['entry1', 'exit1'],
    ['entry2', 'exit2'],
    ['entryExtra', 'exitExtra'],
  ];

  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].row;
    const next = ordered[i + 1].row;
    for (const [startKey, endKey] of pairs) {
      const currentStart = normalizeClockValue(current?.[startKey]);
      const currentEnd = normalizeClockValue(current?.[endKey]);
      const nextStart = normalizeClockValue(next?.[startKey]);
      const nextEnd = normalizeClockValue(next?.[endKey]);
      if (currentStart && !currentEnd && !nextStart && nextEnd) {
        current[endKey] = nextEnd;
        next[endKey] = '';
      }
    }
  }

  return cloned;
}

function timeToMinutes(value: string): number {
  if (!value || !value.includes(':')) return 0;
  const [hh, mm] = value.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function calcEntryTotalMinutes(entry: any): number {
  const periods = [
    [entry?.entry1, entry?.exit1],
    [entry?.entry2, entry?.exit2],
    [entry?.entryExtra, entry?.exitExtra],
  ];
  let total = 0;
  for (const [start, end] of periods) {
    if ((!start || start === '') && (!end || end === '')) continue;
    if (!start || !start.includes(':') || !end || !end.includes(':')) continue;
    let diff = timeToMinutes(end) - timeToMinutes(start);
    if (diff < 0) diff += 24 * 60;
    total += diff;
  }
  return total;
}

function resolveExpectedStartForSettings(settings: Settings, dayOfWeek: number): number {
  const saturdayCompensation = !!settings.saturdayCompensation;
  const raw = dayOfWeek === 6 && !saturdayCompensation
    ? (settings.saturdayWorkStart || settings.workStart || '')
    : (settings.workStart || '');
  return normalizeClockValue(raw) ? timeToMinutes(raw) : 0;
}

function calcDelayMinutes(entry: any, settings: Settings, dayOfWeek: number): number {
  const expectedStart = resolveExpectedStartForSettings(settings, dayOfWeek);
  if (expectedStart <= 0) return 0;
  const firstStart = [entry?.entry1, entry?.entry2, entry?.entryExtra]
    .map((value) => normalizeClockValue(value))
    .find(Boolean);
  if (!firstStart) return 0;
  const toleranceMinutes = 5;
  const actualStart = timeToMinutes(firstStart);
  if (actualStart <= expectedStart + toleranceMinutes) return 0;
  return Math.max(0, actualStart - expectedStart);
}

function minutesToHHMM(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = Math.round(minutes % 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function buildWorkDate(day: number, referenceMonth: number, referenceYear: number, cycleStartDay: number): string {
  let month = referenceMonth;
  let year = referenceYear;
  if (cycleStartDay > 1 && day > cycleStartDay) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isValidIsoCalendarDate(value: string): boolean {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasAnyContent(row: any): boolean {
  const fields = [row?.entry1, row?.exit1, row?.entry2, row?.exit2, row?.entryExtra, row?.exitExtra, row?.totalHours, row?.annotationText, row?.annotation_text];
  return fields.some((value) => String(value ?? '').trim() !== '') || !!row?.isDPAnnotation;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = String(dataUrl || '').match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('Imagem invalida para upload.');
  const mimeType = match[1] || 'image/jpeg';
  const base64 = match[2] || '';
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function inferExtensionFromDataUrl(dataUrl: string): string {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const mimeType = match?.[1] || 'image/jpeg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

function buildImagePath(userId: string, ref: string, key: 'front' | 'back' | 'front-he' | 'back-he', dataUrl: string): string {
  const ext = inferExtensionFromDataUrl(dataUrl);
  return `${userId}/${ref}/${key}.${ext}`;
}

async function uploadCardImage(userId: string, ref: string, key: 'front' | 'back' | 'front-he' | 'back-he', imageDataUrl?: string | null): Promise<string | null> {
  if (!imageDataUrl) return null;
  if (!String(imageDataUrl).startsWith('data:')) {
    return null;
  }
  const client = ensureSupabase();
  const path = buildImagePath(userId, ref, key, imageDataUrl);
  const blob = dataUrlToBlob(imageDataUrl);
  const { error } = await client.storage.from(SUPABASE_CARDS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
  });
  if (error) throw error;
  return path;
}

async function removeCardImage(path?: string | null): Promise<void> {
  if (!path) return;
  const client = ensureSupabase();
  if (String(path).startsWith('http://') || String(path).startsWith('https://') || String(path).startsWith('data:')) return;
  await client.storage.from(SUPABASE_CARDS_BUCKET).remove([path]);
}

async function resolveCardImageUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const txt = String(path);
  if (txt.startsWith('data:') || txt.startsWith('http://') || txt.startsWith('https://')) return txt;
  const client = ensureSupabase();
  const { data, error } = await client.storage.from(SUPABASE_CARDS_BUCKET).createSignedUrl(txt, 60 * 60 * 6);
  if (error) return null;
  return data?.signedUrl || null;
}

function settingsRowFromData(userId: string, settings: Settings) {
  return {
    user_id: userId,
    base_salary: settings.baseSalary ?? 0,
    monthly_hours: settings.monthlyHours ?? 0,
    daily_journey: settings.dailyJourney ?? 0,
    weekly_limit: settings.weeklyLimit ?? 0,
    night_cutoff: settings.nightCutoff ?? '22:00',
    percent_50: settings.percent50 ?? 0,
    percent_100: settings.percent100 ?? 0,
    percent_night: settings.percentNight ?? 25,
    ai_provider: settings.aiProvider ?? 'gemini',
    gemini_api_key: settings.geminiApiKey ?? null,
    gemini_model: settings.geminiModel ?? null,
    openai_api_key: settings.openaiApiKey ?? null,
    openai_model: settings.openaiModel ?? null,
    codex_api_key: settings.codexApiKey ?? null,
    codex_model: settings.codexModel ?? null,
    employee_name: normalizeTextValue(settings.employeeName),
    employee_code: normalizeTextValue(settings.employeeCode),
    role: normalizeTextValue(settings.role),
    location: normalizeTextValue(settings.location),
    company_name: normalizeTextValue(settings.companyName),
    company_cnpj: normalizeTextValue(normalizeCnpj(settings.companyCnpj)),
    card_number: normalizeTextValue(settings.cardNumber),
    dependentes: settings.dependentes ?? 0,
    adiantamento_percent: settings.adiantamentoPercent ?? 40,
    adiantamento_ir: settings.adiantamentoIR ?? 0,
    saturday_compensation: !!settings.saturdayCompensation,
    cycle_start_day: clampCycleStartDay(settings.cycleStartDay),
    comp_days: settings.compDays ?? '1,2,3,4',
    work_start: settings.workStart ?? '12:00',
    lunch_start: settings.lunchStart ?? '17:00',
    lunch_end: settings.lunchEnd ?? '18:00',
    work_end: settings.workEnd ?? '21:00',
    saturday_work_start: settings.saturdayWorkStart ?? '12:00',
    saturday_work_end: settings.saturdayWorkEnd ?? '16:00',
    overtime_discount_enabled: settings.overtimeDiscountEnabled ?? true,
    overtime_discount_threshold_one_hours: settings.overtimeDiscountThresholdOneHours ?? 4,
    overtime_discount_minutes_one: settings.overtimeDiscountMinutesOne ?? 15,
    overtime_discount_threshold_two_hours: settings.overtimeDiscountThresholdTwoHours ?? 6,
    overtime_discount_minutes_two: settings.overtimeDiscountMinutesTwo ?? 60,
  };
}

function settingsFromRow(row: any): Settings {
  return {
    ...DEFAULT_SETTINGS,
    baseSalary: Number(row?.base_salary ?? DEFAULT_SETTINGS.baseSalary),
    monthlyHours: Number(row?.monthly_hours ?? DEFAULT_SETTINGS.monthlyHours),
    dailyJourney: Number(row?.daily_journey ?? DEFAULT_SETTINGS.dailyJourney),
    weeklyLimit: Number(row?.weekly_limit ?? DEFAULT_SETTINGS.weeklyLimit),
    nightCutoff: String(row?.night_cutoff ?? DEFAULT_SETTINGS.nightCutoff),
    percent50: Number(row?.percent_50 ?? DEFAULT_SETTINGS.percent50),
    percent100: Number(row?.percent_100 ?? DEFAULT_SETTINGS.percent100),
    percentNight: Number(row?.percent_night ?? DEFAULT_SETTINGS.percentNight),
    aiProvider: row?.ai_provider ?? DEFAULT_SETTINGS.aiProvider,
    geminiApiKey: row?.gemini_api_key ?? '',
    geminiModel: row?.gemini_model ?? DEFAULT_SETTINGS.geminiModel,
    openaiApiKey: row?.openai_api_key ?? '',
    openaiModel: row?.openai_model ?? '',
    codexApiKey: row?.codex_api_key ?? '',
    codexModel: row?.codex_model ?? '',
    employeeName: row?.employee_name ?? '',
    employeeCode: row?.employee_code ?? '',
    role: row?.role ?? '',
    location: row?.location ?? '',
    companyName: row?.company_name ?? '',
    companyCnpj: row?.company_cnpj ?? '',
    cardNumber: row?.card_number ?? '',
    dependentes: Number(row?.dependentes ?? 0),
    adiantamentoPercent: Number(row?.adiantamento_percent ?? DEFAULT_SETTINGS.adiantamentoPercent),
    adiantamentoIR: Number(row?.adiantamento_ir ?? DEFAULT_SETTINGS.adiantamentoIR),
    saturdayCompensation: !!row?.saturday_compensation,
    cycleStartDay: clampCycleStartDay(row?.cycle_start_day),
    compDays: String(row?.comp_days ?? DEFAULT_SETTINGS.compDays),
    workStart: row?.work_start ?? DEFAULT_SETTINGS.workStart,
    lunchStart: row?.lunch_start ?? DEFAULT_SETTINGS.lunchStart,
    lunchEnd: row?.lunch_end ?? DEFAULT_SETTINGS.lunchEnd,
    workEnd: row?.work_end ?? DEFAULT_SETTINGS.workEnd,
    saturdayWorkStart: row?.saturday_work_start ?? DEFAULT_SETTINGS.saturdayWorkStart,
    saturdayWorkEnd: row?.saturday_work_end ?? DEFAULT_SETTINGS.saturdayWorkEnd,
    overtimeDiscountEnabled: row?.overtime_discount_enabled == null
      ? DEFAULT_SETTINGS.overtimeDiscountEnabled
      : !!row.overtime_discount_enabled,
    overtimeDiscountThresholdOneHours: Number(row?.overtime_discount_threshold_one_hours ?? DEFAULT_SETTINGS.overtimeDiscountThresholdOneHours),
    overtimeDiscountMinutesOne: Number(row?.overtime_discount_minutes_one ?? DEFAULT_SETTINGS.overtimeDiscountMinutesOne),
    overtimeDiscountThresholdTwoHours: Number(row?.overtime_discount_threshold_two_hours ?? DEFAULT_SETTINGS.overtimeDiscountThresholdTwoHours),
    overtimeDiscountMinutesTwo: Number(row?.overtime_discount_minutes_two ?? DEFAULT_SETTINGS.overtimeDiscountMinutesTwo),
    companySettings: null,
  };
}

export async function getCompanyByCnpj(cnpj: string): Promise<CompanySettingsProfile | null> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!normalizedCnpj) return null;
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('companies')
    .select('*')
    .eq('user_id', userId)
    .eq('cnpj', normalizedCnpj)
    .maybeSingle();
  if (error) throw error;
  return companySettingsFromRow(data);
}

async function upsertCompanyForUser(userId: string, cnpj?: string, name?: string, companySettings?: CompanySettingsProfile | null): Promise<CompanySettingsProfile | null> {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (!normalizedCnpj) return null;
  const client = ensureSupabase();
  const base = companySettings && normalizeCnpj(companySettings.cnpj) === normalizedCnpj
    ? companySettings
    : buildDefaultCompanySettings(normalizedCnpj, name);
  const row = companySettingsToRow(userId, {
    ...base,
    cnpj: normalizedCnpj,
    name: String(name || base.name || '').trim(),
  });
  const { data, error } = await client
    .from('companies')
    .upsert(row, { onConflict: 'user_id,cnpj' })
    .select('*')
    .single();
  if (error) throw error;
  return companySettingsFromRow(data);
}

function buildFullReferenceRows(
  entries: any[],
  type: CardType,
  month: number,
  year: number,
  cycleStartDay: number
): any[] {
  const byDate: Record<string, any> = {};
  (entries || []).filter((entry: any) => entry.card_type === type).forEach((entry: any) => {
    byDate[entry.work_date] = entry;
  });

  const output: any[] = [];
  for (let day = 1; day <= 31; day++) {
    const date = buildWorkDate(day, month, year, cycleStartDay);
    const src = byDate[date];
    output.push({
      date,
      day: String(day).padStart(2, '0'),
      entry1: src?.entry1 || '',
      exit1: src?.exit1 || '',
      entry2: src?.entry2 || '',
      exit2: src?.exit2 || '',
      entryExtra: src?.entry_extra || '',
      exitExtra: src?.exit_extra || '',
      totalHours: src?.total_hours || '',
      isDPAnnotation: !!src?.is_dp_annotation,
      annotationText: src?.annotation_text || '',
    });
  }
  return output;
}

async function ensureSettingsRow(userId: string): Promise<Settings> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('app_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    const settings = settingsFromRow(data);
    if (settings.companyCnpj) {
      settings.companySettings = await getCompanyByCnpj(settings.companyCnpj);
    }
    return settings;
  }
  const row = settingsRowFromData(userId, DEFAULT_SETTINGS);
  const { error: insertError } = await client.from('app_settings').upsert(row, { onConflict: 'user_id' });
  if (insertError) throw insertError;
  return { ...DEFAULT_SETTINGS };
}

async function recomputeBancoHorasForReference(referenceId: string, settings: Settings) {
  const client = ensureSupabase();
  await client.from('banco_horas').delete().eq('reference_id', referenceId).in('type', ['extra', 'atraso']);

  const { data: normalRows, error } = await client
    .from('reference_entries')
    .select('work_date, entry1, exit1, entry2, exit2, entry_extra, exit_extra')
    .eq('reference_id', referenceId)
    .eq('card_type', 'normal')
    .order('work_date', { ascending: true });
  if (error) throw error;

  const journeyMinutes = Math.round((settings.dailyJourney || 0) * 60);
  const hasSatComp = !!settings.saturdayCompensation;
  const compDays = String(settings.compDays || '1,2,3,4')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));

  const payload = (normalRows || []).flatMap((row: any) => {
    const dateStr = String(row.work_date || '');
    if (!dateStr) return [];
    const date = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = date.getDay();
    const isSunday = dayOfWeek === 0;
    let currentJourney = journeyMinutes;
    if (hasSatComp) {
      if (compDays.includes(dayOfWeek)) currentJourney += 60;
      else if (dayOfWeek === 6) currentJourney = 0;
    }
    const hasAnyMark = [
      row.entry1,
      row.exit1,
      row.entry2,
      row.exit2,
      row.entry_extra,
      row.exit_extra,
    ].some((value) => !!String(value || '').trim());
    const total = calcEntryTotalMinutes({
      entry1: row.entry1,
      exit1: row.exit1,
      entry2: row.entry2,
      exit2: row.exit2,
      entryExtra: row.entry_extra,
      exitExtra: row.exit_extra,
    });

    if (isSunday && total > 0) {
      return [{
        reference_id: referenceId,
        date: dateStr,
        minutes: total,
        type: 'extra',
        description: 'Domingo - banco de horas',
      }];
    }
    if (total > currentJourney) {
      return [{
        reference_id: referenceId,
        date: dateStr,
        minutes: total - currentJourney,
        type: 'extra',
        description: 'Excedente cartao normal',
      }];
    }
    if (!hasAnyMark && currentJourney > 0) {
      return [{
        reference_id: referenceId,
        date: dateStr,
        minutes: currentJourney,
        type: 'atraso',
        description: 'Falta cartao normal',
      }];
    }
    const delayMinutes = calcDelayMinutes({
      entry1: row.entry1,
      exit1: row.exit1,
      entry2: row.entry2,
      exit2: row.exit2,
      entryExtra: row.entry_extra,
      exitExtra: row.exit_extra,
    }, settings, dayOfWeek);
    if (delayMinutes > 0) {
      return [{
        reference_id: referenceId,
        date: dateStr,
        minutes: delayMinutes,
        type: 'atraso',
        description: 'Atraso cartao normal',
      }];
    }
    return [];
  });

  if (payload.length > 0) {
    const { error: insertError } = await client.from('banco_horas').insert(payload);
    if (insertError) throw insertError;
  }
}

export async function getSettings(): Promise<Settings> {
  const userId = await getCurrentUserId();
  return ensureSettingsRow(userId);
}

export async function saveSettings(settings: Settings): Promise<void> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const companySettings = await upsertCompanyForUser(userId, settings.companyCnpj, settings.companyName, settings.companySettings || null);
  const { error } = await client
    .from('app_settings')
    .upsert(settingsRowFromData(userId, {
      ...settings,
      companyCnpj: normalizeCnpj(settings.companyCnpj),
      companySettings,
    }), { onConflict: 'user_id' });
  if (error) throw error;
}

export async function listHoleriths(): Promise<any[]> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('references')
    .select('id, month, year, employee_name, employee_code, role, location, company_name, company_cnpj, card_number')
    .eq('user_id', userId)
    .order('year', { ascending: false })
    .order('month', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    month: row.month,
    year: row.year,
    employeeName: row.employee_name || '',
    employeeCode: row.employee_code || '',
    role: row.role || '',
    location: row.location || '',
    companyName: row.company_name || '',
    companyCnpj: row.company_cnpj || '',
    cardNumber: row.card_number || '',
  }));
}

export async function getReference(ref: string): Promise<any> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const month = Number(ref.slice(0, 2));
  const year = Number(ref.slice(2));
  const [{ data: reference, error }, settings] = await Promise.all([
    client
      .from('references')
      .select('*')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle(),
    ensureSettingsRow(userId),
  ]);
  if (error) throw error;

  if (!reference) {
    return {
      month: String(month).padStart(2, '0'),
      year,
      hours: [],
      he: [],
      hasNormalCard: false,
      hasOvertimeCard: false,
      frontImage: null,
      backImage: null,
      frontImageHe: null,
      backImageHe: null,
      companySettings: null,
    };
  }

  const companySettings = reference.company_cnpj ? await getCompanyByCnpj(reference.company_cnpj) : null;

  const { data: entries, error: entriesError } = await client
    .from('reference_entries')
    .select('*')
    .eq('reference_id', reference.id)
    .order('work_date', { ascending: true })
    .order('day', { ascending: true });
  if (entriesError) throw entriesError;

  const cycleStartDay = clampCycleStartDay(companySettings?.config.cycleStartDay ?? settings.cycleStartDay);

  const hasNormalRows = (entries || []).some((entry: any) => entry.card_type === 'normal' && hasAnyContent({
    entry1: entry.entry1,
    exit1: entry.exit1,
    entry2: entry.entry2,
    exit2: entry.exit2,
    entryExtra: entry.entry_extra,
    exitExtra: entry.exit_extra,
    totalHours: entry.total_hours,
    isDPAnnotation: entry.is_dp_annotation,
    annotationText: entry.annotation_text,
  }));
  const hasOvertimeRows = (entries || []).some((entry: any) => entry.card_type === 'overtime' && hasAnyContent({
    entry1: entry.entry1,
    exit1: entry.exit1,
    entry2: entry.entry2,
    exit2: entry.exit2,
    entryExtra: entry.entry_extra,
    exitExtra: entry.exit_extra,
    totalHours: entry.total_hours,
    isDPAnnotation: entry.is_dp_annotation,
    annotationText: entry.annotation_text,
  }));

  const hasNormalCard = !!reference.has_normal_card || hasNormalRows || !!reference.front_image || !!reference.back_image;
  const hasOvertimeCard = !!reference.has_overtime_card || hasOvertimeRows || !!reference.front_image_he || !!reference.back_image_he;
  const [frontImageUrl, backImageUrl, frontImageHeUrl, backImageHeUrl] = await Promise.all([
    resolveCardImageUrl(reference.front_image),
    resolveCardImageUrl(reference.back_image),
    resolveCardImageUrl(reference.front_image_he),
    resolveCardImageUrl(reference.back_image_he),
  ]);

  return {
    companyName: reference.company_name || '',
    companyCnpj: reference.company_cnpj || '',
    employeeName: reference.employee_name || '',
    employeeCode: reference.employee_code || '',
    role: reference.role || '',
    location: reference.location || '',
    month: String(month).padStart(2, '0'),
    year,
    cardNumber: reference.card_number || '',
    isOvertimeCard: hasOvertimeCard && !hasNormalCard,
    hasNormalCard,
    hasOvertimeCard,
    frontImage: frontImageUrl,
    backImage: backImageUrl,
    frontImageHe: frontImageHeUrl,
    backImageHe: backImageHeUrl,
    companySettings,
    hours: hasNormalCard ? buildFullReferenceRows(entries || [], 'normal', month, year, cycleStartDay) : [],
    he: hasOvertimeCard ? buildFullReferenceRows(entries || [], 'overtime', month, year, cycleStartDay) : [],
  };
}

export async function saveReference(ref: string, payload: ReferencePayload): Promise<SaveReferenceResult> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const month = Number(ref.slice(0, 2));
  const year = Number(ref.slice(2));
  const [{ data: existingReferenceRow, error: existingReferenceError }, settings] = await Promise.all([
    client
      .from('references')
      .select('*')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle(),
    ensureSettingsRow(userId),
  ]);
  if (existingReferenceError) throw existingReferenceError;
  const companySettings = await upsertCompanyForUser(
    userId,
    payload.companyCnpj || settings.companyCnpj,
    payload.companyName || settings.companyName,
    settings.companySettings || null
  );
  const cycleStartDay = clampCycleStartDay(companySettings?.config.cycleStartDay ?? settings.cycleStartDay);
  const existingEntries = existingReferenceRow
    ? await (async () => {
        const { data, error } = await client
          .from('reference_entries')
          .select('*')
          .eq('reference_id', existingReferenceRow.id)
          .order('work_date', { ascending: true })
          .order('day', { ascending: true });
        if (error) throw error;
        return data || [];
      })()
    : [];
  const existingReference = {
    hours: buildFullReferenceRows(existingEntries, 'normal', month, year, cycleStartDay),
    he: buildFullReferenceRows(existingEntries, 'overtime', month, year, cycleStartDay),
  };

  const resolveImagePath = async (
    key: 'front' | 'back' | 'front-he' | 'back-he',
    nextImage: string | null | undefined,
    existingPath: string | null | undefined
  ): Promise<string | null> => {
    if (nextImage === undefined) return existingPath || null;
    if (!nextImage) return null;
    if (String(nextImage).startsWith('data:')) {
      return await uploadCardImage(userId, ref, key, nextImage);
    }
    return existingPath || null;
  };

  const frontImagePath = await resolveImagePath('front', payload.frontImage, existingReferenceRow?.front_image);
  const backImagePath = await resolveImagePath('back', payload.backImage, existingReferenceRow?.back_image);
  const frontImageHePath = await resolveImagePath('front-he', payload.frontImageHe, existingReferenceRow?.front_image_he);
  const backImageHePath = await resolveImagePath('back-he', payload.backImageHe, existingReferenceRow?.back_image_he);

  const referenceRow = {
    user_id: userId,
    month,
    year,
    company_name: normalizeTextValue(payload.companyName || settings.companyName),
    company_cnpj: normalizeTextValue(normalizeCnpj(payload.companyCnpj || settings.companyCnpj)),
    employee_name: normalizeTextValue(payload.employeeName || settings.employeeName),
    employee_code: normalizeTextValue(payload.employeeCode || settings.employeeCode),
    role: normalizeTextValue(payload.role || settings.role),
    location: normalizeTextValue(payload.location || settings.location),
    card_number: normalizeTextValue(payload.cardNumber || settings.cardNumber),
    front_image: frontImagePath,
    back_image: backImagePath,
    front_image_he: frontImageHePath,
    back_image_he: backImageHePath,
    has_normal_card: Array.isArray(payload.hours) && payload.hours.length > 0,
    has_overtime_card: Array.isArray(payload.he) && payload.he.length > 0,
  };

  const { data: refData, error: refError } = await client
    .from('references')
    .upsert(referenceRow, { onConflict: 'user_id,month,year' })
    .select('id')
    .single();
  if (refError) throw refError;

  const referenceId = String(refData.id);
  let skippedInvalidDates = 0;
  const persistType = async (type: CardType, rows: any[]) => {
    const normalizedRows = normalizeOvernightRows(rows || []);
    const existingRows = type === 'normal' ? (existingReference.hours || []) : (existingReference.he || []);
    const existingByDate = new Map<string, any>();
    existingRows.forEach((row: any) => existingByDate.set(String(row.date), row));

    const mergedByDate = new Map<string, any>();
    for (let day = 1; day <= 31; day++) {
      const date = buildWorkDate(day, month, year, cycleStartDay);
      mergedByDate.set(date, { ...(existingByDate.get(date) || {}), date, day: String(day).padStart(2, '0') });
    }

    normalizedRows.forEach((row: any) => {
      const dayNum = getDayNumberFromRow(row);
      if (!dayNum) return;
      const date = buildWorkDate(dayNum, month, year, cycleStartDay);
      const existing = mergedByDate.get(date) || { date, day: String(dayNum).padStart(2, '0') };
      const pick = (incoming: any, current: any) => {
        const normalized = normalizeTextValue(incoming);
        return normalized !== null ? normalized : normalizeTextValue(current);
      };
      const next = {
        ...existing,
        date,
        day: String(dayNum).padStart(2, '0'),
        entry1: pick(row.entry1, existing.entry1) || '',
        exit1: pick(row.exit1, existing.exit1) || '',
        entry2: pick(row.entry2, existing.entry2) || '',
        exit2: pick(row.exit2, existing.exit2) || '',
        entryExtra: pick(row.entryExtra, existing.entryExtra) || '',
        exitExtra: pick(row.exitExtra, existing.exitExtra) || '',
        totalHours: '',
        isDPAnnotation: typeof row?.isDPAnnotation === 'boolean' ? row.isDPAnnotation : !!existing.isDPAnnotation,
        annotationText: pick(row.annotationText, existing.annotationText) || '',
      };
      const totalMinutes = calcEntryTotalMinutes(next);
      next.totalHours = totalMinutes > 0 ? minutesToHHMM(totalMinutes) : '';
      mergedByDate.set(date, next);
    });

    await client.from('reference_entries').delete().eq('reference_id', referenceId).eq('card_type', type);

    const insertPayload = Array.from(mergedByDate.values()).flatMap((row: any) => {
      if (!isValidIsoCalendarDate(row.date)) {
        skippedInvalidDates += 1;
        return [];
      }
      return [{
        reference_id: referenceId,
        card_type: type,
        work_date: row.date,
        day: row.day,
        entry1: row.entry1 || null,
        exit1: row.exit1 || null,
        entry2: row.entry2 || null,
        exit2: row.exit2 || null,
        entry_extra: row.entryExtra || null,
        exit_extra: row.exitExtra || null,
        total_hours: row.totalHours || null,
        is_dp_annotation: !!row.isDPAnnotation,
        annotation_text: row.annotationText || null,
      }];
    });

    if (insertPayload.length > 0) {
      const { error: insertError } = await client.from('reference_entries').insert(insertPayload);
      if (insertError) throw insertError;
    }
  };

  if (Array.isArray(payload.hours) && payload.hours.length > 0) {
    await persistType('normal', payload.hours);
    await recomputeBancoHorasForReference(referenceId, settings);
  }
  if (Array.isArray(payload.he) && payload.he.length > 0) {
    await persistType('overtime', payload.he);
  }

  const nextSettings: Settings = {
    ...settings,
    employeeName: payload.employeeName || settings.employeeName,
    employeeCode: payload.employeeCode || settings.employeeCode,
    role: payload.role || settings.role,
    location: payload.location || settings.location,
    companyName: payload.companyName || settings.companyName,
    companyCnpj: normalizeCnpj(payload.companyCnpj || settings.companyCnpj),
    cardNumber: payload.cardNumber || settings.cardNumber,
    companySettings,
  };
  await saveSettings(nextSettings);
  return { skippedInvalidDates };
}

export async function deleteReference(ref: string, type: 'normal' | 'overtime' | 'all' = 'all'): Promise<{ success: true; count: number }> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const month = Number(ref.slice(0, 2));
  const year = Number(ref.slice(2));

  const { data: reference, error } = await client
    .from('references')
    .select('id')
    .eq('user_id', userId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();
  if (error) throw error;
  if (!reference?.id) return { success: true, count: 0 };

  const referenceId = String(reference.id);
  if (type === 'normal' || type === 'overtime') {
    const { data: currentRow } = await client.from('references').select('*').eq('id', referenceId).single();
    const { error: deleteEntriesError } = await client
      .from('reference_entries')
      .delete()
      .eq('reference_id', referenceId)
      .eq('card_type', type);
    if (deleteEntriesError) throw deleteEntriesError;

    const patch: any = type === 'normal'
      ? { has_normal_card: false, front_image: null, back_image: null }
      : { has_overtime_card: false, front_image_he: null, back_image_he: null };
    const { error: updateError } = await client.from('references').update(patch).eq('id', referenceId);
    if (updateError) throw updateError;
    if (type === 'normal') {
      await removeCardImage(currentRow?.front_image);
      await removeCardImage(currentRow?.back_image);
    } else {
      await removeCardImage(currentRow?.front_image_he);
      await removeCardImage(currentRow?.back_image_he);
    }

    if (type === 'normal') {
      await client.from('banco_horas').delete().eq('reference_id', referenceId).in('type', ['extra', 'atraso']);
    }

    const { count } = await client
      .from('reference_entries')
      .select('*', { count: 'exact', head: true })
      .eq('reference_id', referenceId);
    if (!count) {
      await client.from('banco_horas').delete().eq('reference_id', referenceId);
      await client.from('references').delete().eq('id', referenceId);
    }

    return { success: true, count: 1 };
  }

  const { data: currentRow } = await client.from('references').select('*').eq('id', referenceId).single();
  await client.from('banco_horas').delete().eq('reference_id', referenceId);
  await client.from('reference_entries').delete().eq('reference_id', referenceId);
  await client.from('simulator_plans').delete().eq('reference', ref);
  await client.from('references').delete().eq('id', referenceId);
  await removeCardImage(currentRow?.front_image);
  await removeCardImage(currentRow?.back_image);
  await removeCardImage(currentRow?.front_image_he);
  await removeCardImage(currentRow?.back_image_he);
  return { success: true, count: 1 };
}

export async function clearReferences(): Promise<{ success: true; count: number }> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { data: refs, error } = await client.from('references').select('id, front_image, back_image, front_image_he, back_image_he');
  if (error) throw error;
  const refIds = (refs || []).map((row: any) => row.id);
  if (refIds.length > 0) {
    await client.from('banco_horas').delete().in('reference_id', refIds);
    await client.from('reference_entries').delete().in('reference_id', refIds);
  }
  await client.from('references').delete().eq('user_id', userId);
  await client.from('simulator_plans').delete().eq('user_id', userId);
  for (const row of refs || []) {
    await removeCardImage(row.front_image);
    await removeCardImage(row.back_image);
    await removeCardImage(row.front_image_he);
    await removeCardImage(row.back_image_he);
  }
  return { success: true, count: refIds.length };
}

export async function getSimulatorPlan(reference: string): Promise<{ plan: any | null; updatedAt: string | null }> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('simulator_plans')
    .select('payload, updated_at, created_at')
    .eq('user_id', userId)
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  return {
    plan: data?.payload || null,
    updatedAt: data?.updated_at || data?.created_at || null,
  };
}

export async function saveSimulatorPlan(reference: string, payload: any): Promise<void> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { error } = await client
    .from('simulator_plans')
    .upsert({
      user_id: userId,
      reference,
      payload,
    }, { onConflict: 'user_id,reference' });
  if (error) throw error;
}

export async function listBancoHoras(): Promise<any[]> {
  const client = ensureSupabase();
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('banco_horas')
    .select('id, reference_id, date, minutes, type, description, references!inner(month, year)')
    .eq('references.user_id', userId)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    holerith_id: row.reference_id,
    date: row.date,
    minutes: row.minutes,
    type: row.type,
    description: row.description,
    month: row.references?.month,
    year: row.references?.year,
  }));
}

export async function addBancoHoras(entry: { holerith_id: string; date: string; minutes: number; type?: string; description?: string }): Promise<{ id: string }> {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('banco_horas')
    .insert({
      reference_id: entry.holerith_id,
      date: entry.date,
      minutes: entry.minutes,
      type: entry.type || 'extra',
      description: entry.description || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: String(data.id) };
}

export async function deleteBancoHoras(id: string): Promise<{ success: true; count: number }> {
  const client = ensureSupabase();
  const { error } = await client.from('banco_horas').delete().eq('id', id);
  if (error) throw error;
  return { success: true, count: 1 };
}
