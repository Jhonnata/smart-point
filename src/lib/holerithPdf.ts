import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface ParsedHolerithPdfData {
  rawText: string;
  normalizedText: string;
  competenceMonth?: number;
  competenceYear?: number;
  employeeName?: string;
  he50Minutes: number;
  he75Minutes: number;
  he100Minutes: number;
  he125Minutes: number;
  atrasoMinutes: number;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .toUpperCase();
}

function parseHourTokenToMinutes(token: string): number | null {
  const txt = (token || '').trim();
  if (!txt) return null;
  if (/^\d{1,3}:\d{2}$/.test(txt)) {
    const [hh, mm] = txt.split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return Math.max(0, hh * 60 + mm);
  }

  const normalized = txt.replace(/\./g, '').replace(',', '.');
  const hours = Number(normalized);
  if (!Number.isFinite(hours)) return null;
  return Math.max(0, Math.round(hours * 60));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMinutesByLabels(
  normalizedText: string,
  labels: string[]
): number {
  const hourToken = '(\\d{1,3}:\\d{2}|\\d{1,3}(?:[.,]\\d{1,2}))';
  const moneyToken = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';

  for (const label of labels) {
    const escapedLabel = escapeRegExp(label);

    // Caso comum de holerith (valor + horas + descrição), inclusive quando sem espaços:
    // ex.: "189,233,00HORA EXTRA 50%"
    const beforeLabelRx = new RegExp(`${moneyToken}\\s*${hourToken}\\s*${escapedLabel}`);
    const beforeMatch = normalizedText.match(beforeLabelRx);
    if (beforeMatch?.[2]) {
      const parsed = parseHourTokenToMinutes(beforeMatch[2]);
      if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    }

    // Caso alternativo (descrição + horas + valor)
    const afterLabelRx = new RegExp(`${escapedLabel}\\s*${hourToken}\\s*${moneyToken}`);
    const afterMatch = normalizedText.match(afterLabelRx);
    if (afterMatch?.[1]) {
      const parsed = parseHourTokenToMinutes(afterMatch[1]);
      if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    }

    // Fallback para layouts não previstos (mantém compatibilidade)
    const index = normalizedText.indexOf(label);
    if (index < 0) continue;
    const tail = normalizedText.slice(index + label.length, index + label.length + 120);
    const tokens = tail.match(/\d{1,3}:\d{2}|\d{1,3}(?:[.,]\d{1,2})/g) || [];
    for (const token of tokens) {
      const parsed = parseHourTokenToMinutes(token);
      if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function extractCompetence(normalizedText: string): {
  month?: number;
  year?: number;
} {
  const monthYearByLabel = normalizedText.match(/MES\s*\/\s*ANO[^0-9]{0,20}(0[1-9]|1[0-2])\s*\/\s*(20\d{2})/);
  if (monthYearByLabel) {
    return {
      month: Number(monthYearByLabel[1]),
      year: Number(monthYearByLabel[2]),
    };
  }

  const directMonthYear = normalizedText.match(/\b(0[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/);
  if (directMonthYear) {
    return {
      month: Number(directMonthYear[1]),
      year: Number(directMonthYear[2]),
    };
  }

  const monthNameRx = new RegExp(`\\b(${Object.keys(MONTH_NAME_TO_NUMBER).join('|')})\\b\\s*\\/?\\s*(20\\d{2})`);
  const monthByName = normalizedText.match(monthNameRx);
  if (monthByName) {
    return {
      month: MONTH_NAME_TO_NUMBER[monthByName[1]],
      year: Number(monthByName[2]),
    };
  }

  return {};
}

function extractEmployeeName(rawText: string): string | undefined {
  const match = rawText.match(/NOME\s*[:\-]\s*([^\n\r]+)/i);
  if (!match) return undefined;
  const name = (match[1] || '').trim();
  return name || undefined;
}

export async function parseHolerithPdf(buffer: ArrayBuffer): Promise<ParsedHolerithPdfData> {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  let rawText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    rawText += `\n${text}`;
  }

  const normalizedText = normalizeText(rawText);
  const { month, year } = extractCompetence(normalizedText);

  const he50Minutes = extractMinutesByLabels(normalizedText, ['HORA EXTRA 50']);
  const he75Minutes = extractMinutesByLabels(normalizedText, ['HORA EXTRA 75']);
  const he100Minutes = extractMinutesByLabels(normalizedText, ['HORA EXTRA 100']);
  const he125Minutes = extractMinutesByLabels(normalizedText, ['HORA EXTRA 125']);
  const atrasoMinutes = extractMinutesByLabels(normalizedText, [
    'DESCONTO DE ATRASO',
    'DESCONTO ATRASO',
    'ATRASO',
    'FALTA'
  ]);

  return {
    rawText,
    normalizedText,
    competenceMonth: month,
    competenceYear: year,
    employeeName: extractEmployeeName(rawText),
    he50Minutes,
    he75Minutes,
    he100Minutes,
    he125Minutes,
    atrasoMinutes,
  };
}
