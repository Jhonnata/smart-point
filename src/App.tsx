import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Settings as SettingsIcon, 
  FileText, 
  PlusCircle,
  LogOut,
  ChevronRight,
  Menu,
  X,
  DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast, Toaster } from 'sonner';
import SettingsView from './components/SettingsView';
import UploadView from './components/UploadView';
import DualCardView from './components/DualCardView';
import SummaryView from './components/SummaryView';
import HolerithView from './components/HolerithView';
import CardListView from './components/CardListView';
import DashboardView from './components/DashboardView';
import type { Settings } from './lib/calculations';
import type { TimeEntry } from './services/aiService';
import { cn } from './lib/utils';
import { parseISO, isValid, format as formatDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type View = 'dashboard' | 'resumo' | 'holerith' | 'card' | 'card-list' | 'upload' | 'settings';

export default function App() {
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.replace('#', '') as View;
    const validViews: View[] = ['dashboard', 'resumo', 'holerith', 'card', 'card-list', 'upload', 'settings'];
    return validViews.includes(hash) ? hash : 'dashboard';
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [holeriths, setHoleriths] = useState<any[]>([]);
  const [monthCache, setMonthCache] = useState<Record<string, any>>({});
  const [selectedMonth, setSelectedMonth] = useState<string>(''); // YYYY-MM
  const [isLoading, setIsLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [monthData, setMonthData] = useState<any>(null);
  const [isMonthLoading, setIsMonthLoading] = useState(false);
  const [uploadContext, setUploadContext] = useState<{ month: string, isOvertime: boolean } | null>(null);

  const mapRefRowsToEntries = React.useCallback((
    list: any[] = [],
    isOvertimeCard: boolean,
    options?: {
      monthKey?: string;
      frontImage?: string | null;
      backImage?: string | null;
      metadata?: any;
    }
  ): TimeEntry[] => {
    const monthKey = options?.monthKey || '';
    const [yearStr, monthStr] = monthKey ? monthKey.split('-') : ['', ''];
    const holerithYear = Number(yearStr || '0');
    const holerithMonth = monthStr || '';
    const metadata = options?.metadata || {};

    return (list || []).map((e: any) => ({
      id: `${monthKey || 'ref'}-${e.date || ''}${isOvertimeCard ? '-ot' : ''}`,
      date: e.date,
      workDate: e.date,
      day: e.day,
      entry1: e.entry1 || '',
      exit1: e.exit1 || '',
      entry2: e.entry2 || '',
      exit2: e.exit2 || '',
      entryExtra: e.entryExtra || '',
      exitExtra: e.exitExtra || '',
      totalHours: e.totalHours || '00:00',
      isDPAnnotation: !!e.isDPAnnotation,
      isOvertimeCard,
      frontImage: options?.frontImage || undefined,
      backImage: options?.backImage || undefined,
      employeeName: metadata.employeeName,
      employeeCode: metadata.employeeCode,
      role: metadata.role,
      location: metadata.location,
      companyName: metadata.companyName,
      companyCnpj: metadata.companyCnpj,
      cardNumber: metadata.cardNumber,
      month: metadata.month,
      year: metadata.year,
      holerithMonth,
      holerithYear
    } as TimeEntry));
  }, []);

  const monthKeyFromHolerith = React.useCallback((h: any) => {
    return `${h.year}-${String(h.month).padStart(2, '0')}`;
  }, []);

  const refFromMonthKey = React.useCallback((monthKey: string) => {
    const [year, month] = monthKey.split('-');
    return `${month}${year}`;
  }, []);

  const buildEntriesFromReference = React.useCallback((monthKey: string, refData: any): TimeEntry[] => {
    if (!refData) return [];

    const metadata = {
      employeeName: refData.employeeName,
      employeeCode: refData.employeeCode,
      role: refData.role,
      location: refData.location,
      companyName: refData.companyName,
      companyCnpj: refData.companyCnpj,
      cardNumber: refData.cardNumber,
      month: refData.month,
      year: refData.year
    };

    const normal = refData.hasNormalCard
      ? mapRefRowsToEntries(refData.hours || [], false, {
          monthKey,
          frontImage: refData.frontImage || null,
          backImage: refData.backImage || null,
          metadata
        })
      : [];

    const overtime = refData.hasOvertimeCard
      ? mapRefRowsToEntries(refData.he || [], true, {
          monthKey,
          frontImage: refData.frontImageHe || null,
          backImage: refData.backImageHe || null,
          metadata
        })
      : [];

    return [...normal, ...overtime];
  }, [mapRefRowsToEntries]);

  const monthsFromHoleriths = React.useMemo(() => {
    return [...new Set((holeriths || []).map(monthKeyFromHolerith))].sort().reverse();
  }, [holeriths, monthKeyFromHolerith]);

  const rebuildEntriesFromCache = React.useCallback((cache: Record<string, any>, months: string[]) => {
    const merged: TimeEntry[] = [];
    months.forEach((monthKey) => {
      merged.push(...buildEntriesFromReference(monthKey, cache[monthKey]));
    });
    return merged;
  }, [buildEntriesFromReference]);

  const fetchReferenceByMonth = React.useCallback(async (monthKey: string) => {
    const ref = refFromMonthKey(monthKey);
    const res = await fetch(`/api/referencia/${ref}`);
    if (!res.ok) return null;
    return await res.json();
  }, [refFromMonthKey]);

  const refreshHolerithsAndCache = React.useCallback(async (focusMonth?: string) => {
    const holRes = await fetch('/api/holeriths');
    const holData = holRes.ok ? await holRes.json() as any[] : [];
    const months = [...new Set((holData || []).map(monthKeyFromHolerith))].sort().reverse();

    const refPairs = await Promise.all(months.map(async (monthKey) => {
      const refData = await fetchReferenceByMonth(monthKey);
      return [monthKey, refData] as const;
    }));

    const nextCache: Record<string, any> = {};
    refPairs.forEach(([monthKey, refData]) => {
      if (refData) nextCache[monthKey] = refData;
    });

    setHoleriths(holData || []);
    setMonthCache(nextCache);
    setEntries(rebuildEntriesFromCache(nextCache, months));

    const nextSelected = focusMonth && months.includes(focusMonth)
      ? focusMonth
      : (selectedMonth && months.includes(selectedMonth) ? selectedMonth : (months[0] || ''));

    if (nextSelected !== selectedMonth) {
      setSelectedMonth(nextSelected);
    }
  }, [fetchReferenceByMonth, monthKeyFromHolerith, rebuildEntriesFromCache, selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) {
      setMonthData(null);
      return;
    }

    setMonthData(null);
    setIsMonthLoading(true);

    const fetchMonthData = async () => {
      try {
        const cached = monthCache[selectedMonth];
        if (cached) {
          setMonthData(cached);
        }
        const fresh = await fetchReferenceByMonth(selectedMonth);
        if (fresh) {
          setMonthData(fresh);
          setMonthCache(prev => ({ ...prev, [selectedMonth]: fresh }));
        }
      } catch (err) {
        console.error("Error fetching month data", err);
      } finally {
        setIsMonthLoading(false);
      }
    };

    fetchMonthData();
  }, [selectedMonth, fetchReferenceByMonth]);

  useEffect(() => {
    // Only fetch settings if they haven't been loaded yet
    if (!settings) {
      fetchData();
    }
    
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') as View;
      const validViews: View[] = ['dashboard', 'resumo', 'holerith', 'card', 'card-list', 'upload', 'settings'];
      if (validViews.includes(hash)) {
        setView(hash);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [settings]);

  useEffect(() => {
    setEntries(rebuildEntriesFromCache(monthCache, monthsFromHoleriths));
  }, [monthCache, monthsFromHoleriths, rebuildEntriesFromCache]);

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  const availableMonths = monthsFromHoleriths;

  const monthHoursEntries = React.useMemo(() => {
    if (!selectedMonth) return [] as TimeEntry[];

    const source = monthData || monthCache[selectedMonth];
    if (source && (Array.isArray(source.hours) || Array.isArray(source.he))) {
      if (source.hasNormalCard === false) return [] as TimeEntry[];
      return mapRefRowsToEntries(source.hours || [], false, {
        monthKey: selectedMonth,
        frontImage: source.frontImage || null,
        backImage: source.backImage || null,
        metadata: source
      });
    }

    const [year, month] = selectedMonth.split('-');
    return entries.filter(e => {
      const hMonth = (e as any).holerithMonth;
      const hYear = (e as any).holerithYear;
      if (hMonth && hYear) {
        return hMonth === month && hYear === Number(year) && !(e as any).isOvertimeCard;
      }
      return e.date && e.date.startsWith(selectedMonth) && !(e as any).isOvertimeCard;
    }) as TimeEntry[];
  }, [entries, selectedMonth, monthData, monthCache, mapRefRowsToEntries]);

  const monthHeEntries = React.useMemo(() => {
    if (!selectedMonth) return [] as TimeEntry[];

    const source = monthData || monthCache[selectedMonth];
    if (source && (Array.isArray(source.hours) || Array.isArray(source.he))) {
      if (source.hasOvertimeCard === false) return [] as TimeEntry[];
      return mapRefRowsToEntries(source.he || [], true, {
        monthKey: selectedMonth,
        frontImage: source.frontImageHe || null,
        backImage: source.backImageHe || null,
        metadata: source
      });
    }

    const [year, month] = selectedMonth.split('-');
    return entries.filter(e => {
      const hMonth = (e as any).holerithMonth;
      const hYear = (e as any).holerithYear;
      if (hMonth && hYear) {
        return hMonth === month && hYear === Number(year) && !!(e as any).isOvertimeCard;
      }
      return e.date && e.date.startsWith(selectedMonth) && !!(e as any).isOvertimeCard;
    }) as TimeEntry[];
  }, [entries, selectedMonth, monthData, monthCache, mapRefRowsToEntries]);

  const filteredEntries = React.useMemo(() => {
    return [...monthHoursEntries, ...monthHeEntries];
  }, [monthHoursEntries, monthHeEntries]);

  const currentMetadata = React.useMemo(() => {
    if (monthData) {
      return {
        employeeName: settings?.employeeName || monthData.employeeName,
        employeeCode: settings?.employeeCode || monthData.employeeCode,
        role: settings?.role || monthData.role,
        location: settings?.location || monthData.location,
        companyName: settings?.companyName || monthData.companyName,
        companyCnpj: settings?.companyCnpj || monthData.companyCnpj,
        cardNumber: settings?.cardNumber || monthData.cardNumber,
        isOvertimeCard: monthData.isOvertimeCard,
        month: monthData.month,
        year: monthData.year
      };
    }
    const entryMeta = (monthHoursEntries[0] || monthHeEntries[0] || {}) as TimeEntry;
    return {
      employeeName: settings?.employeeName || entryMeta.employeeName,
      employeeCode: settings?.employeeCode || entryMeta.employeeCode,
      role: settings?.role || entryMeta.role,
      location: settings?.location || entryMeta.location,
      companyName: settings?.companyName || entryMeta.companyName,
      companyCnpj: settings?.companyCnpj || entryMeta.companyCnpj,
      cardNumber: settings?.cardNumber || entryMeta.cardNumber,
      isOvertimeCard: entryMeta.isOvertimeCard,
      month: entryMeta.month,
      year: entryMeta.year
    };
  }, [monthHoursEntries, monthHeEntries, settings, monthData]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const sRes = await fetch('/api/settings');
      const sData = await sRes.json();
      setSettings(sData);
      await refreshHolerithsAndCache();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async (newSettings: Settings) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    setSettings(newSettings);
    toast.success("Configurações salvas!");
    setView('dashboard');
  };

  const saveCard = async (payload: {
    companyName?: string; companyCnpj?: string;
    employeeName?: string; employeeCode?: string;
    role?: string; location?: string; cardNumber?: string;
    month: string; year: number;
    hours: any[]; he: any[];
    frontImage?: string; backImage?: string;
    frontImageHe?: string; backImageHe?: string;
  }) => {
    const ref = `${payload.month}${payload.year}`;
    console.log(`Saving card via POST /api/referencia/${ref}`);
    try {
      const res = await fetch(`/api/referencia/${ref}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      console.log('Save response:', data);

      const monthKey = `${payload.year}-${String(payload.month).padStart(2, '0')}`;
      await refreshHolerithsAndCache(monthKey);

      const mRes = await fetch(`/api/referencia/${ref}`);
      if (mRes.ok) {
        const mData = await mRes.json();
        setMonthData(mData);
        setMonthCache(prev => ({ ...prev, [monthKey]: mData }));
      }

      toast.success("Dados salvos com sucesso!");
      setView('dashboard');
    } catch (err: any) {
      console.error("Error saving card:", err);
      toast.error(err.message || "Erro ao salvar os dados.");
    }
  };

  // Mantido para compatibilidade com DualCardView.onSave (que ainda recebe TimeEntry[])
  const saveEntries = async (newEntries: TimeEntry[]) => {
    if (!newEntries || newEntries.length === 0) return;
    const sample = newEntries[0] as any;
    const selected = selectedMonth ? selectedMonth.split('-') : [];
    const refYear = selectedMonth ? Number(selected[0]) : (sample.year || Number((sample.workDate || sample.date || '').substring(0, 4)));
    const refMonth = selectedMonth ? selected[1] : (sample.month || (sample.workDate || sample.date || '').substring(5, 7));
    if (!refMonth || !refYear) { toast.error('Mês/ano inválido.'); return; }

    const normalRows = newEntries.filter(e => !e.isOvertimeCard);
    const overtimeRows = newEntries.filter(e => !!e.isOvertimeCard);
    const currentRef = monthData || (selectedMonth ? monthCache[selectedMonth] : null);

    const hasPayloadData = (row: TimeEntry) => {
      const fields = [row.entry1, row.exit1, row.entry2, row.exit2, row.entryExtra, row.exitExtra];
      return fields.some(v => !!(v || '').toString().trim()) || !!(row as any).isDPAnnotation;
    };

    const persistNormal = normalRows.some(hasPayloadData) || !!currentRef?.hasNormalCard;
    const persistOvertime = overtimeRows.some(hasPayloadData) || !!currentRef?.hasOvertimeCard;

    const hours = persistNormal ? normalRows.map(e => ({
      date: (e as any).workDate || e.date,
      day: e.day,
      entry1: e.entry1 || '', exit1: e.exit1 || '',
      entry2: e.entry2 || '', exit2: e.exit2 || '',
      entryExtra: e.entryExtra || '', exitExtra: e.exitExtra || '',
      totalHours: e.totalHours || '', isDPAnnotation: !!(e as any).isDPAnnotation
    })) : [];
    const he = persistOvertime ? overtimeRows.map(e => ({
      date: (e as any).workDate || e.date,
      day: e.day,
      entry1: e.entry1 || '', exit1: e.exit1 || '',
      entry2: e.entry2 || '', exit2: e.exit2 || '',
      entryExtra: e.entryExtra || '', exitExtra: e.exitExtra || '',
      totalHours: e.totalHours || '', isDPAnnotation: !!(e as any).isDPAnnotation
    })) : [];

    if (hours.length === 0 && he.length === 0) {
      toast.error('Nenhum dado para salvar no mês selecionado.');
      return;
    }

    const normalSample = normalRows[0] as any;
    const overtimeSample = overtimeRows[0] as any;
    const frontImage = persistNormal ? normalSample?.frontImage : undefined;
    const backImage = persistNormal ? normalSample?.backImage : undefined;
    const frontImageHe = persistOvertime ? overtimeSample?.frontImage : undefined;
    const backImageHe = persistOvertime ? overtimeSample?.backImage : undefined;

    await saveCard({
      companyName: sample.companyName, companyCnpj: sample.companyCnpj,
      employeeName: sample.employeeName, employeeCode: sample.employeeCode,
      role: sample.role, location: sample.location, cardNumber: sample.cardNumber,
      month: String(refMonth).padStart(2,'0'), year: Number(refYear),
      hours, he, frontImage, backImage, frontImageHe, backImageHe
    });
  };

  const clearData = async () => {
    toast("Deseja limpar todos os dados?", {
      action: {
        label: "Limpar Tudo",
        onClick: async () => {
          try {
            console.log('Calling DELETE /api/referencias');
            const res = await fetch('/api/referencias', { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            console.log('Clear data response:', data);
            setEntries([]);
            setHoleriths([]);
            setMonthCache({});
            setMonthData(null);
            setSelectedMonth('');
            toast.success("Todos os dados foram limpos.");
            setView('upload');
          } catch (err) {
            console.error("Error clearing data:", err);
            toast.error("Erro ao limpar os dados.");
          }
        },
      },
      cancel: {
        label: "Cancelar",
        onClick: () => console.log("Cancelado"),
      },
    });
  };

  const deleteMonth = async (month: string) => {
    const dateObj = parseISO(month + '-01');
    const monthName = isValid(dateObj) ? formatDate(dateObj, 'MMMM yyyy', { locale: ptBR }) : month;
    
    toast(`Deseja remover permanentemente o cartão de ${monthName}?`, {
      action: {
        label: "Excluir",
        onClick: async () => {
          try {
            const [year, mm] = month.split('-');
            const ref = `${mm}${year}`;
            console.log(`Calling DELETE /api/referencia/${ref}?type=all`);
            const res = await fetch(`/api/referencia/${ref}?type=all`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            console.log('Delete response:', data);

            await refreshHolerithsAndCache();
            toast.success(`Cartão de ${monthName} removido.`);

          } catch (err) {
            console.error("Error deleting month:", err);
            toast.error("Erro ao excluir o cartão.");
          }
        },
      },
      cancel: {
        label: "Cancelar",
        onClick: () => console.log("Cancelado"),
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="w-12 h-12 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'resumo', label: 'Resumo Financeiro', icon: DollarSign },
    { id: 'holerith', label: 'Holerith', icon: FileText },
    { id: 'card-list', label: 'Cartões de Ponto', icon: FileText },
    { id: 'upload', label: 'Novo Lançamento', icon: PlusCircle },
    { id: 'settings', label: 'Configurações', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col md:flex-row font-sans selection:bg-zinc-900 selection:text-white">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-zinc-100 px-4 h-16 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
            <PlusCircle className="w-5 h-5 text-white" />
          </div>
          <span className="font-black text-lg tracking-tighter">PontoSmart</span>
        </div>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2">
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-0 z-40 bg-white border-r border-zinc-100 transition-transform md:relative md:translate-x-0 w-72 flex flex-col",
        isMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-8 hidden md:block">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center shadow-lg shadow-zinc-200">
              <PlusCircle className="w-6 h-6 text-white" />
            </div>
            <span className="font-black text-2xl tracking-tighter">PontoSmart</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id as View); setIsMenuOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-4 rounded-2xl font-bold transition-all",
                view === item.id 
                  ? "bg-zinc-900 text-white shadow-xl shadow-zinc-200" 
                  : "text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
              {view === item.id && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-zinc-50">
          <button 
            onClick={clearData}
            className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <LogOut className="w-5 h-5" />
            Limpar Dados
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-12 overflow-y-auto">
        {/* Month Selector & Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <h2 className="text-3xl font-black text-zinc-900 tracking-tighter">
            {view === 'dashboard' ? 'Dashboard Geral' : 
             view === 'resumo' ? 'Painel de Resumo' :
             view === 'holerith' ? 'Holerith' : 
             view === 'card' ? 'Visualização do Cartão' : 
             view === 'card-list' ? 'Meus Cartões' :
             view === 'settings' ? 'Configurações' : 'Novo Lançamento'}
          </h2>
          
          {(view === 'resumo' || view === 'dashboard' || view === 'holerith') && availableMonths.length > 0 && (
            <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-zinc-100 shadow-sm">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-3">Mês de Referência:</span>
              <select 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-zinc-50 border-none rounded-xl font-bold text-sm focus:ring-2 focus:ring-zinc-900 pr-10"
              >
                {availableMonths.map(m => {
                  const dateObj = parseISO(m + '-01');
                  return (
                    <option key={m} value={m}>
                      {isValid(dateObj) ? formatDate(dateObj, 'MMMM yyyy', { locale: ptBR }) : m}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {/* Card Header Info */}
        {filteredEntries.length > 0 && (view === 'resumo' || view === 'card' || view === 'holerith') && (
          <div className="mb-12 bg-white p-8 rounded-[2rem] border border-zinc-100 shadow-sm flex flex-wrap gap-8">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Funcionário</div>
              <div className="text-xl font-black text-zinc-900">{currentMetadata.employeeName || 'Não identificado'}</div>
              <div className="text-xs font-bold text-zinc-500 uppercase">
                {currentMetadata.role || 'Cargo não identificado'} • {currentMetadata.employeeCode || 'Cod: --'}
              </div>
            </div>
      <div className="flex-1 min-w-[200px]">
        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Empresa</div>
        <div className="text-xl font-black text-zinc-900">{currentMetadata.companyName || 'Empresa não identificada'}</div>
        <div className="flex items-center gap-2 mt-1">
          <div className="text-xs font-bold text-zinc-500 uppercase">{currentMetadata.location || 'Local: --'}</div>
          {currentMetadata.isOvertimeCard && (
            <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[8px] font-black uppercase rounded-full border border-red-200">
              Cartão de Horas Extras
            </span>
          )}
        </div>
      </div>
            <div className="w-px bg-zinc-100 hidden lg:block" />
            <div>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Período</div>
              <div className="text-xl font-black text-zinc-900">
                {currentMetadata.month || '--'} {currentMetadata.year || ''}
              </div>
              <div className="text-xs font-bold text-zinc-500 uppercase">Cartão: {currentMetadata.cardNumber || '--'}</div>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'dashboard' && <DashboardView entries={entries} settings={settings!} />}
            {view === 'resumo' && (
              filteredEntries.length > 0 
                ? <SummaryView
                    entries={filteredEntries}
                    normalEntries={monthHoursEntries}
                    overtimeEntries={monthHeEntries}
                    settings={settings!}
                    month={selectedMonth}
                    onSaveEntries={saveEntries}
                    disableSave={isMonthLoading}
                    onUploadClick={(isOvertime) => {
                      setUploadContext({ month: selectedMonth, isOvertime });
                      setView('upload');
                    }}
                  />
                : <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
                    <div className="w-24 h-24 bg-zinc-100 rounded-full flex items-center justify-center">
                      <FileText className="w-10 h-10 text-zinc-300" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-zinc-900">Nenhum dado encontrado</h3>
                      <p className="text-zinc-500 max-w-xs">Comece digitalizando seu cartão de ponto para ver o resumo financeiro.</p>
                    </div>
                    <button onClick={() => setView('upload')} className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold shadow-xl shadow-zinc-200">
                      Digitalizar Agora
                    </button>
                  </div>
            )}
            {view === 'holerith' && (
              filteredEntries.length > 0
                ? <HolerithView
                    entries={filteredEntries}
                    normalEntries={monthHoursEntries}
                    overtimeEntries={monthHeEntries}
                    settings={settings!}
                    metadata={currentMetadata}
                    selectedMonth={selectedMonth}
                  />
                : <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
                    <div className="w-24 h-24 bg-zinc-100 rounded-full flex items-center justify-center">
                      <FileText className="w-10 h-10 text-zinc-300" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-zinc-900">Nenhum dado encontrado</h3>
                      <p className="text-zinc-500 max-w-xs">Digitalize seu cartão para gerar a página de holerith.</p>
                    </div>
                    <button onClick={() => setView('upload')} className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold shadow-xl shadow-zinc-200">
                      Digitalizar Agora
                    </button>
                  </div>
            )}
            {view === 'card-list' && (
              <CardListView 
                entries={entries} 
                availableMonths={availableMonths} 
                onSelectMonth={(m) => {
                  setSelectedMonth(m);
                  setView('card');
                }}
                onDeleteMonth={deleteMonth}
              />
            )}
            {view === 'card' && <DualCardView 
              entries={filteredEntries} 
              month={selectedMonth}
              settings={settings!}
              onSave={saveEntries}
              disableSave={isMonthLoading}
              onBack={() => setView('card-list')}
              onUploadClick={(isOvertime) => {
                setUploadContext({ month: selectedMonth, isOvertime });
                setView('upload');
              }}
            />}
            {view === 'upload' && <UploadView 
              settings={settings!} 
              availableMonths={availableMonths}
              existingEntries={entries}
              initialMonth={uploadContext?.month}
              initialIsOvertimeCard={uploadContext?.isOvertime}
              onProcessed={async (newEntries, metadata, options) => {
              try {
                if (!Array.isArray(newEntries) || newEntries.length === 0) {
                  console.error("No entries received", newEntries);
                  return;
                }

                // Auto-preencher Configurações do Usuário a partir do cabeçalho do cartão (se vazio)
                if (settings && metadata) {
                  const fillableKeys: (keyof Settings)[] = ['employeeName','employeeCode','role','location','companyName','companyCnpj','cardNumber'];
                  const toFill: Partial<Settings> = {};
                  for (const k of fillableKeys) {
                    const currentVal = (settings as any)[k];
                    const metaVal = (metadata as any)[k];
                    if ((!currentVal || currentVal === '') && metaVal) {
                      (toFill as any)[k] = metaVal;
                    }
                  }
                  if (Object.keys(toFill).length > 0) {
                    const updatedSettings = { ...settings, ...toFill } as Settings;
                    await fetch('/api/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(updatedSettings)
                    });
                    setSettings(updatedSettings);
                  }
                }
                
                // Parse refMonth from OCR metadata (returned as "MM") or from first entry date
                const rawMonth = metadata.month || (newEntries[0].workDate || newEntries[0].date || '').substring(5, 7);
                // Normalize: if it has '/', take only the first part (legacy "MM/YY" format fallback)
                const refMonth = rawMonth.includes('/') ? rawMonth.split('/')[0].padStart(2, '0') : String(rawMonth).padStart(2, '0');
                const refYear = metadata.year || Number((newEntries[0].workDate || newEntries[0].date || '').substring(0, 4));
                const referenceKey = `${refYear}-${refMonth}`;
                const cycleStart = settings?.cycleStartDay || 15;

                const expectedDateForDay = (dayNum: number) => {
                  let dYear = refYear;
                  let dMonth = Number(refMonth);
                  if (cycleStart > 1 && dayNum > cycleStart) {
                    dMonth--;
                    if (dMonth === 0) { dMonth = 12; dYear--; }
                  }
                  return `${dYear}-${dMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                };

                let invalidDayCount = 0;
                let normalizedDateCount = 0;
                newEntries.forEach((entry) => {
                  const dayRaw = entry.day || (entry.workDate || entry.date || '').slice(8, 10);
                  const dayNum = Number(dayRaw);
                  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
                    invalidDayCount++;
                    return;
                  }
                  const expected = expectedDateForDay(dayNum);
                  const provided = (entry.workDate || entry.date || '').slice(0, 10);
                  if (provided && provided !== expected) normalizedDateCount++;
                });
                if (invalidDayCount > 0) {
                  toast.warning(`${invalidDayCount} linha(s) com dia inválido foram ignoradas no mapeamento.`);
                }
                if (normalizedDateCount > 0) {
                  toast.warning(`${normalizedDateCount} data(s) do OCR foram normalizadas para a competência ${referenceKey}.`);
                }
                
                // Buscar dados existentes do mês para preservar o outro tipo de cartão
                const existingRef = await fetch(`/api/referencia/${refMonth}${refYear}`);
                const existingMonthData = existingRef.ok ? await existingRef.json() : { hours: [], he: [], hasNormalCard: false, hasOvertimeCard: false };
                const existingHours = existingMonthData.hasNormalCard ? (existingMonthData.hours || []) : [];
                const existingHe = existingMonthData.hasOvertimeCard ? (existingMonthData.he || []) : [];

                // Construir array completo de 31 dias a partir dos dados da IA
                const buildDays = (aiEntries: TimeEntry[]) => {
                  const byDay: Record<string, any> = {};
                  for (const e of aiEntries) {
                    const d = e.day || (e.workDate || e.date || '').slice(8, 10);
                    if (d) byDay[d] = e;
                  }
                  const out: any[] = [];
                  for (let d = 1; d <= 31; d++) {
                    const dayStr = d.toString().padStart(2, '0');
                    let dYear = refYear; let dMonth = Number(refMonth);
                    if (cycleStart > 1 && d > cycleStart) {
                      dMonth--; if (dMonth === 0) { dMonth = 12; dYear--; }
                    }
                    const dateStr = `${dYear}-${dMonth.toString().padStart(2,'0')}-${dayStr}`;
                    const src = byDay[dayStr];
                    out.push({
                      date: dateStr, day: dayStr,
                      entry1: src?.entry1 || '', exit1: src?.exit1 || '',
                      entry2: src?.entry2 || '', exit2: src?.exit2 || '',
                      entryExtra: src?.entryExtra || '', exitExtra: src?.exitExtra || '',
                      totalHours: '', isDPAnnotation: !!(src?.isDPAnnotation)
                    });
                  }
                  return out;
                };

                // Cartão atual (processado pela IA); o outro tipo é preservado do banco
                const timeFields: Array<'entry1' | 'exit1' | 'entry2' | 'exit2' | 'entryExtra' | 'exitExtra'> = [
                  'entry1', 'exit1', 'entry2', 'exit2', 'entryExtra', 'exitExtra'
                ];

                const hasCapturedData = (row: any) =>
                  !!row && (timeFields.some((f) => !!(row[f] || '').toString().trim()) || !!row.isDPAnnotation);

                // Regra de negocio: preservar dados existentes e atualizar apenas dados capturados pela IA.
                const mergeCardRows = (existingRows: any[], incomingRows: TimeEntry[]) => {
                  const baseRows = buildDays(incomingRows);

                  const toMapByDay = (rows: any[]) => {
                    const map: Record<string, any> = {};
                    (rows || []).forEach((r: any) => {
                      const d = r?.day || (r?.date || r?.workDate || '').slice(8, 10);
                      if (d) map[d] = r;
                    });
                    return map;
                  };

                  const existingByDay = toMapByDay(existingRows || []);
                  const incomingByDay = toMapByDay(incomingRows || []);

                  return baseRows.map((base: any) => {
                    const day = base.day;
                    const existing = existingByDay[day] || base;
                    const incoming = incomingByDay[day];

                    if (!hasCapturedData(incoming)) {
                      return { ...existing, date: base.date, day: base.day };
                    }

                    const merged: any = { ...existing, date: base.date, day: base.day };
                    for (const f of timeFields) {
                      const value = (incoming[f] || '').toString().trim();
                      if (value !== '') merged[f] = value;
                    }
                    if (incoming.isDPAnnotation) merged.isDPAnnotation = true;
                    return merged;
                  });
                };

                const isOvertime = !!metadata.isOvertimeCard;
                const updateMode = options?.updateMode || 'merge';
                const hoursPayload = isOvertime
                  ? existingHours
                  : (updateMode === 'replace'
                    ? buildDays(newEntries)
                    : mergeCardRows(existingHours, newEntries));
                const hePayload = isOvertime
                  ? (updateMode === 'replace'
                    ? buildDays(newEntries)
                    : mergeCardRows(existingHe, newEntries))
                  : existingHe;

                await saveCard({
                  companyName: settings?.companyName || metadata.companyName,
                  companyCnpj: settings?.companyCnpj || metadata.companyCnpj,
                  employeeName: settings?.employeeName || metadata.employeeName,
                  employeeCode: settings?.employeeCode || metadata.employeeCode,
                  role: settings?.role || metadata.role,
                  location: settings?.location || metadata.location,
                  cardNumber: settings?.cardNumber || metadata.cardNumber,
                  month: refMonth, year: refYear,
                  hours: hoursPayload, he: hePayload,
                  frontImage: !isOvertime ? (metadata.frontImage || undefined) : undefined,
                  backImage: !isOvertime ? (metadata.backImage || undefined) : undefined,
                  frontImageHe: isOvertime ? (metadata.frontImage || undefined) : undefined,
                  backImageHe: isOvertime ? (metadata.backImage || undefined) : undefined,
                });
                toast.success("Cartão processado com sucesso!");
                setUploadContext(null);
                setSelectedMonth(referenceKey);
                setView('dashboard');
              } catch (err) {
                console.error("Error processing entries in App", err);
                toast.error("Erro ao processar os dados do cartão.");
              }
            }} />}
            {view === 'settings' && <SettingsView settings={settings!} onSave={saveSettings} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  );
}





