
# Smart Point

Sistema de leitura, conferencia e calculo de cartao de ponto com foco em fechamento mensal, horas extras e holerite estimado.

O projeto combina:
- frontend em React/Vite para conferencia manual, resumo e simulacao
- persistencia de dados no Supabase
- motor de calculo para banco de horas, extras, adicional noturno, DSR e descontos
- uso de IA para leitura estruturada de cartoes de ponto a partir de imagens

## O que o sistema faz

- importa cartoes normal e de horas extras
- separa os dois tipos de cartao por competencia
- aplica ciclo de fechamento configuravel via `cycleStartDay`
- calcula horas extras diurnas e noturnas
- calcula adicional noturno e reflexos de DSR
- gera visoes de resumo, detalhamento diario e holerite estimado
- permite editar configuracoes da empresa, regras e rubricas

## Leitura com IA

O sistema usa IA para transformar imagens do cartao em dados estruturados.

Fluxo principal:
1. o usuario envia frente e verso do cartao
2. a IA identifica cabecalho, funcionario, competencia e marcacoes dia a dia
3. o parser devolve sempre 31 linhas de cartao
4. o sistema separa cartao `normal` e cartao `overtime`
5. os dados ficam prontos para conferencia, ajuste manual e calculo

Provedores suportados:
- Gemini
- OpenAI
- Codex

A implementacao de OCR estruturado fica em [src/services/aiService.ts](src/services/aiService.ts).

## Fluxo funcional

1. configurar empresa, rubricas, salarios e parametros de calculo
2. configurar provedor de IA
3. enviar imagens do cartao
4. revisar o resultado extraido
5. salvar a competencia
6. acompanhar resumo financeiro, cartoes e projecoes

## Stack

- React 19
- Vite 6
- TypeScript
- Tailwind CSS
- Supabase
- Node.js

## Executar localmente

Pre-requisitos:
- Node.js
- credenciais do Supabase
- chave de IA para o provedor desejado

Instalacao:

```bash
npm.cmd install
```

Variaveis recomendadas em `.env.local`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...
```

Outras chaves podem ser configuradas pela tela de `Configuracoes`, conforme o provedor usado.

Executar em desenvolvimento:

```bash
npm.cmd run dev
```

Typecheck:

```bash
npm.cmd run lint
```

Testes:

```bash
npm.cmd run test
npm.cmd run test:vitest
```

## Estrutura principal

- `src/App.tsx`: shell principal, navegacao e carregamento de dados
- `src/components/`: telas de upload, cartao, resumo, dashboard e configuracoes
- `src/lib/overtimeEngine.ts`: motor de classificacao de horas extras
- `src/lib/payroll.ts`: calculo de holerite, DSR, INSS, IR e descontos
- `src/lib/calculations.ts`: tipos e funcoes compartilhadas
- `src/services/aiService.ts`: leitura de cartoes por IA

## Persistencia

O fluxo ativo do app deve usar Supabase para leitura e gravacao dos dados de negocio.

Variaveis obrigatorias:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

O frontend nao deve depender de fallback automatico para SQLite/API local para carregar ou salvar dados operacionais.

## Casos de uso principais

- fechamento de competencia com virada personalizada
- conferencia de cartao normal
- conferencia de cartao extra
- auditoria de horas noturnas
- simulacao de reflexos em folha
- comparacao entre cartao e holerite

## Observacoes

- o sistema trabalha com 31 linhas por cartao para manter compatibilidade com o layout dos espelhos de ponto
- `normal` e `overtime` sao tratados separadamente
- as regras de calculo devem ser centralizadas no motor compartilhado para evitar divergencia entre telas
