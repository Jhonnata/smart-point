import {GoogleGenAI, Type} from "@google/genai";
import type {Settings} from "../lib/calculations";

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
    annotationText?: string;
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

const SYSTEM_PROMPT = `Voce e um extrator de dados de cartao de ponto brasileiro.
Seu objetivo e ler a imagem e retornar um JSON exato, sem inventar informacoes.

REGRAS PRINCIPAIS:
- Prioridade maxima: precisao.
- Se estiver em duvida, deixe vazio.
- Nunca invente nome, codigo, horario, data ou texto.
- Nunca estimar horarios parcialmente legiveis.
- Nunca completar digitos faltantes por suposicao.
- Horarios validos devem estar claramente no formato HH:MM.
- Se nao estiver claramente em HH:MM, retorne "".
- Preserve exatamente os digitos visiveis do horario.
- Nao arredonde horario.
- Nao transponha digitos.
- Nao troque 23 por 19, 50 por 09, 02 por 00 ou valores parecidos.
- Se a imagem mostrar 21:02, retorne 21:02.
- Se a imagem mostrar 23:50, retorne 23:50.
- O json deve ser ordenado do dia 01 -> 31.

REGRA DE CERTEZA VISUAL (CRITICA):
- Um horario so pode ser extraido se TODOS os digitos estiverem claramente legiveis.
- Se QUALQUER digito estiver ambiguo (ex: pode ser 1 ou 7, 2 ou 3), descarte completamente o horario.
- Nao tente interpretar, deduzir ou escolher o mais provavel.

REGRA DE BLOQUEIO DE INFERENCIA (CRITICA):
- E proibido inferir horarios com base em contexto, padrao, dias vizinhos ou comportamento humano.
- Cada dia deve ser interpretado de forma completamente isolada.

REGRA DE POSICAO (CRITICA):
- Um horario so pode ser considerado valido se estiver alinhado horizontalmente com as colunas do cartao.
- Horarios fora do alinhamento das colunas devem ser ignorados.
- Escritas inclinadas, deslocadas ou fora da grade nao sao horarios validos.

REGRA DE INTEGRIDADE DA LINHA:
- Nunca misturar horarios de linhas diferentes.
- Cada linha deve ser processada isoladamente com base no numero do dia impresso.

REGRA DE CONFLITO VISUAL:
- Se houver sobreposicao, borrado, sombra ou duplicidade de tinta que gere duvida, o horario deve ser descartado.

REGRA DE CONSISTENCIA DE COLUNAS:
- Cada linha pode conter no maximo:
  - 2 horarios (manha)
  - 2 horarios (tarde)
  - 2 horarios (extra)
- Nunca adicionar horarios alem dessas colunas.

REGRA DE NAO CONFIAR EM CORRECOES EXTERNAS:
- Nao utilizar informacoes fornecidas posteriormente pelo usuario para corrigir horarios.
- Apenas a imagem deve ser considerada fonte de verdade.

CABECALHO A EXTRAIR:
- companyName
- companyCnpj
- employeeName
- employeeCode
- role
- location
- month
- year
- cardNumber

TIPO DE CARTAO:
- Se houver indicacao clara de "hora extra", "horas extras", "he", "h. extra" ou equivalente, use "isOvertimeCard": true.
- Caso contrario, use "isOvertimeCard": false.
- Este campo deve ser booleano.

ESTRUTURA DO CARTAO:
- O cartao possui sempre 31 linhas, de 01 a 31.
- Cada linha representa o dia impresso no cartao.
- O campo principal da linha e "day".
- Retorne exatamente 31 itens em "entries".
- Se uma linha estiver vazia, ela ainda precisa existir no array.

CAMPOS DE CADA LINHA:
- day
- workDate
- entry1
- exit1
- entry2
- exit2
- entryExtra
- exitExtra
- totalHours
- isDPAnnotation
- annotationText

REGRAS PARA AS MARCACOES:
- Use apenas marcacoes reais do cartao.
- Considere somente as colunas de ponto:
  - manha: entrada e saida
  - tarde: entrada e saida
  - extra: entrada e saida
- Nao usar colunas de total, saldo, banco, observacao, rubrica, somatorio ou campos auxiliares.
- Nao calcular "totalHours". Sempre retornar "".
- Se houver apenas parte da marcacao visivel, extraia apenas o que estiver claramente legivel e deixe o restante vazio.
- Nao inferir virada de dia. Nao inventar entrada/saida do dia anterior ou do dia seguinte.
- Em muitos cartoes, o numero do dia aparece impresso no inicio da linha, antes do primeiro horario.
- Esse numero do dia NAO faz parte do horario.
- Exemplo: em uma linha do dia 06, a leitura "06 21:02 23:50" significa dia 06 com horarios 21:02 e 23:50.
- Nunca use o numero do dia para formar horario.
- Horarios impressos em matriz/pontilhado cinza continuam sendo horarios validos se estiverem legiveis.
- Numeros manuscritos na lateral direita, no rodape ou fora das 6 colunas principais geralmente NAO sao horarios de ponto.
- Valores como "1,32", "5,11", "6,54", "1.30", "0.38", "19,79" devem ser tratados como anotacao, nunca como horario.
- Em cartao de horas extras, prefira horarios dentro da area de colunas do cartao; nao use totais manuscritos laterais como entrada/saida.

ANOTACOES MANUAIS:
- Nao confundir anotacoes manuscritas, carimbos, observacoes ou rabiscos com marcacoes de ponto.
- Exemplos de anotacao que NAO sao horario:
  - falta
  - atestado
  - folga
  - abono
  - dsr
  - ferias
  - assinaturas
  - rubricas
  - circulos
  - riscos
  - somatorios
  - "1h"
  - "2,55"
  - "3,55"
- Se existir anotacao relacionada ao dia, marque "isDPAnnotation": true.
- Se houver texto de anotacao legivel relacionado ao dia, preencha "annotationText" com esse texto.
- Se nao houver texto legivel, use "annotationText": "".
- Se houver apenas anotacao e nenhuma marcacao valida, todos os horarios daquele dia devem ficar "".
- Se a palavra manuscrita for apenas "DOMINGO", "domingo", "FERIADO" ou "feriado", nao trate isso como observacao detalhada.
- Nesses casos, preencha "annotationText" com o proprio rotulo visivel ("DOMINGO" ou "FERIADO") e nao invente texto adicional.
- Se houver outras anotacoes manuscritas em lapis ou caneta no dia, elas devem ir para "annotationText".

REGRAS DE DATA:
- "day" deve ser sempre de "01" a "31".
- "month" deve vir em MM.
- "year" deve vir numerico.
- "workDate" pode ser montado usando o mes/ano de referencia e o dia da linha.
- Se o ciclo informado for maior que 1, dias maiores que o inicio do ciclo pertencem ao mes anterior da referencia.
- Se houver duvida sobre a data completa, preserve o "day" correto e monte "workDate" usando a regra do ciclo.

MULTIPLAS IMAGENS:
- Se houver duas imagens, combine frente e verso em uma unica resposta.
- O resultado final continua sendo um unico array com 31 linhas.
- Nao duplicar dias.

SAIDA OBRIGATORIA:
- Retorne JSON puro, sem markdown, sem comentario, sem explicacao.
- Estrutura:
  - companyName
  - companyCnpj
  - employeeName
  - employeeCode
  - role
  - location
  - month
  - year
  - cardNumber
  - isOvertimeCard
  - entries
   

VALIDACAO FINAL ANTES DE RESPONDER:
- O JSON precisa ser valido.
- "entries" precisa ter exatamente 31 elementos.
- Cada elemento precisa ter "day" de 01 a 31.
- "totalHours" deve ser sempre "".
- Nenhum horario pode ser inventado.`;


function normalizeAnnotationText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizePontoData(result: PontoData, forceIsOvertime?: boolean): PontoData {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const sanitizedEntries = entries.map((entry, index) => {
        const annotationText = normalizeAnnotationText((entry as any)?.annotationText);
        const normalized: TimeEntry = {
            ...entry,
            id: entry?.id || `ocr-${String(entry?.day || index + 1).padStart(2, '0')}`,
            workDate: String(entry?.workDate || entry?.date || ''),
            date: String(entry?.date || entry?.workDate || ''),
            day: String(entry?.day || '').padStart(2, '0'),
            entry1: String(entry?.entry1 || ''),
            exit1: String(entry?.exit1 || ''),
            entry2: String(entry?.entry2 || ''),
            exit2: String(entry?.exit2 || ''),
            entryExtra: String(entry?.entryExtra || ''),
            exitExtra: String(entry?.exitExtra || ''),
            totalHours: '',
            isDPAnnotation: !!entry?.isDPAnnotation,
            annotationText,
        };
        return normalized;
    });

    return {
        ...result,
        isOvertimeCard: forceIsOvertime !== undefined ? forceIsOvertime : !!result.isOvertimeCard,
        entries: sanitizedEntries
    };
}

export async function listGeminiModels(apiKey: string): Promise<{ id: string; name: string }[]> {
    if (!apiKey) return [];
    try {
        const ai = new GoogleGenAI({apiKey});
        // In @google/genai v1.29.0, listModels is ai.models.list()
        const result = await ai.models.list();
        // result is a Pager<Model>. We can get the current page via result.page
        const models = result.page || [];
        // Filter for models that support generating content
        return models
            .filter(m => m.supportedActions?.includes("generateContent") || m.name?.includes("gemini"))
            .map(m => ({id: m.name || "", name: m.displayName || m.name || ""}));
    } catch (e) {
        console.error("Failed to list Gemini models", e);
        return [];
    }
}

export async function listOpenAIModels(apiKey: string): Promise<{ id: string; name: string }[]> {
    if (!apiKey) return [];
    try {
        const response = await fetch("https://api.openai.com/v1/models", {
            headers: {"Authorization": `Bearer ${apiKey}`}
        });
        if (!response.ok) return [];
        const data = await response.json();
        // Filter for chat models
        return (data.data || [])
            .filter((m: any) => m.id.startsWith("gpt-"))
            .map((m: any) => ({id: m.id, name: m.id.toUpperCase()}));
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

function inferMimeTypeFromUrl(url: string): string {
    const normalized = url.toLowerCase();
    if (normalized.includes('.png')) return 'image/png';
    if (normalized.includes('.webp')) return 'image/webp';
    if (normalized.includes('.gif')) return 'image/gif';
    return 'image/jpeg';
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

async function normalizeImageForGemini(image: string): Promise<{ mimeType: string; data: string }> {
    const raw = String(image || '').trim();
    if (!raw) throw new Error('Imagem vazia para OCR.');

    if (raw.startsWith('data:')) {
        const match = raw.match(/^data:(.*?);base64,(.*)$/);
        if (!match) throw new Error('Imagem data URL invalida para OCR.');
        return {
            mimeType: match[1] || 'image/jpeg',
            data: match[2] || '',
        };
    }

    if (/^https?:\/\//i.test(raw)) {
        const response = await fetch(raw);
        if (!response.ok) {
            throw new Error(`Falha ao baixar imagem do Storage (${response.status}).`);
        }
        const buffer = await response.arrayBuffer();
        const mimeType = response.headers.get('content-type') || inferMimeTypeFromUrl(raw);
        return {
            mimeType,
            data: bytesToBase64(new Uint8Array(buffer)),
        };
    }

    return {
        mimeType: 'image/jpeg',
        data: raw,
    };
}

function normalizeImageForOpenAI(image: string): string {
    const raw = String(image || '').trim();
    if (!raw) throw new Error('Imagem vazia para OCR.');
    if (raw.startsWith('data:')) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return `data:image/jpeg;base64,${raw}`;
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
    const ai = new GoogleGenAI({apiKey});
    const normalizedImages = await Promise.all(images.map((img) => normalizeImageForGemini(img)));
    const imageParts = normalizedImages.map((img) => ({
        inlineData: {
            mimeType: img.mimeType,
            data: img.data,
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
                            companyName: {type: Type.STRING},
                            companyCnpj: {type: Type.STRING},
                            employeeName: {type: Type.STRING},
                            employeeCode: {type: Type.STRING},
                            role: {type: Type.STRING},
                            location: {type: Type.STRING},
                            month: {type: Type.STRING},
                            year: {type: Type.NUMBER},
                            cardNumber: {type: Type.STRING},
                            isOvertimeCard: {type: Type.BOOLEAN},
                            entries: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        workDate: {type: Type.STRING},
                                        day: {type: Type.STRING},
                                        entry1: {type: Type.STRING},
                                        exit1: {type: Type.STRING},
                                        entry2: {type: Type.STRING},
                                        exit2: {type: Type.STRING},
                                        entryExtra: {type: Type.STRING},
                                        exitExtra: {type: Type.STRING},
                                        totalHours: {type: Type.STRING},
                                        isDPAnnotation: {type: Type.BOOLEAN},
                                        annotationText: {type: Type.STRING}
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
            url: normalizeImageForOpenAI(img)
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
            response_format: {type: "json_object"}
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
    if (settings.openaiApiKey) fallbacks.push({provider: 'openai', parse: parseStrategies.openai});
    if (settings.codexApiKey) fallbacks.push({provider: 'codex', parse: parseStrategies.codex});
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

        return sanitizePontoData(result, forceIsOvertime);
    } catch (e: any) {
        console.error("Failed to parse images with " + settings.aiProvider, e);
        throw new Error(e.message || "Nao foi possivel processar as imagens do cartao de ponto.");
    }
}

