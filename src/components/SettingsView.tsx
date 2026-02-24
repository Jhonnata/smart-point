import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, Bot, RefreshCw, User, Building2, DollarSign } from 'lucide-react';
import type { Settings } from '../lib/calculations';
import { listGeminiModels, listOpenAIModels } from '../services/aiService';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export default function SettingsView({ settings, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<'financeiro' | 'ia' | 'funcionario'>('financeiro');
  const [localSettings, setLocalSettings] = React.useState(settings);
  const [geminiModels, setGeminiModels] = useState<{id: string, name: string}[]>([]);
  const [openaiModels, setOpenaiModels] = useState<{id: string, name: string}[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Helpers for BRL currency mask
  const formatBRL = React.useCallback((v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isNaN(v) ? 0 : v), []);
  const parseBRL = React.useCallback((s: string) => {
    // remove everything except digits, comma and minus
    const cleaned = (s || '').toString().replace(/[^0-9,\-\.]/g, '').replace(/\./g, '');
    const num = Number(cleaned.replace(',', '.'));
    return isNaN(num) ? 0 : num;
  }, []);
  const [baseSalaryInput, setBaseSalaryInput] = useState<string>(formatBRL(settings.baseSalary || 0));

  // Keep masked input in sync when settings change externally
  useEffect(() => {
    setBaseSalaryInput(formatBRL((localSettings.baseSalary as number) || 0));
  }, [localSettings.baseSalary, formatBRL]);

  const fetchGeminiModels = React.useCallback(async (key: string, silent = false) => {
    if (!key) {
      if (!silent) toast.error("Insira a chave de API Gemini primeiro");
      return;
    }
    setIsLoadingModels(true);
    try {
      const models = await listGeminiModels(key);
      if (models.length > 0) {
        setGeminiModels(models);
        if (!silent) toast.success(`${models.length} modelos Gemini carregados`);
      } else {
        if (!silent) toast.error("Nenhum modelo Gemini encontrado ou chave inválida");
      }
    } catch (err) {
      if (!silent) toast.error("Erro ao buscar modelos Gemini");
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const fetchOpenAIModels = React.useCallback(async (key: string, silent = false) => {
    if (!key) {
      if (!silent) toast.error("Insira a chave de API OpenAI primeiro");
      return;
    }
    setIsLoadingModels(true);
    try {
      const models = await listOpenAIModels(key);
      if (models.length > 0) {
        setOpenaiModels(models);
        if (!silent) toast.success(`${models.length} modelos OpenAI carregados`);
      } else {
        if (!silent) toast.error("Nenhum modelo OpenAI encontrado ou chave inválida");
      }
    } catch (err) {
      if (!silent) toast.error("Erro ao buscar modelos OpenAI");
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const hasFetched = React.useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    
    let isMounted = true;
    const fetchModels = async () => {
      if (localSettings.aiProvider === 'gemini' && localSettings.geminiApiKey) {
        if (isMounted) await fetchGeminiModels(localSettings.geminiApiKey, true);
      } else if (localSettings.aiProvider === 'openai' && localSettings.openaiApiKey) {
        if (isMounted) await fetchOpenAIModels(localSettings.openaiApiKey, true);
      }
    };
    
    fetchModels();
    hasFetched.current = true;
    return () => { isMounted = false; };
  }, [fetchGeminiModels, fetchOpenAIModels, localSettings.aiProvider, localSettings.geminiApiKey, localSettings.openaiApiKey]);

  const handleChange = (key: keyof Settings, value: string | number) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    if (key === 'baseSalary' && typeof value === 'number') {
      setBaseSalaryInput(formatBRL(value));
    }
    
    // Auto-fetch models when provider or relevant API key changes
    if (key === 'aiProvider') {
      const provider = value as string;
      if (provider === 'gemini' && localSettings.geminiApiKey) {
        fetchGeminiModels(localSettings.geminiApiKey);
      } else if (provider === 'openai' && localSettings.openaiApiKey) {
        fetchOpenAIModels(localSettings.openaiApiKey);
      }
    } else if (key === 'geminiApiKey' && localSettings.aiProvider === 'gemini') {
      fetchGeminiModels(value as string);
    } else if (key === 'openaiApiKey' && localSettings.aiProvider === 'openai') {
      fetchOpenAIModels(value as string);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-3xl shadow-sm border border-zinc-100 space-y-8">
      <div className="flex items-center gap-3 border-b border-zinc-50 pb-4">
        <div className="p-2 bg-zinc-100 rounded-xl">
          <SettingsIcon className="w-6 h-6 text-zinc-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Configurações</h2>
          <p className="text-sm text-zinc-500">Ajuste as regras de cálculo e valores</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex p-1 bg-zinc-100 rounded-2xl gap-1">
        {[
          { id: 'financeiro', label: 'Financeiro', icon: DollarSign },
          { id: 'ia', label: 'IA', icon: Bot },
          { id: 'funcionario', label: 'Funcionário', icon: User }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all",
              activeTab === tab.id 
                ? "bg-white text-zinc-900 shadow-sm" 
                : "text-zinc-400 hover:text-zinc-600"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'financeiro' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Salário Base</label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  value={baseSalaryInput}
                  onChange={e => {
                    const text = e.target.value;
                    setBaseSalaryInput(text);
                    const num = parseBRL(text);
                    handleChange('baseSalary', num);
                  }}
                  onBlur={() => setBaseSalaryInput(formatBRL((localSettings.baseSalary as number) || 0))}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="R$ 0,00"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Divisor Mensal</label>
                <input 
                  type="number" 
                  value={localSettings.monthlyHours}
                  onChange={e => handleChange('monthlyHours', Number(e.target.value))}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Jornada Diária (Horas)</label>
                <input 
                  type="number" 
                  value={localSettings.dailyJourney}
                  onChange={e => handleChange('dailyJourney', Number(e.target.value))}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Limite Semanal 50% (Horas)</label>
                <input 
                  type="number" 
                  value={localSettings.weeklyLimit}
                  onChange={e => handleChange('weeklyLimit', Number(e.target.value))}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Início Adicional Noturno</label>
                <input 
                  type="text" 
                  value={localSettings.nightCutoff}
                  onChange={e => handleChange('nightCutoff', e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="22:00"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-zinc-50">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase">Adicional 1 (%)</label>
                <input 
                  type="number" 
                  value={localSettings.percent50}
                  onChange={e => handleChange('percent50', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase">Adicional 2 (%)</label>
                <input 
                  type="number" 
                  value={localSettings.percent100}
                  onChange={e => handleChange('percent100', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase">Noturno (%)</label>
                <input 
                  type="number" 
                  value={localSettings.percentNight}
                  onChange={e => handleChange('percentNight', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
            </div>

            <div className="pt-6 border-t border-zinc-50 space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-zinc-400" />
                Dados de Folha / Holerite (Deduções)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Dependentes (IRRF)</label>
                  <input 
                    type="number" 
                    value={localSettings.dependentes || 0}
                    onChange={e => handleChange('dependentes', Number(e.target.value))}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Adiantamento (%)</label>
                  <input 
                    type="number" 
                    value={localSettings.adiantamentoPercent || 0}
                    onChange={e => handleChange('adiantamentoPercent', Number(e.target.value))}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: 45"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">IR Retido no Adiant. (R$)</label>
                  <input 
                    type="number" 
                    value={localSettings.adiantamentoIR || 0}
                    onChange={e => handleChange('adiantamentoIR', Number(e.target.value))}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="md:col-span-3 space-y-4 pt-6 bg-zinc-50/50 p-6 rounded-[2rem] border border-zinc-100">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="saturdayCompensation" className="text-sm font-black text-zinc-900 cursor-pointer uppercase tracking-tighter">
                        Compensação de Sábado
                      </label>
                      <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Zerar jornada aos sábados</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleChange('saturdayCompensation', localSettings.saturdayCompensation ? 0 : 1)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        localSettings.saturdayCompensation ? "bg-emerald-500" : "bg-zinc-200"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        localSettings.saturdayCompensation ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>

                  {!!localSettings.saturdayCompensation && (
                    <div className="pt-4 border-t border-zinc-100 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Dias com +1h de jornada:</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Segunda', short: 'Seg', value: 1 },
                          { label: 'Terça', short: 'Ter', value: 2 },
                          { label: 'Quarta', short: 'Qua', value: 3 },
                          { label: 'Quinta', short: 'Qui', value: 4 },
                          { label: 'Sexta', short: 'Sex', value: 5 },
                        ].map(day => {
                          const currentDays = (localSettings.compDays || '1,2,3,4').split(',').filter(Boolean);
                          const isChecked = currentDays.includes(day.value.toString());
                          
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => {
                                let newDays = isChecked 
                                  ? currentDays.filter(d => d !== day.value.toString())
                                  : [...currentDays, day.value.toString()];
                                newDays.sort((a, b) => Number(a) - Number(b));
                                handleChange('compDays', newDays.join(','));
                              }}
                              className={cn(
                                "flex-1 min-w-[60px] py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border",
                                isChecked 
                                  ? "bg-zinc-900 border-zinc-900 text-white shadow-lg shadow-zinc-200" 
                                  : "bg-white border-zinc-200 text-zinc-400 hover:border-zinc-900 hover:text-zinc-900"
                              )}
                            >
                              {day.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Início do Ciclo (Dia)</label>
                  <input 
                    type="number" 
                    min="1"
                    max="31"
                    value={localSettings.cycleStartDay || 15}
                    onChange={e => handleChange('cycleStartDay', Number(e.target.value))}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Padrão: 15"
                  />
                  <p className="text-[10px] text-zinc-400 italic">Ex: 16 para ciclo de 16 a 15</p>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 italic">
                * Se o adiantamento for 0, o sistema calculará automaticamente 45% do salário base para fins de simulação.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'ia' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-5 h-5 text-zinc-400" />
              <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">Inteligência Artificial</h3>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Provedor de IA</label>
              <select 
                value={localSettings.aiProvider || 'gemini'}
                onChange={e => handleChange('aiProvider', e.target.value as any)}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="codex">Codex / Custom Proxy</option>
              </select>
            </div>

            {localSettings.aiProvider === 'gemini' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave de API Gemini</label>
                  <input 
                    type="password" 
                    value={localSettings.geminiApiKey || ''}
                    onChange={e => handleChange('geminiApiKey', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Insira sua chave Gemini"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700 flex items-center justify-between">
                    Modelo Gemini
                    <button 
                      onClick={() => fetchGeminiModels(localSettings.geminiApiKey!)}
                      className="p-1 hover:bg-zinc-100 rounded text-zinc-400"
                      disabled={isLoadingModels}
                    >
                      <RefreshCw className={cn("w-3 h-3", isLoadingModels && "animate-spin")} />
                    </button>
                  </label>
                  <select 
                    value={localSettings.geminiModel || 'gemini-3-flash-preview'}
                    onChange={e => handleChange('geminiModel', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {geminiModels.length > 0 ? (
                      geminiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                    ) : (
                      <>
                        <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}

            {localSettings.aiProvider === 'openai' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave de API OpenAI</label>
                  <input 
                    type="password" 
                    value={localSettings.openaiApiKey || ''}
                    onChange={e => handleChange('openaiApiKey', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700 flex items-center justify-between">
                    Modelo OpenAI
                    <button 
                      onClick={() => fetchOpenAIModels(localSettings.openaiApiKey!)}
                      className="p-1 hover:bg-zinc-100 rounded text-zinc-400"
                      disabled={isLoadingModels}
                    >
                      <RefreshCw className={cn("w-3 h-3", isLoadingModels && "animate-spin")} />
                    </button>
                  </label>
                  <select 
                    value={localSettings.openaiModel || 'gpt-4o'}
                    onChange={e => handleChange('openaiModel', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {openaiModels.length > 0 ? (
                      openaiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                    ) : (
                      <>
                        <option value="gpt-4o">GPT-4o (Recomendado)</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}

            {localSettings.aiProvider === 'codex' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave de API Codex</label>
                  <input 
                    type="password" 
                    value={localSettings.codexApiKey || ''}
                    onChange={e => handleChange('codexApiKey', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Insira sua chave Codex"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Endpoint/Modelo</label>
                  <input 
                    type="text" 
                    value={localSettings.codexModel || ''}
                    onChange={e => handleChange('codexModel', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="ex: code-davinci-002"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'funcionario' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-zinc-400" />
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">Dados do Funcionário</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Nome do Funcionário</label>
                  <input 
                    type="text" 
                    value={localSettings.employeeName || ''}
                    onChange={e => handleChange('employeeName', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: JHONNATA SIMOES DA SILVA"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Código/Matrícula</label>
                  <input 
                    type="text" 
                    value={localSettings.employeeCode || ''}
                    onChange={e => handleChange('employeeCode', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: 00371-4"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Cargo</label>
                  <input 
                    type="text" 
                    value={localSettings.role || ''}
                    onChange={e => handleChange('role', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: ANALISTA SISTEMAS"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Setor/Local</label>
                  <input 
                    type="text" 
                    value={localSettings.location || ''}
                    onChange={e => handleChange('location', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: CPD-INTERNET"
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-zinc-100">
                <h4 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Jornada Padrao</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Entrada</label>
                    <input
                      type="text"
                      value={localSettings.workStart || '12:00'}
                      onChange={e => handleChange('workStart', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="12:00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Saida Almoco</label>
                    <input
                      type="text"
                      value={localSettings.lunchStart || '17:00'}
                      onChange={e => handleChange('lunchStart', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="17:00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Retorno Almoco</label>
                    <input
                      type="text"
                      value={localSettings.lunchEnd || '18:00'}
                      onChange={e => handleChange('lunchEnd', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="18:00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Saida</label>
                    <input
                      type="text"
                      value={localSettings.workEnd || '21:00'}
                      onChange={e => handleChange('workEnd', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="21:00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Entrada Sabado</label>
                    <input
                      type="text"
                      value={localSettings.saturdayWorkStart || '12:00'}
                      onChange={e => handleChange('saturdayWorkStart', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="12:00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-zinc-700">Saida Sabado</label>
                    <input
                      type="text"
                      value={localSettings.saturdayWorkEnd || '16:00'}
                      onChange={e => handleChange('saturdayWorkEnd', e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="16:00"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-zinc-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-zinc-400" />
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">Dados da Empresa</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Nome da Empresa</label>
                  <input 
                    type="text" 
                    value={localSettings.companyName || ''}
                    onChange={e => handleChange('companyName', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: ASSUPERO ENSINO SUPERIOR"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">CNPJ</label>
                  <input 
                    type="text" 
                    value={localSettings.companyCnpj || ''}
                    onChange={e => handleChange('companyCnpj', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="00.000.000/0000-00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Número do Cartão</label>
                  <input 
                    type="text" 
                    value={localSettings.cardNumber || ''}
                    onChange={e => handleChange('cardNumber', e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="Ex: 000025"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <button 
        onClick={() => onSave(localSettings)}
        className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
      >
        <Save className="w-5 h-5" />
        Salvar Configurações
      </button>
    </div>
  );
}
