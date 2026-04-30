# AGENTS.md

## 1) Objetivo deste repositorio
`smart-point` e um sistema de leitura e gestao de cartao de ponto com:
- Frontend React (Vite) para upload, conferencia e resumo financeiro.
- Persistência: Supabase (Frontend).

O foco do produto e:
- Importar cartoes (normal e horas extras).
- Persistir por competencia (mes/ano) com snapshot de metadados no Supabase.
- Calcular banco de horas, atrasos, extras, DSR e holerite estimado.

## 2) Stack e runtime
- Node.js: `v22.19.0`
- npm: `10.9.3`
- Frontend: React 19 + Vite 6 + Tailwind 4 + Recharts + Sonner + date-fns
- Linguagem: TypeScript
- Banco: Supabase (acesso direto via Frontend)

Arquivos base:
- [`package.json`](/d:/REACT/smart-point/package.json)
- [`vite.config.ts`](/d:/REACT/smart-point/vite.config.ts)
- [`tsconfig.json`](/d:/REACT/smart-point/tsconfig.json)

## 3) Estrutura do projeto
- `src/`
- `src/App.tsx`: shell principal, navegacao por hash, estado global e persistencia Supabase.
- `src/components/`: views e componentes de negocio (`UploadView`, `DualCardView`, `SummaryView`, `DashboardView`, etc).
- `src/lib/calculations.ts`: tipos centrais e lógica de cálculo.
- `src/lib/supabaseData.ts`: camada de persistência direta com Supabase.
- `src/lib/overtimeEngine.ts`: motor de classificação de horas extras.
- `src/lib/timeMath.ts`: operações de tempo.
- `src/lib/payroll.ts`: cálculo de holerite completo.
- `src/services/aiService.ts`: OCR via Gemini/OpenAI/Claude/Groq ou **IA Gratuita (Pollinations)**.
- `tests/`: suite de testes.

## 4) Como rodar
### Desenvolvimento
1. Instalar dependencias:
   - `npm.cmd install`
2. Rodar frontend (Vite):
   - `npm.cmd run dev`
3. Acessar:
   - `http://localhost:5173` (ou porta indicada pelo Vite)

### Build
- `npm.cmd run build`

### Typecheck
- `npm.cmd run lint`

### Testes
- `npm.cmd run test`
- `npm.cmd run test:vitest`

## 5) Arquitetura Backendless
O projeto não possui um servidor backend customizado. Toda a comunicação com o banco de dados e autenticação é feita diretamente do Frontend para o Supabase utilizando a biblioteca `@supabase/supabase-js`.

## 6) IA e OCR
Implementacao em [`aiService.ts`](/d:/REACT/smart-point/src/services/aiService.ts).

## 7) Convencoes
- Sempre usar `resolveEffectiveCalculationConfig(settings)` ao ler parâmetros de cálculo.
- O Frontend gerencia a persistência diretamente via Supabase (`src/lib/supabaseData.ts`).
- Não reduzir o array de dias para menos de 31 no fluxo de cartão.
- Preservar separação entre cartão `normal` e `overtime`.
