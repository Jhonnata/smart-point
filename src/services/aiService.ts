import { GoogleGenAI, Type } from "@google/genai";
import type { Settings } from "../lib/calculations";

export interface TimeEntry {
  id: string;
  workDate: string; // YYYY-MM-DD
  date: string;     // Alias para compatibilidade (sempre igual a workDate)
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
  isOvertimeCard?: boolean;
  cardNumber?: string;
  month?: string;
  year?: number;
  frontImage?: string;
  backImage?: string;
}

export interface PontoData {
  entries: TimeEntry[];
  month?: string;
  year?: number;
  employeeName?: string;
  employeeCode?: string;
  role?: string;
  location?: string;
  companyName?: string;
  companyCnpj?: string;
  cardNumber?: string;
  isOvertimeCard?: boolean;
  frontImage?: string;
  backImage?: string;
}

const SYSTEM_PROMPT = `Voce e um leitor de cartao de ponto brasileiro com foco em precisao.
Analise a imagem e extraia os dados seguindo as regras abaixo.

### REGRAS CRITICAS DE ANTI-ALUCINACAO:
- NUNCA invente informacoes. Se um campo nao estiver legivel, use null ou "".
- Proibido inventar nome de funcionario.
- Horarios devem estar em HH:MM. Se ilegivel, use "".

### EXTRACAO DO CABECALHO:
Extraia do topo do cartao:
- companyName
- companyCnpj
- employeeName
- employeeCode
- role
- location
- month (MM)
- year (numero)
- cardNumber

### DETECCAO DE TIPO DE CARTAO:
- Se houver indicacao de "Hora Extras", usar "isOvertimeCard": true.
- Caso contrario, "isOvertimeCard": false.
- Este campo deve ser booleano.

### EXTRACAO DOS DIAS:
- O cartao sempre tem 31 linhas (01 a 31).
- Colunas: manha (entrada/saida), tarde (entrada/saida), extra (entrada/saida).
- Extraia horarios em HH:MM.
- Para dia sem marcacao, deixar campos de horario vazios.
- Ignore colunas de total manual ou colunas auxiliares de HE.
- Retorne exatamente 31 itens em "entries".

### REGRA PARA ANOTACOES MANUAIS (MUITO IMPORTANTE):
- Nao confundir anotacoes manuscritas/carimbos/observacoes com marcacoes de ponto.
- Exemplos de anotacao: "falta", "atestado", "folga", "abono", "DSR", "ferias", rubricas, assinaturas, circulos, riscos, somatórios de horas,1h ,2.55 , 3,55.
- Texto livre, siglas ou observacoes NUNCA devem virar horario.
- Se houver apenas anotacao no dia e nenhuma marcacao valida, manter todos os horarios como "".
- Quando identificar anotacao relacionada ao dia, marcar "isDPAnnotation": true nesse item.
- So preencher campos de horario quando houver valor claramente no formato de marcacao de ponto (HH:MM).

REGRA DE VIRADA DE DIA:
- Se entrada ocorreu em um dia e saida no dia seguinte, use saida vazia no dia da entrada.
- Se saida ocorreu no dia atual e a entrada foi no dia anterior, use entrada vazia no dia da saida.

### FORMATO DE SAIDA:
Retorne JSON puro com:
- companyName, companyCnpj, employeeName, employeeCode, role, location, month, year, cardNumber, isOvertimeCard
- entries: array com objetos contendo:
  workDate, day, entry1, exit1, entry2, exit2, entryExtra, exitExtra, totalHours, isDPAnnotation

REGRAS ADICIONAIS:
1. "workDate" deve ser montado com mes/ano de referencia e dia da linha.
2. Se ciclo > 1, dias maiores que o inicio do ciclo pertencem ao mes anterior da referencia.
3. "day" deve ser de "01" a "31".
4. "totalHours" deve vir sempre como "".
5. Se houver duas imagens, consolidar em uma unica lista de 31 dias.
6. Validacao final: "entries" precisa ter exatamente 31 elementos.`;

export async function listGeminiModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  if (!apiKey) return [];
  try {
    const ai = new GoogleGenAI({ apiKey });
    // In @google/genai v1.29.0, listModels is ai.models.list()
    const result = await ai.models.list();
    // result is a Pager<Model>. We can get the current page via result.page
    const models = result.page || [];
    // Filter for models that support generating content
    return models
      .filter(m => m.supportedActions?.includes("generateContent") || m.name?.includes("gemini"))
      .map(m => ({ id: m.name || "", name: m.displayName || m.name || "" }));
  } catch (e) {
    console.error("Failed to list Gemini models", e);
    return [];
  }
}

export async function listOpenAIModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  if (!apiKey) return [];
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    // Filter for chat models
    return (data.data || [])
      .filter((m: any) => m.id.startsWith("gpt-"))
      .map((m: any) => ({ id: m.id, name: m.id.toUpperCase() }));
  } catch (e) {
    console.error("Failed to list OpenAI models", e);
    return [];
  }
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isGeminiUnavailableError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return (
    text.includes("status\":\"unavailable") ||
    text.includes("unavailable") ||
    text.includes("high demand") ||
    text.includes("experiencing high demand") ||
    text.includes("503")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseWithGemini(
  images: string[],
  settings: Settings
): Promise<PontoData> {
  const apiKey = settings.geminiApiKey || "";
  const modelName = settings.geminiModel || "gemini-3-flash-preview";
  if (!apiKey) {
    throw new Error("Chave de API Gemini nao configurada.");
  }
  const ai = new GoogleGenAI({ apiKey });
  const imageParts = images.map(img => ({
    inlineData: {
      mimeType: "image/jpeg",
      data: img.split(",")[1] || img,
    },
  }));
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            parts: [
              {
                text: `CONTEXTO DO USUARIO: Inicio do Ciclo de Fechamento: Dia ${settings.cycleStartDay || 15}\n\n` + SYSTEM_PROMPT,
              },
              ...imageParts,
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companyName: { type: Type.STRING },
              companyCnpj: { type: Type.STRING },
              employeeName: { type: Type.STRING },
              employeeCode: { type: Type.STRING },
              role: { type: Type.STRING },
              location: { type: Type.STRING },
              month: { type: Type.STRING },
              year: { type: Type.NUMBER },
              cardNumber: { type: Type.STRING },
              isOvertimeCard: { type: Type.BOOLEAN },
              entries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    workDate: { type: Type.STRING },
                    day: { type: Type.STRING },
                    entry1: { type: Type.STRING },
                    exit1: { type: Type.STRING },
                    entry2: { type: Type.STRING },
                    exit2: { type: Type.STRING },
                    entryExtra: { type: Type.STRING },
                    exitExtra: { type: Type.STRING },
                    totalHours: { type: Type.STRING },
                    isDPAnnotation: { type: Type.BOOLEAN }
                  },
                  required: ["workDate", "day", "entry1", "exit1", "entry2", "exit2", "entryExtra", "exitExtra", "totalHours"],
                },
              },
            },
            required: ["entries"],
          },
        },
      });
      return JSON.parse(response.text || "{}") as PontoData;
    } catch (error) {
      if (!isGeminiUnavailableError(error) || attempt === maxAttempts) {
        throw error;
      }
      const backoffMs = Math.min(8000, 700 * (2 ** (attempt - 1)));
      await sleep(backoffMs);
    }
  }
  throw new Error("Falha inesperada ao processar com Gemini.");
}
async function parseWithOpenAI(
  images: string[],
  settings: Settings,
  isCodex: boolean = false
): Promise<PontoData> {
  const apiKey = isCodex ? settings.codexApiKey : settings.openaiApiKey;
  const modelName = isCodex ? settings.codexModel : settings.openaiModel;

  if (!apiKey) {
    throw new Error(`Chave de API ${isCodex ? 'Codex' : 'OpenAI'} nao configurada.`);
  }

  const imageContent = images.map(img => ({
    type: "image_url",
    image_url: {
      url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`
    }
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName || "gpt-4o",
      messages: [
        {
          role: "system",
          content: `CONTEXTO DO USUARIO: Inicio do Ciclo de Fechamento: Dia ${settings.cycleStartDay || 15}\n\n` + SYSTEM_PROMPT
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract data from these point card images (front and/or back)."
            },
            ...imageContent
          ]
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI Error: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json();
  const content = result.choices[0]?.message?.content;
  return JSON.parse(content || "{}") as PontoData;
}

type AIProvider = Settings['aiProvider'];
type ParseStrategy = (images: string[], settings: Settings) => Promise<PontoData>;

const parseStrategies: Record<AIProvider, ParseStrategy> = {
  gemini: (images, settings) => parseWithGemini(images, settings),
  openai: (images, settings) => parseWithOpenAI(images, settings, false),
  codex: (images, settings) => parseWithOpenAI(images, settings, true)
};

function getGeminiFallbackStrategies(settings: Settings): Array<{ provider: AIProvider; parse: ParseStrategy }> {
  const fallbacks: Array<{ provider: AIProvider; parse: ParseStrategy }> = [];
  if (settings.openaiApiKey) fallbacks.push({ provider: 'openai', parse: parseStrategies.openai });
  if (settings.codexApiKey) fallbacks.push({ provider: 'codex', parse: parseStrategies.codex });
  return fallbacks;
}

export async function parsePontoImage(
  images: string[], 
  settings?: Settings,
  forceIsOvertime?: boolean
): Promise<PontoData> {
  if (!settings) {
    throw new Error("Configuracoes nao fornecidas.");
  }

  try {
    const provider = settings.aiProvider || 'gemini';
    const primaryStrategy = parseStrategies[provider];
    let result: PontoData;

    if (provider !== 'gemini') {
      result = await primaryStrategy(images, settings);
    } else {
      try {
        result = await primaryStrategy(images, settings);
      } catch (geminiError) {
        if (isGeminiUnavailableError(geminiError)) {
          const fallbacks = getGeminiFallbackStrategies(settings);
          if (fallbacks.length === 0) {
            throw new Error("Gemini indisponível no momento (alta demanda). Tente novamente em alguns instantes.");
          }

          const fallback = fallbacks[0];
          console.warn(`Gemini indisponível. Fazendo fallback para ${fallback.provider.toUpperCase()}.`);
          result = await fallback.parse(images, settings);
        } else {
          throw geminiError;
        }
      }
    }

    if (forceIsOvertime !== undefined) {
      result.isOvertimeCard = forceIsOvertime;
    }
    return result;
  } catch (e: any) {
    console.error("Failed to parse images with " + settings.aiProvider, e);
    throw new Error(e.message || "Nao foi possivel processar as imagens do cartao de ponto.");
  }
}

