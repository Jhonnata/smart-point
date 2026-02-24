import React, { useRef, useState } from 'react';
import { Camera, Upload, Trash2, CheckCircle2, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { parsePontoImage, type TimeEntry, type PontoData } from '../services/aiService';
import type { Settings } from '../lib/calculations';
import { cn } from '../lib/utils';

export type UploadUpdateMode = 'merge' | 'replace';

interface Props {
  onProcessed: (
    entries: TimeEntry[],
    metadata: Partial<PontoData>,
    options?: { updateMode: UploadUpdateMode }
  ) => void;
  settings: Settings;
  availableMonths?: string[];
  existingEntries?: TimeEntry[];
  initialMonth?: string;
  initialIsOvertimeCard?: boolean;
}

export default function UploadView({ 
  onProcessed, 
  settings, 
  availableMonths = [], 
  existingEntries = [],
  initialMonth = '',
  initialIsOvertimeCard = false
}: Props) {
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraSide, setCameraSide] = useState<'front' | 'back'>('front');
  const [selectedExistingMonth, setSelectedExistingMonth] = useState<string>(initialMonth);
  const [isOvertimeCard, setIsOvertimeCard] = useState(initialIsOvertimeCard);
  const [updateMode, setUpdateMode] = useState<UploadUpdateMode>('merge');
  
  const [activeUploadSide, setActiveUploadSide] = useState<'front' | 'back'>('front');
  const competenciaPeriodHint = React.useMemo(() => {
    if (!selectedExistingMonth) return '';
    const [yearStr, monthStr] = selectedExistingMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return '';

    const c = Math.max(1, Math.min(31, Number(settings.cycleStartDay || 15)));
    if (c <= 1) return `Competência ${monthStr}/${year}: 01/${monthStr}/${year} a 31/${monthStr}/${year}`;

    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }
    const prevMonthStr = prevMonth.toString().padStart(2, '0');
    const startDay = Math.min(c + 1, 31).toString().padStart(2, '0');
    const endDay = c.toString().padStart(2, '0');
    return `Competência ${monthStr}/${year}: ${startDay}/${prevMonthStr}/${prevYear} a ${endDay}/${monthStr}/${year}`;
  }, [selectedExistingMonth, settings.cycleStartDay]);

  // Load existing images if month and type are selected
  React.useEffect(() => {
    if (selectedExistingMonth) {
      const [selYear, selMonth] = selectedExistingMonth.split('-');
      const monthEntries = existingEntries.filter(e => 
        (() => {
          const hMonth = (e as any).holerithMonth;
          const hYear = (e as any).holerithYear;
          if (hMonth && hYear) {
            return hMonth === selMonth && Number(hYear) === Number(selYear);
          }
          return !!e.date && e.date.startsWith(selectedExistingMonth);
        })() &&
        !!e.isOvertimeCard === isOvertimeCard
      );
      if (monthEntries.length > 0) {
        setFrontImage(monthEntries[0].frontImage || null);
        setBackImage(monthEntries[0].backImage || null);
      } else {
        setFrontImage(null);
        setBackImage(null);
      }
    } else {
      setFrontImage(null);
      setBackImage(null);
    }
  }, [selectedExistingMonth, existingEntries, isOvertimeCard]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (activeUploadSide === 'front') setFrontImage(reader.result as string);
      else setBackImage(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Reset input value to allow selecting same file again if needed
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
    } catch (err) {
      toast.error("Erro ao acessar câmera");
      setIsCameraOpen(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        
        if (cameraSide === 'front') setFrontImage(dataUrl);
        else setBackImage(dataUrl);

        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        setIsCameraOpen(false);
      }
    }
  };

  const processImages = async () => {
    if (!frontImage && !backImage) return;
    setIsProcessing(true);
    try {
      const imagesToProcess = [frontImage, backImage].filter(Boolean) as string[];
      const data = await parsePontoImage(imagesToProcess, settings, isOvertimeCard);
      
      if (data && Array.isArray(data.entries)) {
        const { entries, ...metadata } = data;
        // Include images in metadata to be saved
        const extendedMetadata = {
          ...metadata,
          frontImage: frontImage || undefined,
          backImage: backImage || undefined
        };
        onProcessed(entries, extendedMetadata, { updateMode });
      } else {
        throw new Error("Nenhum dado extraído do cartão.");
      }
    } catch (err: any) {
      console.error("Error processing images", err);
      toast.error(err.message || "Erro ao processar imagens. Verifique a qualidade da foto.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-zinc-900">Digitalizar Cartão</h2>
        <p className="text-zinc-500">Envie a frente e o verso do seu cartão de ponto</p>
      </div>

      {availableMonths.length > 0 && (
        <div className="bg-white p-6 rounded-3xl border border-zinc-100 flex flex-col md:flex-row items-center gap-4">
          <div className="flex-1 w-full">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-2">Tipo do Cartão</label>
            <div className="flex gap-2">
              <button
                onClick={() => setIsOvertimeCard(false)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border",
                  !isOvertimeCard 
                    ? "bg-zinc-900 border-zinc-900 text-white" 
                    : "bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100"
                )}
              >
                Cartão Normal
              </button>
              <button
                onClick={() => setIsOvertimeCard(true)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border",
                  isOvertimeCard 
                    ? "bg-red-600 border-red-600 text-white" 
                    : "bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100"
                )}
              >
                <Clock className="w-4 h-4" />
                Horas Extras
              </button>
            </div>
          </div>
          <div className="flex-1 w-full">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-2">Atualizar Cartão Existente?</label>
            <select 
              value={selectedExistingMonth}
              onChange={(e) => setSelectedExistingMonth(e.target.value)}
              className="w-full bg-zinc-50 border-none rounded-xl font-bold text-sm focus:ring-2 focus:ring-zinc-900"
            >
              <option value="">-- Novo Cartão --</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {competenciaPeriodHint && (
              <p className="mt-2 text-[11px] text-zinc-500 font-medium">{competenciaPeriodHint}</p>
            )}
          </div>
        </div>
      )}

      {availableMonths.length === 0 && (
        <div className="bg-white p-6 rounded-3xl border border-zinc-100">
           <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-2">Tipo do Cartão</label>
            <div className="flex gap-2">
              <button
                onClick={() => setIsOvertimeCard(false)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border",
                  !isOvertimeCard 
                    ? "bg-zinc-900 border-zinc-900 text-white" 
                    : "bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100"
                )}
              >
                Cartão Normal
              </button>
              <button
                onClick={() => setIsOvertimeCard(true)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border",
                  isOvertimeCard 
                    ? "bg-red-600 border-red-600 text-white" 
                    : "bg-zinc-50 border-zinc-100 text-zinc-400 hover:bg-zinc-100"
                )}
              >
                <Clock className="w-4 h-4" />
                Horas Extras
              </button>
            </div>
        </div>
      )}

      <div className="bg-white p-6 rounded-3xl border border-zinc-100 space-y-3">
        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block">Modo de Atualizacao</label>
        <div className="flex gap-2">
          <button
            onClick={() => setUpdateMode('merge')}
            className={cn(
              "flex-1 py-3 rounded-xl font-bold text-sm transition-all border",
              updateMode === 'merge'
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100"
            )}
          >
            Mesclar (Recomendado)
          </button>
          <button
            onClick={() => setUpdateMode('replace')}
            className={cn(
              "flex-1 py-3 rounded-xl font-bold text-sm transition-all border",
              updateMode === 'replace'
                ? "bg-red-600 border-red-600 text-white"
                : "bg-zinc-50 border-zinc-100 text-zinc-500 hover:bg-zinc-100"
            )}
          >
            Substituir Este Cartao
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {updateMode === 'merge'
            ? "Mesclar preserva o que ja existe e atualiza somente campos capturados pela IA."
            : "Substituir sobrescreve totalmente o cartao do tipo selecionado para o mes de referencia."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Front Side */}
        <div className="space-y-4">
          <h3 className="font-bold text-zinc-700 flex items-center gap-2">
            <span className="w-6 h-6 bg-zinc-900 text-white rounded-full flex items-center justify-center text-xs">1</span>
            Frente (Dias 1-15)
          </h3>
          <div className={cn(
            "aspect-[3/4] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-all relative overflow-hidden",
            frontImage ? "border-emerald-500 bg-emerald-50/10" : "border-zinc-200 bg-white"
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
                <span className="text-sm text-zinc-400">Tire uma foto ou faça upload</span>
              </div>
            )}
          </div>
        </div>

        {/* Back Side */}
        <div className="space-y-4">
          <h3 className="font-bold text-zinc-700 flex items-center gap-2">
            <span className="w-6 h-6 bg-zinc-900 text-white rounded-full flex items-center justify-center text-xs">2</span>
            Verso (Dias 16-31)
          </h3>
          <div className={cn(
            "aspect-[3/4] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-all relative overflow-hidden",
            backImage ? "border-emerald-500 bg-emerald-50/10" : "border-zinc-200 bg-white"
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
                <span className="text-sm text-zinc-400">Tire uma foto ou faça upload</span>
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
            Analisar Cartão de Ponto
          </>
        )}
      </button>

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
