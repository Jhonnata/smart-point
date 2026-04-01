import React, { useEffect, useState } from 'react';
import {
  Bot,
  Building2,
  Plus,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Trash2,
  User,
} from 'lucide-react';
import type {
  CompanyDailyOvertimeDiscountRule,
  CompanyOvertimeRule,
  CompanyRubricMap,
  CompanySettingsProfile,
  Settings,
} from '../lib/calculations';
import { buildSuggestedCompanyRubrics, buildSuggestedDailyOvertimeDiscountRules, buildSuggestedOvertimeRules } from '../lib/calculations';
import { listGeminiModels, listOpenAIModels } from '../services/aiService';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

type TabId = 'ia' | 'funcionario' | 'empresa';

function cloneCompanySettings(settings: Settings, company?: CompanySettingsProfile | null): CompanySettingsProfile {
  const suggestedRubrics = buildSuggestedCompanyRubrics();
  const baseConfig = {
    weeklyLimit: company?.config?.weeklyLimit,
    monthlyLimitHE: company?.config?.monthlyLimitHE,
    percentNight: company?.config?.percentNight,
    cycleStartDay: company?.config?.cycleStartDay,
  };
  const suggestedRules = buildSuggestedOvertimeRules(baseConfig);
  const suggestedDiscountRules = buildSuggestedDailyOvertimeDiscountRules();
  return {
    cnpj: String(company?.cnpj || settings.companyCnpj || '').trim(),
    name: String(company?.name || settings.companyName || '').trim(),
    rubrics: { ...suggestedRubrics, ...((company?.rubrics || {}) as CompanyRubricMap) },
    config: {
      ...(company?.config || {}),
      overtimeRules: Array.isArray(company?.config?.overtimeRules)
        ? company.config.overtimeRules.map((rule) => ({ ...rule }))
        : suggestedRules,
      dailyOvertimeDiscountRules: Array.isArray(company?.config?.dailyOvertimeDiscountRules)
        ? company.config.dailyOvertimeDiscountRules.map((rule) => ({ ...rule }))
        : suggestedDiscountRules,
    },
  };
}

export default function SettingsView({ settings, onSave }: Props) {
  const compensationDays = [
    { value: '1', label: 'Seg' },
    { value: '2', label: 'Ter' },
    { value: '3', label: 'Qua' },
    { value: '4', label: 'Qui' },
    { value: '5', label: 'Sex' },
  ] as const;
  const [activeTab, setActiveTab] = useState<TabId>('funcionario');
  const [localSettings, setLocalSettings] = React.useState(settings);
  const [geminiModels, setGeminiModels] = useState<{ id: string; name: string }[]>([]);
  const [openaiModels, setOpenaiModels] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [editingRubricKey, setEditingRubricKey] = useState<string | null>(null);
  const [rubricDraft, setRubricDraft] = useState({ code: '', label: '' });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<CompanyOvertimeRule>({
    id: '',
    label: '',
    rubricKey: '',
    multiplier: 1.5,
    period: 'day',
    dayType: 'weekday',
    priority: 1,
    active: true,
  });
  const formatBRL = React.useCallback((value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isNaN(value) ? 0 : value), []);
  const parseBRL = React.useCallback((value: string) => {
    const cleaned = (value || '').toString().replace(/[^0-9,\-.]/g, '').replace(/\./g, '');
    const parsed = Number(cleaned.replace(',', '.'));
    return isNaN(parsed) ? 0 : parsed;
  }, []);
  const [baseSalaryInput, setBaseSalaryInput] = useState<string>(formatBRL(settings.baseSalary || 0));
  const hasFetched = React.useRef(false);

  useEffect(() => {
    setLocalSettings(settings);
    setBaseSalaryInput(formatBRL(settings.baseSalary || 0));
  }, [settings, formatBRL]);

  const fetchGeminiModels = React.useCallback(async (key: string, silent = false) => {
    if (!key) {
      if (!silent) toast.error('Insira a chave de API Gemini primeiro');
      return;
    }
    setIsLoadingModels(true);
    try {
      const models = await listGeminiModels(key);
      if (models.length > 0) {
        setGeminiModels(models);
        if (!silent) toast.success(`${models.length} modelos Gemini carregados`);
      } else if (!silent) {
        toast.error('Nenhum modelo Gemini encontrado ou chave invalida');
      }
    } catch {
      if (!silent) toast.error('Erro ao buscar modelos Gemini');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const fetchOpenAIModels = React.useCallback(async (key: string, silent = false) => {
    if (!key) {
      if (!silent) toast.error('Insira a chave de API OpenAI primeiro');
      return;
    }
    setIsLoadingModels(true);
    try {
      const models = await listOpenAIModels(key);
      if (models.length > 0) {
        setOpenaiModels(models);
        if (!silent) toast.success(`${models.length} modelos OpenAI carregados`);
      } else if (!silent) {
        toast.error('Nenhum modelo OpenAI encontrado ou chave invalida');
      }
    } catch {
      if (!silent) toast.error('Erro ao buscar modelos OpenAI');
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    let mounted = true;
    const run = async () => {
      if (localSettings.aiProvider === 'gemini' && localSettings.geminiApiKey) {
        if (mounted) await fetchGeminiModels(localSettings.geminiApiKey, true);
      } else if (localSettings.aiProvider === 'openai' && localSettings.openaiApiKey) {
        if (mounted) await fetchOpenAIModels(localSettings.openaiApiKey, true);
      }
    };
    run();
    hasFetched.current = true;
    return () => {
      mounted = false;
    };
  }, [fetchGeminiModels, fetchOpenAIModels, localSettings.aiProvider, localSettings.geminiApiKey, localSettings.openaiApiKey]);

  const handleChange = (key: keyof Settings, value: string | number) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    if (key === 'aiProvider') {
      const provider = String(value);
      if (provider === 'gemini' && localSettings.geminiApiKey) fetchGeminiModels(localSettings.geminiApiKey);
      if (provider === 'openai' && localSettings.openaiApiKey) fetchOpenAIModels(localSettings.openaiApiKey);
    } else if (key === 'geminiApiKey' && localSettings.aiProvider === 'gemini') {
      fetchGeminiModels(String(value));
    } else if (key === 'openaiApiKey' && localSettings.aiProvider === 'openai') {
      fetchOpenAIModels(String(value));
    }
  };

  const toggleCompDay = React.useCallback((day: string) => {
    setLocalSettings((prev) => {
      const current = String(prev.compDays || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => Number(a) - Number(b));
      return {
        ...prev,
        compDays: next.join(','),
      };
    });
  }, []);

  const updateCompanySettings = React.useCallback((updater: (current: CompanySettingsProfile) => CompanySettingsProfile) => {
    setLocalSettings((prev) => {
      const nextCompany = updater(cloneCompanySettings(prev, prev.companySettings));
      return {
        ...prev,
        companySettings: nextCompany,
        companyName: nextCompany.name || prev.companyName,
        companyCnpj: nextCompany.cnpj || prev.companyCnpj,
      };
    });
  }, []);

  const handleCompanyFieldChange = React.useCallback((field: 'name' | 'cnpj', value: string) => {
    updateCompanySettings((current) => ({ ...current, [field]: value }));
  }, [updateCompanySettings]);

  const handleCompanyConfigChange = React.useCallback((field: string, value: number | string) => {
    updateCompanySettings((current) => ({
      ...current,
      config: {
        ...current.config,
        [field]: value,
      },
    }));
  }, [updateCompanySettings]);

  const handleRubricChange = React.useCallback((rubricKey: string, field: 'code' | 'label', value: string) => {
    updateCompanySettings((current) => ({
      ...current,
      rubrics: {
        ...current.rubrics,
        [rubricKey]: {
          code: String(current.rubrics?.[rubricKey]?.code || ''),
          label: String(current.rubrics?.[rubricKey]?.label || rubricKey),
          [field]: value,
        },
      },
    }));
  }, [updateCompanySettings]);

  const openRubricEditor = React.useCallback((rubricKey: string) => {
    const rubric = cloneCompanySettings(localSettings, localSettings.companySettings).rubrics[rubricKey] || { code: '', label: '' };
    setEditingRubricKey(rubricKey);
    setRubricDraft({
      code: rubric.code || '',
      label: rubric.label || rubricKey,
    });
  }, [localSettings]);

  const closeRubricEditor = React.useCallback(() => {
    setEditingRubricKey(null);
    setRubricDraft({ code: '', label: '' });
  }, []);

  const saveRubricEditor = React.useCallback(() => {
    if (!editingRubricKey) return;
    handleRubricChange(editingRubricKey, 'code', rubricDraft.code);
    handleRubricChange(editingRubricKey, 'label', rubricDraft.label);
    closeRubricEditor();
  }, [closeRubricEditor, editingRubricKey, handleRubricChange, rubricDraft.code, rubricDraft.label]);

  const addRubric = React.useCallback(() => {
    updateCompanySettings((current) => {
      let index = 1;
      let key = `RUBRICA_${index}`;
      while (current.rubrics[key]) {
        index += 1;
        key = `RUBRICA_${index}`;
      }
      return {
        ...current,
        rubrics: {
          ...current.rubrics,
          [key]: { code: '', label: key },
        },
      };
    });
  }, [updateCompanySettings]);

  const removeRubric = React.useCallback((rubricKey: string) => {
    updateCompanySettings((current) => {
      const nextRubrics = { ...current.rubrics };
      delete nextRubrics[rubricKey];
      return {
        ...current,
        rubrics: nextRubrics,
        config: {
          ...current.config,
          overtimeRules: (current.config.overtimeRules || []).filter((rule) => rule.rubricKey !== rubricKey),
        },
      };
    });
  }, [updateCompanySettings]);

  const addOvertimeRule = React.useCallback(() => {
    const nextPriority = (cloneCompanySettings(localSettings, localSettings.companySettings).config.overtimeRules || []).length + 1;
    setEditingRuleId('new');
    setRuleDraft({
      id: '',
      label: `Regra ${nextPriority}`,
      rubricKey: '',
      multiplier: 1.5,
      period: 'day',
      dayType: 'weekday',
      priority: nextPriority,
      active: true,
    });
  }, [localSettings]);

  const updateOvertimeRule = React.useCallback((ruleId: string, field: keyof CompanyOvertimeRule, value: string | number | boolean) => {
    updateCompanySettings((current) => ({
      ...current,
      config: {
        ...current.config,
        overtimeRules: (current.config.overtimeRules || []).map((rule) =>
          rule.id === ruleId ? { ...rule, [field]: value } : rule
        ),
      },
    }));
  }, [updateCompanySettings]);

  const removeOvertimeRule = React.useCallback((ruleId: string) => {
    updateCompanySettings((current) => ({
      ...current,
      config: {
        ...current.config,
        overtimeRules: (current.config.overtimeRules || []).filter((rule) => rule.id !== ruleId),
      },
    }));
  }, [updateCompanySettings]);

  const openRuleEditor = React.useCallback((ruleId: string) => {
    const rule = (cloneCompanySettings(localSettings, localSettings.companySettings).config.overtimeRules || []).find((item) => item.id === ruleId);
    if (!rule) return;
    setEditingRuleId(ruleId);
    setRuleDraft({ ...rule });
  }, [localSettings]);

  const closeRuleEditor = React.useCallback(() => {
    setEditingRuleId(null);
    setRuleDraft({
      id: '',
      label: '',
      rubricKey: '',
      multiplier: 1.5,
      period: 'day',
      dayType: 'weekday',
      priority: 1,
      active: true,
    });
  }, []);

  const saveRuleEditor = React.useCallback(() => {
    if (!editingRuleId) return;
    updateCompanySettings((current) => {
      const rules = [...(current.config.overtimeRules || [])];
      const nextRule: CompanyOvertimeRule = {
        ...ruleDraft,
        id: editingRuleId === 'new' ? `rule-${Date.now()}` : String(ruleDraft.id || editingRuleId),
      };
      const nextRules = editingRuleId === 'new'
        ? [...rules, nextRule]
        : rules.map((rule) => (rule.id === editingRuleId ? nextRule : rule));
      return {
        ...current,
        config: {
          ...current.config,
          overtimeRules: nextRules,
        },
      };
    });
    closeRuleEditor();
  }, [closeRuleEditor, editingRuleId, ruleDraft, updateCompanySettings]);

  const companySettings = cloneCompanySettings(localSettings, localSettings.companySettings);
  const overtimeRules = companySettings.config.overtimeRules || [];
  const discountRules = (companySettings.config.dailyOvertimeDiscountRules || []).slice().sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  const rubricEntries = Object.entries(companySettings.rubrics || {});

  const updateDiscountRule = React.useCallback((ruleId: string, updater: (rule: CompanyDailyOvertimeDiscountRule) => CompanyDailyOvertimeDiscountRule) => {
    updateCompanySettings((current) => ({
      ...current,
      config: {
        ...current.config,
        dailyOvertimeDiscountRules: (current.config.dailyOvertimeDiscountRules || buildSuggestedDailyOvertimeDiscountRules()).map((rule) => (
          rule.id === ruleId ? updater({ ...rule }) : { ...rule }
        )),
      },
    }));
  }, [updateCompanySettings]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm sm:p-6 sm:space-y-8">
      <div className="flex items-center gap-3 border-b border-zinc-50 pb-4">
        <div className="rounded-xl bg-zinc-100 p-2">
          <SettingsIcon className="w-6 h-6 text-zinc-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Configuracoes</h2>
          <p className="text-sm text-zinc-500">Ajuste calculos, IA, funcionario e regras da empresa</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-zinc-100 p-1">
        {[
          { id: 'ia', label: 'IA', icon: Bot },
          { id: 'funcionario', label: 'Funcionario', icon: User },
          { id: 'empresa', label: 'Empresa', icon: Building2 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabId)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition-all sm:text-sm',
              activeTab === tab.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[420px]">
        {activeTab === 'ia' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-zinc-400" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900">Inteligencia Artificial</h3>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-zinc-700">Provedor</label>
              <select value={localSettings.aiProvider || 'gemini'} onChange={(e) => handleChange('aiProvider', e.target.value as any)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="codex">Codex / Proxy</option>
              </select>
            </div>

            {localSettings.aiProvider === 'gemini' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave Gemini</label>
                  <input type="password" value={localSettings.geminiApiKey || ''} onChange={(e) => handleChange('geminiApiKey', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                    Modelo Gemini
                    <button type="button" onClick={() => fetchGeminiModels(localSettings.geminiApiKey || '')} className="rounded p-1 text-zinc-400 hover:bg-zinc-100" disabled={isLoadingModels}>
                      <RefreshCw className={cn('w-3 h-3', isLoadingModels && 'animate-spin')} />
                    </button>
                  </label>
                  <select value={localSettings.geminiModel || 'gemini-3-flash-preview'} onChange={(e) => handleChange('geminiModel', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
                    {geminiModels.length > 0 ? geminiModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>) : (
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave OpenAI</label>
                  <input type="password" value={localSettings.openaiApiKey || ''} onChange={(e) => handleChange('openaiApiKey', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                    Modelo OpenAI
                    <button type="button" onClick={() => fetchOpenAIModels(localSettings.openaiApiKey || '')} className="rounded p-1 text-zinc-400 hover:bg-zinc-100" disabled={isLoadingModels}>
                      <RefreshCw className={cn('w-3 h-3', isLoadingModels && 'animate-spin')} />
                    </button>
                  </label>
                  <select value={localSettings.openaiModel || 'gpt-4o'} onChange={(e) => handleChange('openaiModel', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
                    {openaiModels.length > 0 ? openaiModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>) : (
                      <>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}

            {localSettings.aiProvider === 'codex' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Chave Codex</label>
                  <input type="password" value={localSettings.codexApiKey || ''} onChange={(e) => handleChange('codexApiKey', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Endpoint / Modelo</label>
                  <input type="text" value={localSettings.codexModel || ''} onChange={(e) => handleChange('codexModel', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === 'funcionario' && (
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-zinc-400" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900">Dados do Funcionario</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Nome</label>
                  <input type="text" value={localSettings.employeeName || ''} onChange={(e) => handleChange('employeeName', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Matricula</label>
                  <input type="text" value={localSettings.employeeCode || ''} onChange={(e) => handleChange('employeeCode', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Cargo</label>
                  <input type="text" value={localSettings.role || ''} onChange={(e) => handleChange('role', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Setor / Local</label>
                  <input type="text" value={localSettings.location || ''} onChange={(e) => handleChange('location', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-zinc-100 pt-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">Remuneracao e Jornada</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Salario Base</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={baseSalaryInput}
                    onChange={(e) => {
                      const text = e.target.value;
                      setBaseSalaryInput(text);
                      handleChange('baseSalary', parseBRL(text));
                    }}
                    onBlur={() => {
                      const parsed = parseBRL(baseSalaryInput);
                      handleChange('baseSalary', parsed);
                      setBaseSalaryInput(formatBRL(parsed));
                    }}
                    className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Divisor Mensal</label>
                  <input type="number" value={localSettings.monthlyHours} onChange={(e) => handleChange('monthlyHours', Number(e.target.value))} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Jornada Diaria (horas)</label>
                  <input type="number" value={localSettings.dailyJourney} onChange={(e) => handleChange('dailyJourney', Number(e.target.value))} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>

              <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">Jornada Padrao</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Entrada</label>
                  <input type="text" value={localSettings.workStart || '12:00'} onChange={(e) => handleChange('workStart', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Saida almoco</label>
                  <input type="text" value={localSettings.lunchStart || '17:00'} onChange={(e) => handleChange('lunchStart', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Retorno almoco</label>
                  <input type="text" value={localSettings.lunchEnd || '18:00'} onChange={(e) => handleChange('lunchEnd', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Saida</label>
                  <input type="text" value={localSettings.workEnd || '21:00'} onChange={(e) => handleChange('workEnd', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>

              <div className="space-y-4 rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-tight text-zinc-900">Compensacao de Sabado</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Define se a jornada de sabado sera distribuida nos dias uteis</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('saturdayCompensation', localSettings.saturdayCompensation ? 0 : 1)}
                    className={cn('relative h-6 w-12 rounded-full transition-all', localSettings.saturdayCompensation ? 'bg-emerald-500' : 'bg-zinc-200')}
                  >
                    <div className={cn('absolute top-1 h-4 w-4 rounded-full bg-white transition-all', localSettings.saturdayCompensation ? 'left-7' : 'left-1')} />
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-zinc-500">Entrada Sabado</label>
                    <input type="text" value={localSettings.saturdayWorkStart || ''} onChange={(e) => handleChange('saturdayWorkStart', e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="Ex: 08:00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-zinc-500">Saida Sabado</label>
                    <input type="text" value={localSettings.saturdayWorkEnd || ''} onChange={(e) => handleChange('saturdayWorkEnd', e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="Ex: 12:00" />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase text-zinc-500">Dias que compensam o sabado</label>
                  <div className="flex flex-wrap gap-2">
                    {compensationDays.map((day) => {
                      const active = String(localSettings.compDays || '1,2,3,4')
                        .split(',')
                        .map((item) => item.trim())
                        .includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleCompDay(day.value)}
                          className={cn(
                            'rounded-xl border px-4 py-2 text-xs font-bold transition-colors',
                            active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Nome da empresa</label>
                  <input type="text" value={localSettings.companyName || ''} onChange={(e) => handleChange('companyName', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">CNPJ</label>
                  <input type="text" value={localSettings.companyCnpj || ''} onChange={(e) => handleChange('companyCnpj', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'empresa' && (
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-zinc-400" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-900">Regras da Empresa</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Nome da empresa</label>
                  <input type="text" value={companySettings.name} onChange={(e) => handleCompanyFieldChange('name', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">CNPJ</label>
                  <input type="text" value={companySettings.cnpj} onChange={(e) => handleCompanyFieldChange('cnpj', e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6 md:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500">Limite semanal</label>
                  <input type="number" value={companySettings.config.weeklyLimit ?? ''} onChange={(e) => handleCompanyConfigChange('weeklyLimit', Number(e.target.value))} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="min" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500">Limite mensal</label>
                  <input type="number" value={companySettings.config.monthlyLimitHE ?? ''} onChange={(e) => handleCompanyConfigChange('monthlyLimitHE', Number(e.target.value))} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="min" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500">Noturno (%)</label>
                  <input type="number" value={companySettings.config.percentNight ?? ''} onChange={(e) => handleCompanyConfigChange('percentNight', Number(e.target.value))} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500">Ciclo (dia)</label>
                  <input type="number" min="1" max="31" value={companySettings.config.cycleStartDay ?? ''} onChange={(e) => handleCompanyConfigChange('cycleStartDay', Number(e.target.value))} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500">Inicio adicional noturno</label>
                  <input type="text" value={localSettings.nightCutoff || ''} onChange={(e) => handleChange('nightCutoff', e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" placeholder="Ex: 22:00" />
                </div>
              </div>

              <div className="space-y-4 rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6">
                <div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-tight text-zinc-900">Desconto de HE</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">As faixas de desconto agora pertencem as rubricas da empresa</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {discountRules.map((rule) => (
                    <div key={rule.id} className="grid grid-cols-3 gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-zinc-500">Rubrica</label>
                        <select
                          value={rule.rubricKey}
                          onChange={(e) => updateDiscountRule(rule.id, (current) => ({ ...current, rubricKey: e.target.value }))}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                        >
                          {rubricEntries.map(([key, rubric]) => (
                            <option key={key} value={key}>{key} - {rubric.label || rubric.code || 'Sem descricao'}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-zinc-500">Faixa ({rule.label})</label>
                        <input
                          type="number"
                          step="0.5"
                          value={rule.thresholdHours ?? ''}
                          onChange={(e) => updateDiscountRule(rule.id, (current) => ({ ...current, thresholdHours: Number(e.target.value || 0) }))}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-zinc-500">Desconto (min)</label>
                        <input
                          type="number"
                          value={rule.discountMinutes ?? ''}
                          onChange={(e) => updateDiscountRule(rule.id, (current) => ({ ...current, discountMinutes: Number(e.target.value || 0) }))}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-[2rem] border border-zinc-100 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-tight text-zinc-900">Rubricas</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Codigos e descricoes usados no holerite</p>
                </div>
                <button type="button" onClick={addRubric} className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold text-white">
                  <Plus className="w-4 h-4" />
                  Nova rubrica
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-zinc-100">
                <table className="min-w-full divide-y divide-zinc-100">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Chave</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Codigo</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Descricao</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-zinc-500">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {rubricEntries.map(([key, rubric]) => (
                      <tr key={key}>
                        <td className="px-4 py-3 text-sm font-bold text-zinc-700">{key}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{rubric.code || '-'}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{rubric.label || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openRubricEditor(key)}
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => removeRubric(key)}
                              className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-rose-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rubricEntries.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
                    Nenhuma rubrica cadastrada.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-[2rem] border border-zinc-100 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-tight text-zinc-900">Regras de Horas Extras</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Cada regra escolhe rubrica, multiplicador e limites</p>
                </div>
                <button type="button" onClick={addOvertimeRule} className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold text-white">
                  <Plus className="w-4 h-4" />
                  Nova regra
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-zinc-100">
                <table className="min-w-full divide-y divide-zinc-100">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Regra</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Rubrica</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Multiplicador</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Periodo</th>
                      <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-zinc-500">Dia</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-zinc-500">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {overtimeRules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="px-4 py-3 text-sm font-bold text-zinc-700">{rule.label}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{companySettings.rubrics[rule.rubricKey]?.label || rule.rubricKey || '-'}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{rule.multiplier}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{rule.period || 'any'}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600">{rule.dayType || 'weekday'}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openRuleEditor(rule.id)}
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => removeOvertimeRule(rule.id)}
                              className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-rose-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {overtimeRules.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
                    Nenhuma regra de HE cadastrada.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => onSave(localSettings)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 py-4 font-bold text-white shadow-lg shadow-zinc-200 transition-all hover:bg-zinc-800"
      >
        <Save className="w-5 h-5" />
        Salvar Configuracoes
      </button>

      {editingRubricKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="space-y-1 border-b border-zinc-100 pb-4">
              <h3 className="text-lg font-black text-zinc-900">Editar rubrica</h3>
              <p className="text-sm text-zinc-500">{editingRubricKey}</p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Codigo</label>
                <input
                  type="text"
                  value={rubricDraft.code}
                  onChange={(e) => setRubricDraft((prev) => ({ ...prev, code: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: 1058"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Descricao</label>
                <input
                  type="text"
                  value={rubricDraft.label}
                  onChange={(e) => setRubricDraft((prev) => ({ ...prev, label: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: Hora Extra 50%"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeRubricEditor}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveRubricEditor}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
              >
                Salvar rubrica
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRuleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="space-y-1 border-b border-zinc-100 pb-4">
              <h3 className="text-lg font-black text-zinc-900">{editingRuleId === 'new' ? 'Nova regra de HE' : 'Editar regra de HE'}</h3>
              <p className="text-sm text-zinc-500">Configure rubrica, multiplicador, prioridade e limites da regra.</p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-semibold text-zinc-700">Nome da regra</label>
                <input
                  type="text"
                  value={ruleDraft.label}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, label: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: HE 50% Diurna"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Rubrica</label>
                <select
                  value={ruleDraft.rubricKey}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, rubricKey: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {rubricEntries.map(([key, rubric]) => (
                    <option key={key} value={key}>
                      {key} - {rubric.label || rubric.code || 'Sem descricao'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Multiplicador</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={ruleDraft.multiplier ?? ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, multiplier: Number(e.target.value || 0) }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: 1.5"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Prioridade</label>
                <input
                  type="number"
                  min="1"
                  value={ruleDraft.priority ?? ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, priority: Number(e.target.value || 1) }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Periodo</label>
                <select
                  value={ruleDraft.period || 'any'}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, period: e.target.value as typeof prev.period }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="any">Qualquer</option>
                  <option value="day">Diurno</option>
                  <option value="night">Noturno</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Tipo de dia</label>
                <select
                  value={ruleDraft.dayType || 'weekday'}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, dayType: e.target.value as typeof prev.dayType }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="weekday">Dia util / sabado</option>
                  <option value="sunday">Domingo / feriado</option>
                  <option value="any">Qualquer</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Grupo limite semanal</label>
                <input
                  type="text"
                  value={ruleDraft.weeklyLimitGroup || ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, weeklyLimitGroup: e.target.value || undefined }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: low-tier"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Limite semanal (min)</label>
                <input
                  type="number"
                  min="0"
                  value={ruleDraft.weeklyLimitMinutes ?? ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, weeklyLimitMinutes: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: 180"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Grupo limite mensal</label>
                <input
                  type="text"
                  value={ruleDraft.monthlyLimitGroup || ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, monthlyLimitGroup: e.target.value || undefined }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: low-tier-month"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Limite mensal (min)</label>
                <input
                  type="number"
                  min="0"
                  value={ruleDraft.monthlyLimitMinutes ?? ''}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, monthlyLimitMinutes: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: 900"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Status</label>
                <select
                  value={ruleDraft.active === false ? 'inactive' : 'active'}
                  onChange={(e) => setRuleDraft((prev) => ({ ...prev, active: e.target.value === 'active' }))}
                  className="w-full rounded-xl border border-zinc-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeRuleEditor}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveRuleEditor}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
              >
                Salvar regra
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
