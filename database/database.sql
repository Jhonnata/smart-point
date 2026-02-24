PRAGMA foreign_keys = ON;

-- =========================================
-- DROP (ordem segura)
-- =========================================
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS marcacoes;
DROP TABLE IF EXISTS holeriths;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS settings;

-- =========================================
-- COMPANY
-- =========================================
CREATE TABLE companies (
                           id        INTEGER PRIMARY KEY,
                           name      TEXT NOT NULL,
                           cnpj      TEXT UNIQUE,
                           createdAt TEXT DEFAULT (datetime('now')),
                           updatedAt TEXT
);

CREATE INDEX idx_companies_name ON companies(name);

-- =========================================
-- EMPLOYEE (pessoa/funcionário)
-- =========================================
CREATE TABLE employees (
                           id         INTEGER PRIMARY KEY,
                           code       TEXT NOT NULL UNIQUE, -- employeeCode
                           name       TEXT NOT NULL,        -- employeeName
                           role       TEXT,
                           location   TEXT,
                           company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,

    -- se o cartão for "fixo" do funcionário, deixa aqui.
    -- se muda por mês, prefira usar holeriths.snapshot_cardNumber
                           cardNumber TEXT,

                           createdAt  TEXT DEFAULT (datetime('now')),
                           updatedAt  TEXT
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_employees_name ON employees(name);

-- =========================================
-- HOLERITH (um por mês/ano por funcionário)
-- =========================================
CREATE TABLE holeriths (
                           id          INTEGER PRIMARY KEY,
                           employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

                           month       INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  year        INTEGER NOT NULL,

  -- snapshot do mês (recomendado p/ histórico)
  snapshot_employeeName TEXT,
  snapshot_employeeCode TEXT,
  snapshot_role         TEXT,
  snapshot_location     TEXT,
  snapshot_companyName  TEXT,
  snapshot_companyCnpj  TEXT,
  snapshot_cardNumber   TEXT,

  createdAt   TEXT DEFAULT (datetime('now')),
  updatedAt   TEXT,

  UNIQUE(employee_id, month, year)
);

CREATE INDEX idx_holeriths_employee ON holeriths(employee_id);
CREATE INDEX idx_holeriths_month_year ON holeriths(year, month);

-- =========================================
-- MARCACOES (cartões do mês: normal / overtime)
-- =========================================
CREATE TABLE marcacoes (
                           id          INTEGER PRIMARY KEY,
                           holerith_id INTEGER NOT NULL REFERENCES holeriths(id) ON DELETE CASCADE,

                           type        TEXT NOT NULL CHECK(type IN ('normal', 'overtime')),
                           frontImage  TEXT,
                           backImage   TEXT,

                           createdAt   TEXT DEFAULT (datetime('now')),
                           updatedAt   TEXT,

                           UNIQUE(holerith_id, type)
);

CREATE INDEX idx_marcacoes_holerith ON marcacoes(holerith_id);

-- =========================================
-- ENTRIES (marcações diárias por cartão)
-- =========================================
CREATE TABLE entries (
                         id          TEXT PRIMARY KEY, -- UUID
                         marcacao_id INTEGER NOT NULL REFERENCES marcacoes(id) ON DELETE CASCADE,

                         workDate    TEXT NOT NULL, -- YYYY-MM-DD (recomendado)

                         entry1      TEXT,
                         exit1       TEXT,
                         entry2      TEXT,
                         exit2       TEXT,

    -- se seu cartão extra tiver um par específico, mantenha:
                         entryExtra  TEXT,
                         exitExtra   TEXT,

                         totalHours  REAL,  -- opcional (cache)
                         notes       TEXT,

                         createdAt   TEXT DEFAULT (datetime('now')),
                         updatedAt   TEXT,

                         UNIQUE(marcacao_id, workDate)
);

CREATE INDEX idx_entries_date ON entries(workDate);
CREATE INDEX idx_entries_marcacao_date ON entries(marcacao_id, workDate);

-- =========================================
-- SETTINGS (global do app)
-- Observação: se você quiser settings por funcionário,
-- crie employee_settings com employee_id e UNIQUE(employee_id)
-- =========================================
CREATE TABLE settings (
                          id                  INTEGER PRIMARY KEY,

                          baseSalary          REAL,
                          monthlyHours        INTEGER,
                          dailyJourney        REAL,
                          weeklyLimit         REAL,
                          nightCutoff         TEXT,

                          percent50           REAL,
                          percent100          REAL,
                          percent125          REAL,
                          percentNight        REAL DEFAULT 25,

                          aiProvider          TEXT DEFAULT 'gemini',
                          geminiApiKey        TEXT,
                          geminiModel         TEXT,
                          openaiApiKey        TEXT,
                          openaiModel         TEXT,
                          codexApiKey         TEXT,
                          codexModel          TEXT,

    -- defaults (opcional): se quiser preset pro próximo holerith
                          defaultEmployeeId   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
                          defaultCompanyId    INTEGER REFERENCES companies(id) ON DELETE SET NULL,

                          dependentes         INTEGER DEFAULT 0,
                          adiantamentoBruto   REAL    DEFAULT 0,
                          adiantamentoIR      REAL    DEFAULT 0,
                          adiantamentoPercent REAL    DEFAULT 40
);

CREATE INDEX idx_settings_defaultEmployeeId ON settings(defaultEmployeeId);
CREATE INDEX idx_settings_defaultCompanyId ON settings(defaultCompanyId);
