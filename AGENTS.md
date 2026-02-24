# AGENTS.md

## 1) Objetivo deste repositorio
`smart-point` e um sistema de leitura e gestao de cartao de ponto com:
- Frontend React (Vite) para upload, conferencia e resumo financeiro.
- Backend Express + SQLite (`better-sqlite3`) no arquivo [`server.ts`](/d:/REACT/smart-point/server.ts).
- Integracao com IA (Gemini/OpenAI/Codex) para OCR estruturado de cartoes em [`src/services/aiService.ts`](/d:/REACT/smart-point/src/services/aiService.ts).

O foco do produto e:
- Importar cartoes (normal e horas extras).
- Persistir por competencia (mes/ano) com snapshot de metadados.
- Calcular banco de horas, atrasos, extras, DSR e holerite estimado.

## 2) Stack e runtime
- Node.js: `v22.19.0`
- npm: `10.9.3`
- Frontend: React 19 + Vite 6 + Tailwind 4 + Recharts + Sonner + date-fns
- Backend: Express 4 + better-sqlite3
- Linguagem: TypeScript em frontend e backend
- Banco local: `ponto.db` (SQLite)

Arquivos base:
- [`package.json`](/d:/REACT/smart-point/package.json)
- [`vite.config.ts`](/d:/REACT/smart-point/vite.config.ts)
- [`tsconfig.json`](/d:/REACT/smart-point/tsconfig.json)

## 3) Estrutura do projeto
- `src/`
- `src/App.tsx`: shell principal, navegacao por hash, estado global e chamadas da API.
- `src/components/`: views e componentes de negocio (`UploadView`, `DualCardView`, `SummaryView`, `DashboardView`, etc).
- `src/lib/calculations.ts`: calculo de extras/banco.
- `src/lib/payroll.ts`: calculo de holerite completo (INSS/IR/DSR/adiantamento).
- `src/services/aiService.ts`: OCR via Gemini/OpenAI/Codex.
- `server.ts`: schema, migracoes, API REST e server Vite/SPA.
- `database/database.sql`: schema de referencia.
- `check_db.cjs`: script utilitario para inspecionar tabelas/colunas/quantidades.
- `img/`: imagens e PDF de exemplo.

## 4) Como rodar
### Desenvolvimento
1. Instalar dependencias:
   - `npm.cmd install`
2. Rodar backend+frontend (via Vite middleware):
   - `npm.cmd run dev`
3. Acessar:
   - `http://localhost:3000`

### Build
- `npm.cmd run build`

### Typecheck
- `npm.cmd run lint`

Observacao Windows:
- No PowerShell, `npm` pode falhar por policy (`npm.ps1` bloqueado). Use `npm.cmd`.

## 5) Estado atual de qualidade (importante)
- Typecheck atual:
  - `npm.cmd run lint` (tsc --noEmit) passando.
- Principio de consistencia:
  - Nao usar endpoint legado `/api/entries`.
  - Persistencia oficial via `/api/holeriths` + `/api/referencia/:ref`.

## 6) Backend: modelo de dados e regras
Schema e migracoes vivem em [`server.ts`](/d:/REACT/smart-point/server.ts).

Tabelas principais:
- `companies`
- `employees`
- `holeriths` (snapshot por funcionario/mes/ano)
- `marcacoes` (`normal` e `overtime`)
- `entries` (linhas dia a dia)
- `settings` (config global do app e chaves de IA)
- `banco_horas`

Regras de negocio relevantes:
- Sempre trabalhar com 31 linhas por cartao (dias `01..31`).
- Separacao forte entre cartao `normal` e `overtime`.
- `cycleStartDay` controla virada de competencia:
  - Se `cycleStartDay > 1`, dias maiores que o ciclo pertencem ao mes anterior.
- Banco de horas e recalculado no backend no salvamento.
- `settings.id = 1` e singleton de configuracao global.
- A API oficial de dados de cartao e:
  - listagem de competencias: `/api/holeriths`
  - detalhe/salvamento por competencia: `/api/referencia/:ref`

## 7) Backend: rotas HTTP
Rotas em [`server.ts`](/d:/REACT/smart-point/server.ts):
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/holeriths`
- `GET /api/banco-horas`
- `POST /api/banco-horas`
- `DELETE /api/banco-horas/:id`
- `GET /api/referencia/:ref` (`MMYYYY`)
- `POST /api/referencia/:ref` (`MMYYYY`)
- `DELETE /api/referencia/:ref?type=normal|overtime|all`
- `DELETE /api/referencias`

## 8) Frontend: fluxo funcional
Tela principal em [`src/App.tsx`](/d:/REACT/smart-point/src/App.tsx) com views:
- `dashboard`
- `resumo`
- `card`
- `card-list`
- `upload`
- `settings`

Fluxo de uso:
1. Usuario configura dados e provedor IA em `settings`.
2. Usuario envia frente/verso no `upload`.
3. `parsePontoImage()` extrai metadados + 31 entradas.
4. App combina com cartao do outro tipo (normal/overtime) e salva via `POST /api/referencia/:ref`.
5. Dashboard/resumo leem dados consolidados por referencia.

## 9) IA e OCR
Implementacao em [`aiService.ts`](/d:/REACT/smart-point/src/services/aiService.ts):
- Provedores suportados: `gemini`, `openai`, `codex`.
- Prompt exige:
  - nao inventar campos
  - retornar 31 linhas
  - detectar `isOvertimeCard`
  - respeitar `cycleStartDay`
- Modelos dinamicos:
  - Gemini via SDK `@google/genai`
  - OpenAI via `GET /v1/models`

## 10) Convencoes para futuras alteracoes
### 10.1 Alterar schema/settings
Quando adicionar campo novo em `settings`, atualizar obrigatoriamente:
1. `CREATE TABLE settings` em [`server.ts`](/d:/REACT/smart-point/server.ts)
2. Migracao `requiredSettings` em [`server.ts`](/d:/REACT/smart-point/server.ts)
3. `POST /api/settings` (desestruturacao + update SQL)
4. Interface `Settings` em [`src/lib/calculations.ts`](/d:/REACT/smart-point/src/lib/calculations.ts)
5. UI em [`SettingsView.tsx`](/d:/REACT/smart-point/src/components/SettingsView.tsx)

### 10.2 Alterar entries/cartao
Se mudar campos de marcacao:
1. Tabela `entries` no backend.
2. Endpoints `/api/referencia`.
3. Tipos `TimeEntry` em:
   - [`src/services/aiService.ts`](/d:/REACT/smart-point/src/services/aiService.ts)
   - [`src/lib/calculations.ts`](/d:/REACT/smart-point/src/lib/calculations.ts)
4. Views de edicao/render:
   - [`DualCardView.tsx`](/d:/REACT/smart-point/src/components/DualCardView.tsx)
   - [`DigitalCardView.tsx`](/d:/REACT/smart-point/src/components/DigitalCardView.tsx)
   - [`UploadView.tsx`](/d:/REACT/smart-point/src/components/UploadView.tsx)

### 10.3 Regras que NAO devem ser quebradas
- Nao reduzir o array de dias para menos de 31 no fluxo de cartao.
- Nao misturar cartao `normal` e `overtime` no mesmo tipo.
- Nao apagar dados em massa fora de operacoes explicitamente solicitadas.

## 11) Variaveis e configuracao
Arquivo exemplo: [`.env.example`](/d:/REACT/smart-point/.env.example)
- `GEMINI_API_KEY`
- `APP_URL`

Observacao:
- Na pratica, as chaves usadas em runtime ficam salvas em `settings` no SQLite (via tela de configuracoes), nao apenas no `.env`.

## 12) Debug e operacao local
- Inspecao rapida do banco:
  - `node check_db.cjs`
- Conferir colunas:
  - `PRAGMA table_info(<tabela>)`
- Conferir rotas com logs:
  - `server.ts` possui `console.log` em endpoints principais.

## 13) Diretrizes para agentes
- Ler primeiro:
  - [`server.ts`](/d:/REACT/smart-point/server.ts)
  - [`src/App.tsx`](/d:/REACT/smart-point/src/App.tsx)
  - [`src/lib/calculations.ts`](/d:/REACT/smart-point/src/lib/calculations.ts)
  - [`src/lib/payroll.ts`](/d:/REACT/smart-point/src/lib/payroll.ts)
- Antes de alterar regra financeira, validar impacto em:
  - resumo financeiro
  - dashboard
  - persistencia de banco_horas
- Sempre executar typecheck (`npm.cmd run lint`) apos mudancas.
- Se mexer em rotas/contratos, atualizar todos os consumidores frontend.
- Preservar compatibilidade com dados existentes no `ponto.db`.

## 14) Backlog tecnico recomendado
- Corrigir bug `np` em `DualCardView`.
- Revisar encoding de strings PT-BR com caracteres corrompidos em alguns arquivos.
- Ajustar script `clean` para ambiente Windows (atualmente usa `rm -rf`).
- Criar suite minima de testes (calculos e rotas criticas).

## 15) Regras de negocio detalhadas
### 15.1 Competencia e referencia
- A referencia da API deve ser sempre `MMYYYY` em `/api/referencia/:ref`.
- O frontend usa `YYYY-MM` para selecao de competencia e converte para `MMYYYY` ao chamar a API.
- O sistema considera um ciclo mensal de 31 linhas de cartao (`01..31`) independentemente do mes calendario.

### 15.2 Regra de ciclo (`cycleStartDay`)
- Se `cycleStartDay <= 1`, os dias pertencem ao proprio mes de referencia.
- Se `cycleStartDay > 1`, dias `> cycleStartDay` pertencem ao mes anterior.
- Essa regra deve ser aplicada de forma consistente em:
  - OCR/normalizacao do upload.
  - montagem de payload para salvar.
  - `GET /api/referencia/:ref`.
  - views de conferencia manual.

### 15.3 Tipos de cartao
- Existem apenas dois tipos validos de marcacao: `normal` e `overtime`.
- Dados de `normal` e `overtime` devem ser armazenados separadamente na tabela `marcacoes`.
- Nao misturar os dois tipos no mesmo conjunto de `entries`.
- No upload de um tipo, o outro tipo da mesma competencia deve ser preservado.

### 15.4 Persistencia e snapshot
- A entidade de competencia e `holerith` (unico por `employee_id + month + year`).
- Todo salvamento deve atualizar snapshots em `holeriths`:
  - `snapshot_employeeName`
  - `snapshot_employeeCode`
  - `snapshot_role`
  - `snapshot_location`
  - `snapshot_companyName`
  - `snapshot_companyCnpj`
  - `snapshot_cardNumber`
- Se empresa/funcionario nao existirem, devem ser criados por `INSERT OR IGNORE`.
- `settings.defaultEmployeeId` e `settings.defaultCompanyId` podem ser preenchidos automaticamente no primeiro salvamento valido.

### 15.5 Insercao e deduplicacao de entries
- Salvamento usa merge por `workDate` (preservacao por padrao).
- Campo preenchido no payload sobrescreve.
- Campo vazio no payload preserva valor existente (nao limpa).
- `isDPAnnotation` deve ser persistido explicitamente e retornado no `GET`.
- Entradas do payload devem ser deduplicadas por data (`workDate`/`date`), com "ultima ocorrencia vence".
- `UNIQUE(marcacao_id, workDate)` deve continuar valido apos qualquer alteracao.

### 15.6 Banco de horas (backend)
- O banco de horas e recalculado no backend no salvamento do cartao `normal`.
- Regras atuais:
  - Domingo (`getDay() === 0`): tudo que foi trabalhado entra como `extra`.
  - Dia util: `total > jornada` gera `extra` com diferenca.
  - Dia util: `0 < total < jornada` gera `atraso` com diferenca.
  - Dia util: `total == 0` e `jornada > 0` gera `atraso` (falta) com jornada completa.
- Compensacao de sabado (`saturdayCompensation`):
  - Dias em `compDays` recebem `+60` minutos na jornada.
  - Sabado (`getDay() === 6`) passa a jornada `0`.

### 15.7 Regras de calculo de extras (frontend)
- Valor hora: `baseSalary / monthlyHours`.
- Adicionais:
  - `HE 50%` usa `percent50`.
  - `HE 100%` usa `percent100`.
  - `HE 75% = HE 50% + adicional noturno`.
  - `HE 125% = HE 100% + adicional noturno`.
- Cartao `normal`:
  - excedente e contabilizado em banco de horas (nao pagamento direto).
- Cartao `overtime`:
  - jornada diaria considerada `0`, horas sao classificadas como extras pagas.
  - domingo: minuto noturno vira `125%`, diurno vira `100%`.
  - dias nao domingo: ate `weeklyLimit` usa `50%/75%`; acima do limite usa `100%/125%`.
  - noturno e detectado por `nightCutoff` ate `05:00`.

### 15.8 Regras de holerite (`payroll.ts`)
- DSR sobre extras: `valorDSR = (totalHorasExtras / diasUteis) * domingosEFeriados`.
- Considerar feriados fixos + moveis (pascoa/carnaval/sexta santa/corpus christi).
- INSS e IR seguem faixas codificadas no arquivo (nao inferir externamente).
- IR usa tabela tradicional e redutor mensal 2026 conforme implementado.
- Adiantamento:
  - quando nao informado, usa percentual configurado.
  - considera IR retido em adiantamento no fechamento.
- Liquido final do fechamento e diferente de liquido total recebido no mes (inclui adiantamento liquido).

### 15.9 Exclusao de dados
- `DELETE /api/referencia/:ref?type=normal|overtime` remove somente o tipo da competencia.
- `DELETE /api/referencia/:ref?type=all` remove toda competencia:
  - `entries`, `marcacoes`, `banco_horas`, `holerith`.
- `DELETE /api/referencias` remove tudo de:
  - `entries`, `marcacoes`, `banco_horas`, `holeriths`.
- Exclusao global nao remove `settings`, `companies` nem `employees`.

### 15.10 Compatibilidade e defaults
- `settings` e singleton (`id = 1`) e deve sempre existir.
- Defaults relevantes no sistema atual:
  - `aiProvider = gemini`
  - `geminiModel = gemini-3-flash-preview`
  - `cycleStartDay = 15`
  - `compDays = 1,2,3,4`
