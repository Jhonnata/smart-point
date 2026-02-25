import React, { useRef, useState } from 'react';
import { Camera, Upload, Trash2, CheckCircle2, Loader2, Clock, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { parsePontoImage, type TimeEntry, type PontoData } from '../services/aiService';
import { minutesToTime, type Settings } from '../lib/calculations';
import { cn } from '../lib/utils';
import { buildProjectedCardFromHolerith, type ProjectedCardFromHolerith } from '../lib/holerithProjection';
import type { ParsedHolerithPdfData } from '../lib/holerithPdf';

export type UploadUpdateMode = 'merge' | 'replace';
type UploadTab = 'digitalizar' | 'manual';

interface Props {
  onProcessed: (
    entries: TimeEntry[],
    metadata: Partial<PontoData>,
    options?: { updateMode: UploadUpdateMode }
  ) => void;
  onCreateManual?: (options: {
    month: string;
    isOvertimeCard: boolean;
    updateMode: UploadUpdateMode;
  }) => void;
  onCreateFromHolerith?: (options: {
    month: string;
    updateMode: UploadUpdateMode;
    parsed: ParsedHolerithPdfData;
    projected: ProjectedCardFromHolerith;
  }) => void;
  onSaveProjectedFromHolerith?: (options: {
    month: string;
    updateMode: UploadUpdateMode;
    parsed: ParsedHolerithPdfData;
    projected: ProjectedCardFromHolerith;
  }) => Promise<void> | void;
  settings: Settings;
  availableMonths?: string[];
  existingEntries?: TimeEntry[];
  initialMonth?: string;
  initialIsOvertimeCard?: boolean;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const HOLERITH_DRAFT_VERSION = 1;

interface HolerithPreviewState {
  month: string;
  parsed: ParsedHolerithPdfData;
  projected: ProjectedCardFromHolerith;
}

interface HolerithDraftPayload {
  version: number;
  month: string;
  parsed: {
    competenceMonth?: number;
    competenceYear?: number;
    employeeName?: string;
    he50Minutes: number;
    he75Minutes: number;
    he100Minutes: number;
    he125Minutes: number;
    atrasoMinutes: number;
  };
  projected: ProjectedCardFromHolerith;
}

function draftKeyForMonth(month: string): string {
  return `smart-point:holerith-draft:${month}`;
}

function toParsedStorage(parsed: ParsedHolerithPdfData): HolerithDraftPayload['parsed'] {
  return {
    competenceMonth: parsed.competenceMonth,
    competenceYear: parsed.competenceYear,
    employeeName: parsed.employeeName,
    he50Minutes: parsed.he50Minutes,
    he75Minutes: parsed.he75Minutes,
    he100Minutes: parsed.he100Minutes,
    he125Minutes: parsed.he125Minutes,
    atrasoMinutes: parsed.atrasoMinutes
  };
}

function fromParsedStorage(parsed: HolerithDraftPayload['parsed']): ParsedHolerithPdfData {
  return {
    rawText: '',
    normalizedText: '',
    competenceMonth: parsed.competenceMonth,
    competenceYear: parsed.competenceYear,
    employeeName: parsed.employeeName,
    he50Minutes: parsed.he50Minutes || 0,
    he75Minutes: parsed.he75Minutes || 0,
    he100Minutes: parsed.he100Minutes || 0,
    he125Minutes: parsed.he125Minutes || 0,
    atrasoMinutes: parsed.atrasoMinutes || 0
  };
}

export default function UploadView({
  onProcessed,
  onCreateManual,
  onCreateFromHolerith,
  onSaveProjectedFromHolerith,
  settings,
  availableMonths = [],
  existingEntries = [],
  initialMonth = '',
  initialIsOvertimeCard = false
}: Props) {
  const currentMonthKey = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [activeTab, setActiveTab] = useState<UploadTab>('digitalizar');
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraSide, setCameraSide] = useState<'front' | 'back'>('front');
  const [selectedExistingMonth, setSelectedExistingMonth] = useState<string>(initialMonth);
  const [manualReferenceMonth, setManualReferenceMonth] = useState<string>(initialMonth || '');
  const [manualYear, setManualYear] = useState<number>(() => Number((initialMonth || currentMonthKey).slice(0, 4)));
  const [manualMonthError, setManualMonthError] = useState<string>('');
  const [manualHolerithError, setManualHolerithError] = useState<string>('');
  const [isOvertimeCard, setIsOvertimeCard] = useState(initialIsOvertimeCard);
  const [updateMode, setUpdateMode] = useState<UploadUpdateMode>('merge');
  const [activeUploadSide, setActiveUploadSide] = useState<'front' | 'back'>('front');
  const [holerithFile, setHolerithFile] = useState<File | null>(null);
  const [holerithSummary, setHolerithSummary] = useState<string>('');
  const [isBuildingFromHolerith, setIsBuildingFromHolerith] = useState(false);
  const [holerithPreview, setHolerithPreview] = useState<HolerithPreviewState | null>(null);
  const [isSavingPredicted, setIsSavingPredicted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const holerithInputRef = useRef<HTMLInputElement>(null);

  const getCompetenciaPeriodHint = React.useCallback((monthKey: string) => {
    if (!monthKey) return '';
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return '';

    const c = Math.max(1, Math.min(31, Number(settings.cycleStartDay || 15)));
    if (c <= 1) return `Competencia ${monthStr}/${year}: 01/${monthStr}/${year} a 31/${monthStr}/${year}`;

    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevMonthStr = prevMonth.toString().padStart(2, '0');
    const startDay = Math.min(c + 1, 31).toString().padStart(2, '0');
    const endDay = c.toString().padStart(2, '0');
    return `Competencia ${monthStr}/${year}: ${startDay}/${prevMonthStr}/${prevYear} a ${endDay}/${monthStr}/${year}`;
  }, [settings.cycleStartDay]);

  const digitalCompetenciaHint = React.useMemo(
    () => getCompetenciaPeriodHint(selectedExistingMonth),
    [getCompetenciaPeriodHint, selectedExistingMonth]
  );

  const manualCompetenciaHint = React.useMemo(
    () => getCompetenciaPeriodHint(manualReferenceMonth),
    [getCompetenciaPeriodHint, manualReferenceMonth]
  );

  const yearOptions = React.useMemo(() => {
    const years = new Set<number>();
    const currentYear = Number(currentMonthKey.slice(0, 4));
    years.add(currentYear - 1);
    years.add(currentYear);
    years.add(currentYear + 1);
    availableMonths.forEach((m) => {
      const y = Number(m.slice(0, 4));
      if (Number.isFinite(y)) years.add(y);
    });
    if (Number.isFinite(manualYear)) years.add(manualYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [availableMonths, currentMonthKey, manualYear]);

  const handleSelectManualMonth = (monthNumber: number) => {
    const monthKey = `${manualYear}-${String(monthNumber).padStart(2, '0')}`;
    setManualReferenceMonth(monthKey);
    setManualMonthError('');
    setManualHolerithError('');
    setHolerithPreview(null);
  };

  const toggleCardType = (overtime: boolean) => {
    setIsOvertimeCard(overtime);
  };

  React.useEffect(() => {
    if (!selectedExistingMonth) {
      setFrontImage(null);
      setBackImage(null);
      return;
    }

    const [selYear, selMonth] = selectedExistingMonth.split('-');
    const monthEntries = existingEntries.filter((e) => {
      const hMonth = (e as any).holerithMonth;
      const hYear = (e as any).holerithYear;
      const sameMonth = hMonth && hYear
        ? hMonth === selMonth && Number(hYear) === Number(selYear)
        : !!e.date && e.date.startsWith(selectedExistingMonth);
      return sameMonth && !!e.isOvertimeCard === isOvertimeCard;
    });

    if (monthEntries.length > 0) {
      setFrontImage(monthEntries[0].frontImage || null);
      setBackImage(monthEntries[0].backImage || null);
    } else {
      setFrontImage(null);
      setBackImage(null);
    }
  }, [selectedExistingMonth, existingEntries, isOvertimeCard]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (activeUploadSide === 'front') setFrontImage(reader.result as string);
      else setBackImage(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const triggerUpload = (side: 'front' | 'back') => {
    setActiveUploadSide(side);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const startCamera = async (side: 'front' | 'back') => {
    setCameraSide(side);
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast.error('Erro ao acessar camera');
      setIsCameraOpen(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvasRef.current.toDataURL('image/jpeg');
    if (cameraSide === 'front') setFrontImage(dataUrl);
    else setBackImage(dataUrl);

    const stream = videoRef.current.srcObject as MediaStream;
    stream?.getTracks().forEach((track) => track.stop());
    setIsCameraOpen(false);
  };

  const processImages = async () => {
    if (!frontImage && !backImage) return;
    setIsProcessing(true);
    try {
      const imagesToProcess = [frontImage, backImage].filter(Boolean) as string[];
      const data = await parsePontoImage(imagesToProcess, settings, isOvertimeCard);
      if (!data || !Array.isArray(data.entries)) {
        throw new Error('Nenhum dado extraido do cartao.');
      }
      const { entries, ...metadata } = data;
      onProcessed(
        entries,
        {
          ...metadata,
          frontImage: frontImage || undefined,
          backImage: backImage || undefined
        },
        { updateMode }
      );
    } catch (err: any) {
      console.error('Error processing images', err);
      toast.error(err.message || 'Erro ao processar imagens. Verifique a qualidade da foto.');
    } finally {
      setIsProcessing(false);
    }
  };

  const createManualCard = () => {
    const month = manualReferenceMonth.trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const message = 'Selecione a competencia antes de criar o lancamento manual.';
      setManualMonthError(message);
      toast.error(message);
      return;
    }

    if (holerithPreview && holerithPreview.month === month) {
      openProjectedCard();
      return;
    }

    setManualMonthError('');
    onCreateManual?.({
      month,
      isOvertimeCard,
      updateMode
    });
  };

  const createFromHolerith = async () => {
    const month = manualReferenceMonth.trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const message = 'Selecione a competencia antes de projetar pelo holerith.';
      setManualMonthError(message);
      toast.error(message);
      return;
    }
    if (!holerithFile) {
      const message = 'Selecione o arquivo PDF do holerith para gerar a projecao.';
      setManualHolerithError(message);
      toast.error(message);
      return;
    }

    setManualMonthError('');
    setManualHolerithError('');
    setIsBuildingFromHolerith(true);
    try {
      const buffer = await holerithFile.arrayBuffer();
      const { parseHolerithPdf } = await import('../lib/holerithPdf');
      const parsed = await parseHolerithPdf(buffer);
      const projected = buildProjectedCardFromHolerith({
        referenceMonth: month,
        settings,
        parsed
      });

      const totalParsedMinutes =
        parsed.he50Minutes +
        parsed.he75Minutes +
        parsed.he100Minutes +
        parsed.he125Minutes +
        parsed.atrasoMinutes;
      if (totalParsedMinutes <= 0) {
        throw new Error('Nao foi possivel identificar horas do holerith no PDF informado.');
      }

      setHolerithPreview({ month, parsed, projected });

      setHolerithSummary(
        `HE50 ${minutesToTime(parsed.he50Minutes)} | HE75 ${minutesToTime(parsed.he75Minutes)} | ` +
        `HE100 ${minutesToTime(parsed.he100Minutes)} | HE125 ${minutesToTime(parsed.he125Minutes)} | ` +
        `Atraso ${minutesToTime(parsed.atrasoMinutes)}`
      );
      toast.success('Previa do cartao projetado gerada. Revise antes de abrir.');
    } catch (err: any) {
      console.error('Error projecting from holerith PDF', err);
      const message = err?.message || 'Falha ao interpretar o PDF do holerith.';
      setManualHolerithError(message);
      toast.error(message);
    } finally {
      setIsBuildingFromHolerith(false);
    }
  };

  const openProjectedCard = () => {
    if (!holerithPreview) {
      toast.error('Gere ou carregue uma previa antes de abrir o cartao.');
      return;
    }
    onCreateFromHolerith?.({
      month: holerithPreview.month,
      updateMode,
      parsed: holerithPreview.parsed,
      projected: holerithPreview.projected
    });
    toast.success('Cartao projetado aberto. Clique em salvar no cartao para persistir os dias.');
  };

  const saveHolerithDraft = () => {
    if (!holerithPreview) {
      toast.error('Gere uma previa para salvar rascunho.');
      return;
    }
    const payload: HolerithDraftPayload = {
      version: HOLERITH_DRAFT_VERSION,
      month: holerithPreview.month,
      parsed: toParsedStorage(holerithPreview.parsed),
      projected: holerithPreview.projected
    };
    localStorage.setItem(draftKeyForMonth(holerithPreview.month), JSON.stringify(payload));
    toast.success(`Rascunho salvo para ${holerithPreview.month}.`);
  };

  const loadHolerithDraft = () => {
    const month = manualReferenceMonth.trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      toast.error('Selecione a competencia para carregar o rascunho.');
      return;
    }
    const raw = localStorage.getItem(draftKeyForMonth(month));
    if (!raw) {
      toast.error(`Nenhum rascunho encontrado para ${month}.`);
      return;
    }
    try {
      const payload = JSON.parse(raw) as HolerithDraftPayload;
      if (!payload || payload.version !== HOLERITH_DRAFT_VERSION) {
        throw new Error('Versao de rascunho invalida.');
      }
      const parsed = fromParsedStorage(payload.parsed);
      setHolerithPreview({
        month: payload.month,
        parsed,
        projected: payload.projected
      });
      setHolerithSummary(
        `HE50 ${minutesToTime(parsed.he50Minutes)} | HE75 ${minutesToTime(parsed.he75Minutes)} | ` +
        `HE100 ${minutesToTime(parsed.he100Minutes)} | HE125 ${minutesToTime(parsed.he125Minutes)} | ` +
        `Atraso ${minutesToTime(parsed.atrasoMinutes)}`
      );
      setManualHolerithError('');
      toast.success(`Rascunho carregado para ${month}.`);
    } catch (err: any) {
      console.error('Error loading holerith draft', err);
      toast.error(err?.message || 'Falha ao carregar rascunho.');
    }
  };

  const saveProjectedCard = async () => {
    if (!holerithPreview) {
      toast.error('Gere ou carregue uma previa antes de salvar.');
      return;
    }
    if (!onSaveProjectedFromHolerith) {
      toast.error('Fluxo de salvamento da predição indisponivel.');
      return;
    }
    setIsSavingPredicted(true);
    try {
      await onSaveProjectedFromHolerith({
        month: holerithPreview.month,
        updateMode,
        parsed: holerithPreview.parsed,
        projected: holerithPreview.projected
      });
      toast.success('Predicao salva no banco com sucesso.');
    } catch (err: any) {
      console.error('Error saving projected card', err);
      toast.error(err?.message || 'Falha ao salvar predição.');
    } finally {
      setIsSavingPredicted(false);
    }
  };

  const previewParsedTotalMinutes = holerithPreview
    ? holerithPreview.parsed.he50Minutes +
      holerithPreview.parsed.he75Minutes +
      holerithPreview.parsed.he100Minutes +
      holerithPreview.parsed.he125Minutes +
      holerithPreview.parsed.atrasoMinutes
    : 0;

  const previewAppliedTotalMinutes = holerithPreview
    ? holerithPreview.projected.summary.he50MinutesApplied +
      holerithPreview.projected.summary.he75MinutesApplied +
      holerithPreview.projected.summary.he100MinutesApplied +
      holerithPreview.projected.summary.he125MinutesApplied +
      holerithPreview.projected.summary.atrasoMinutesApplied
    : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-zinc-900">Novo Lancamento</h2>
        <p className="text-zinc-500">Escolha como deseja iniciar: digitalizar ou criar manualmente.</p>
      </div>

      <div className="bg-white p-2 rounded-2xl border border-zinc-100 flex gap-2">
        <button
          onClick={() => setActiveTab('digitalizar')}
          className={cn(
            'flex-1 py-3 rounded-xl font-bold text-sm transition-all border',
            activeTab === 'digitalizar'
              ? 'bg-zinc-900 border-zinc-900 text-white'
              : 'bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100'
          )}
        >
          Digitalizar cartao
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={cn(
            'flex-1 py-3 rounded-xl font-bold text-sm transition-all border',
            activeTab === 'manual'
              ? 'bg-zinc-900 border-zinc-900 text-white'
              : 'bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100'
          )}
        >
          Cartao manual
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-zinc-100 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest block">Tipo do Cartao</label>
          <div className="flex gap-2">
            <button
              onClick={() => toggleCardType(false)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-xs transition-all border',
                !isOvertimeCard
                  ? 'bg-zinc-900 border-zinc-900 text-white'
                  : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100'
              )}
            >
              Cartao Normal
            </button>
            <button
              onClick={() => toggleCardType(true)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-xs transition-all border',
                isOvertimeCard
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100'
              )}
            >
              <Clock className="w-4 h-4" />
              Horas Extras
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest block">Modo de Atualizacao</label>
          <div className="flex gap-2">
            <button
              onClick={() => setUpdateMode('merge')}
              className={cn(
                'flex-1 py-2.5 rounded-lg font-bold text-xs transition-all border',
                updateMode === 'merge'
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100'
              )}
            >
              Mesclar (Recomendado)
            </button>
            <button
              onClick={() => setUpdateMode('replace')}
              className={cn(
                'flex-1 py-2.5 rounded-lg font-bold text-xs transition-all border',
                updateMode === 'replace'
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100'
              )}
            >
              Substituir Este Cartao
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'digitalizar' && (
        <>
          {availableMonths.length > 0 && (
            <div className="bg-white p-6 rounded-3xl border border-zinc-100">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-2">Atualizar cartao existente?</label>
              <select
                value={selectedExistingMonth}
                onChange={(e) => setSelectedExistingMonth(e.target.value)}
                className="w-full bg-zinc-50 border-none rounded-xl font-bold text-sm focus:ring-2 focus:ring-zinc-900"
              >
                <option value="">-- Novo Cartao --</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {digitalCompetenciaHint && (
                <p className="mt-2 text-[11px] text-zinc-500 font-medium">{digitalCompetenciaHint}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="font-bold text-zinc-700 flex items-center gap-2">
                <span className="w-6 h-6 bg-zinc-900 text-white rounded-full flex items-center justify-center text-xs">1</span>
                Frente (Dias 1-15)
              </h3>
              <div className={cn(
                'aspect-[3/4] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-all relative overflow-hidden',
                frontImage ? 'border-emerald-500 bg-emerald-50/10' : 'border-zinc-200 bg-white'
              )}>
                {frontImage ? (
                  <>
                    <img src={frontImage} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="Frente" />
                    <div className="relative z-10 flex flex-col items-center">
                      <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-2" />
                      <span className="text-sm font-bold text-emerald-700">Imagem Capturada</span>
                      <button onClick={() => setFrontImage(null)} className="mt-4 p-2 bg-white rounded-full shadow-sm text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex gap-2">
                      <button onClick={() => startCamera('front')} className="p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-all">
                        <Camera className="w-6 h-6 text-zinc-600" />
                      </button>
                      <button onClick={() => triggerUpload('front')} className="p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-all">
                        <Upload className="w-6 h-6 text-zinc-600" />
                      </button>
                    </div>
                    <span className="text-sm text-zinc-400">Tire uma foto ou faca upload</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-zinc-700 flex items-center gap-2">
                <span className="w-6 h-6 bg-zinc-900 text-white rounded-full flex items-center justify-center text-xs">2</span>
                Verso (Dias 16-31)
              </h3>
              <div className={cn(
                'aspect-[3/4] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-all relative overflow-hidden',
                backImage ? 'border-emerald-500 bg-emerald-50/10' : 'border-zinc-200 bg-white'
              )}>
                {backImage ? (
                  <>
                    <img src={backImage} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="Verso" />
                    <div className="relative z-10 flex flex-col items-center">
                      <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-2" />
                      <span className="text-sm font-bold text-emerald-700">Imagem Capturada</span>
                      <button onClick={() => setBackImage(null)} className="mt-4 p-2 bg-white rounded-full shadow-sm text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex gap-2">
                      <button onClick={() => startCamera('back')} className="p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-all">
                        <Camera className="w-6 h-6 text-zinc-600" />
                      </button>
                      <button onClick={() => triggerUpload('back')} className="p-4 bg-zinc-100 rounded-2xl hover:bg-zinc-200 transition-all">
                        <Upload className="w-6 h-6 text-zinc-600" />
                      </button>
                    </div>
                    <span className="text-sm text-zinc-400">Tire uma foto ou faca upload</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />

          <button
            disabled={(!frontImage && !backImage) || isProcessing}
            onClick={processImages}
            className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-200"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Processando com IA...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-6 h-6" />
                Analisar Cartao de Ponto
              </>
            )}
          </button>
        </>
      )}

      {activeTab === 'manual' && (
        <>
          <div className="bg-white p-6 rounded-3xl border border-zinc-100 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-zinc-500" />
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Competencia de referencia</label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-start">
              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Ano</label>
                <select
                  value={manualYear}
                  onChange={(e) => {
                    setManualYear(Number(e.target.value));
                    setHolerithPreview(null);
                  }}
                  className="w-full bg-zinc-50 border-none rounded-xl font-bold text-sm focus:ring-2 focus:ring-zinc-900"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Mes</label>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {MONTH_LABELS.map((label, index) => {
                    const month = index + 1;
                    const value = `${manualYear}-${String(month).padStart(2, '0')}`;
                    const selected = manualReferenceMonth === value;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleSelectManualMonth(month)}
                        className={cn(
                          'py-2 rounded-lg border text-sm font-bold transition-all',
                          selected
                            ? 'bg-zinc-900 border-zinc-900 text-white'
                            : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-zinc-100'
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {availableMonths.length > 0 && (
              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest block mb-2">Competencias cadastradas (atalho)</label>
                <div className="flex flex-wrap gap-2">
                  {availableMonths.slice(0, 10).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setManualReferenceMonth(m);
                        setManualYear(Number(m.slice(0, 4)));
                        setManualMonthError('');
                        setManualHolerithError('');
                        setHolerithPreview(null);
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-full border text-xs font-bold transition-all',
                        manualReferenceMonth === m
                          ? 'bg-zinc-900 border-zinc-900 text-white'
                          : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-zinc-100'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3">
              <div className="text-xs text-zinc-500">Selecionado</div>
              <div className="font-black text-zinc-900">
                {manualReferenceMonth || '-- selecione a competencia --'}
              </div>
              {manualCompetenciaHint && (
                <div className="mt-1 text-[11px] text-zinc-500 font-medium">{manualCompetenciaHint}</div>
              )}
            </div>

            {manualMonthError && (
              <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {manualMonthError}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-3xl border border-zinc-100 space-y-3">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block">Gerar via Holerith (PDF)</label>
            <div className="flex flex-col md:flex-row gap-2">
              <button
                type="button"
                onClick={() => holerithInputRef.current?.click()}
                className="md:w-auto w-full py-2.5 px-4 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 font-bold text-sm hover:bg-zinc-100"
              >
                {holerithFile ? 'Trocar PDF' : 'Selecionar PDF'}
              </button>
              <button
                type="button"
                onClick={createFromHolerith}
                disabled={isBuildingFromHolerith}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {isBuildingFromHolerith ? 'Processando PDF...' : 'Gerar previa pelo holerith'}
              </button>
              <button
                type="button"
                onClick={loadHolerithDraft}
                className="w-full md:w-auto py-2.5 px-4 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 font-bold text-sm hover:bg-zinc-100"
              >
                Carregar rascunho
              </button>
            </div>
            <input
              type="file"
              ref={holerithInputRef}
              className="hidden"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setHolerithFile(file);
                setManualHolerithError('');
                setHolerithPreview(null);
              }}
            />
            {holerithFile && (
              <div className="text-xs text-zinc-600 font-medium">
                Arquivo: <span className="font-bold">{holerithFile.name}</span>
              </div>
            )}
            {holerithSummary && (
              <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">{holerithSummary}</div>
            )}
            {manualHolerithError && (
              <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {manualHolerithError}
              </div>
            )}
            <div className="text-[11px] text-zinc-500">
              O sistema cria um cartao projetado com base nos totais de atraso e horas extras do holerith. Revise no cartao antes de salvar.
            </div>
          </div>

          {holerithPreview && (
            <div className="bg-white p-6 rounded-3xl border border-zinc-100 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Previa da projeção</div>
                  <div className="text-sm font-black text-zinc-900">Competencia {holerithPreview.month}</div>
                </div>
                <div className="text-[11px] text-zinc-500">
                  Hollerith: {(holerithPreview.parsed.competenceMonth || 0).toString().padStart(2, '0')}/{holerithPreview.parsed.competenceYear || '--'}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-bold text-zinc-500 uppercase">Totais extraidos</div>
                  <div className="text-xs text-zinc-700 mt-1">HE50: {minutesToTime(holerithPreview.parsed.he50Minutes)}</div>
                  <div className="text-xs text-zinc-700">HE75: {minutesToTime(holerithPreview.parsed.he75Minutes)}</div>
                  <div className="text-xs text-zinc-700">HE100: {minutesToTime(holerithPreview.parsed.he100Minutes)}</div>
                  <div className="text-xs text-zinc-700">HE125: {minutesToTime(holerithPreview.parsed.he125Minutes)}</div>
                  <div className="text-xs text-zinc-700">Atraso: {minutesToTime(holerithPreview.parsed.atrasoMinutes)}</div>
                  <div className="text-xs font-bold text-zinc-900 mt-1">Total: {minutesToTime(previewParsedTotalMinutes)}</div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-bold text-zinc-500 uppercase">Totais projetados</div>
                  <div className="text-xs text-zinc-700 mt-1">HE50: {minutesToTime(holerithPreview.projected.summary.he50MinutesApplied)}</div>
                  <div className="text-xs text-zinc-700">HE75: {minutesToTime(holerithPreview.projected.summary.he75MinutesApplied)}</div>
                  <div className="text-xs text-zinc-700">HE100: {minutesToTime(holerithPreview.projected.summary.he100MinutesApplied)}</div>
                  <div className="text-xs text-zinc-700">HE125: {minutesToTime(holerithPreview.projected.summary.he125MinutesApplied)}</div>
                  <div className="text-xs text-zinc-700">Atraso: {minutesToTime(holerithPreview.projected.summary.atrasoMinutesApplied)}</div>
                  <div className="text-xs font-bold text-zinc-900 mt-1">Total: {minutesToTime(previewAppliedTotalMinutes)}</div>
                </div>
              </div>

              {holerithPreview.projected.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  {holerithPreview.projected.warnings[0]}
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-2">
                <button
                  type="button"
                  onClick={saveHolerithDraft}
                  className="w-full py-2.5 px-4 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 font-bold text-sm hover:bg-zinc-100"
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  onClick={saveProjectedCard}
                  disabled={isSavingPredicted}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isSavingPredicted ? 'Salvando predicao...' : 'Salvar predicao'}
                </button>
                <button
                  type="button"
                  onClick={openProjectedCard}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-800"
                >
                  Abrir cartao projetado
                </button>
              </div>
              <div className="text-[11px] text-zinc-500">
                O cartao e aberto com os horarios padrao do normal e predição de atrasos/HE do holerith. Depois clique em <b>Salvar Alteracoes</b> no cartao.
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={isProcessing}
            onClick={createManualCard}
            className="w-full py-4 bg-zinc-900 text-white rounded-3xl font-bold text-base flex items-center justify-center gap-3 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-zinc-200"
          >
            <Clock className="w-5 h-5" />
            {holerithPreview && holerithPreview.month === manualReferenceMonth
              ? 'Abrir Lancamento com Predicao'
              : 'Criar Lancamento Manual'}
          </button>
        </>
      )}

      {isCameraOpen && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-4">
          <video ref={videoRef} autoPlay playsInline className="w-full max-w-2xl rounded-3xl shadow-2xl" />
          <div className="mt-8 flex items-center gap-8">
            <button onClick={() => setIsCameraOpen(false)} className="p-4 bg-white/10 rounded-full text-white">
              <Trash2 className="w-6 h-6" />
            </button>
            <button onClick={capturePhoto} className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-zinc-900" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </div>
  );
}
