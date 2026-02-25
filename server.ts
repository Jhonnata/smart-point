import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";
import fs from "fs";

const dbPath = process.env.SQLITE_PATH || "ponto.db";
const dbDir = path.dirname(dbPath);
if (dbDir && dbDir !== "." && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Initialize database
db.exec(`PRAGMA foreign_keys = OFF;`);

// =========================================================
// SCHEMA MIGRATION: Drop and recreate tables if needed
// This ensures a clean, modern schema.
// =========================================================

// Check if entries table has legacy columns (pre-migration schema)
const existingEntryCols = db.prepare("PRAGMA table_info(entries)").all() as any[];
const hasLegacyCols = existingEntryCols.some(c => ['employeeName','employeeCode','companyName'].includes(c.name));

if (hasLegacyCols) {
  console.log("[MIGRATION] Detected legacy entries schema. Dropping and recreating tables...");
  db.exec(`
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS marcacoes;
    DROP TABLE IF EXISTS holeriths;
    DROP TABLE IF EXISTS banco_horas;
  `);
  console.log("[MIGRATION] Legacy tables dropped successfully.");
}

db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    cnpj      TEXT UNIQUE,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    role       TEXT,
    location   TEXT,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    cardNumber TEXT,
    createdAt  TEXT DEFAULT (datetime('now')),
    updatedAt  TEXT
  );

  CREATE TABLE IF NOT EXISTS holeriths (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month       INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    year        INTEGER NOT NULL,
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

  CREATE TABLE IF NOT EXISTS marcacoes (
    id          INTEGER PRIMARY KEY,
    holerith_id INTEGER NOT NULL REFERENCES holeriths(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK(type IN ('normal', 'overtime')),
    frontImage  TEXT,
    backImage   TEXT,
    createdAt   TEXT DEFAULT (datetime('now')),
    updatedAt   TEXT,
    UNIQUE(holerith_id, type)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id          TEXT PRIMARY KEY,
    marcacao_id INTEGER NOT NULL REFERENCES marcacoes(id) ON DELETE CASCADE,
    workDate    TEXT NOT NULL,
    entry1      TEXT,
    exit1       TEXT,
    entry2      TEXT,
    exit2       TEXT,
    entryExtra  TEXT,
    exitExtra   TEXT,
    totalHours  TEXT,
    notes       TEXT,
    isDPAnnotation INTEGER DEFAULT 0,
    createdAt   TEXT DEFAULT (datetime('now')),
    updatedAt   TEXT,
    UNIQUE(marcacao_id, workDate)
  );

  CREATE TABLE IF NOT EXISTS settings (
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
    defaultEmployeeId   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    defaultCompanyId    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    dependentes         INTEGER DEFAULT 0,
    adiantamentoBruto   REAL    DEFAULT 0,
    adiantamentoIR      REAL    DEFAULT 0,
    adiantamentoPercent REAL    DEFAULT 40,
    saturdayCompensation INTEGER DEFAULT 0,
    cycleStartDay       INTEGER DEFAULT 15,
    compDays            TEXT DEFAULT '1,2,3,4',
    workStart           TEXT DEFAULT '12:00',
    lunchStart          TEXT DEFAULT '17:00',
    lunchEnd            TEXT DEFAULT '18:00',
    workEnd             TEXT DEFAULT '21:00',
    saturdayWorkStart   TEXT DEFAULT '12:00',
    saturdayWorkEnd     TEXT DEFAULT '16:00'
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    displayName   TEXT,
    passwordHash  TEXT NOT NULL,
    createdAt     TEXT DEFAULT (datetime('now')),
    updatedAt     TEXT
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expiresAt   TEXT NOT NULL,
    createdAt   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS banco_horas (
    id          INTEGER PRIMARY KEY,
    holerith_id INTEGER REFERENCES holeriths(id) ON DELETE CASCADE,
    date        TEXT,
    minutes     REAL,
    type        TEXT DEFAULT 'extra',
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS simulator_plans (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL DEFAULT 0,
    reference   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    createdAt   TEXT DEFAULT (datetime('now')),
    updatedAt   TEXT,
    UNIQUE(employee_id, reference)
  );
`);

// Migration check for new settings columns
const settingsCols = db.prepare("PRAGMA table_info(settings)").all() as any[];
const settingsColNames = settingsCols.map(c => c.name);
const requiredSettings = [
  ['percentNight', "REAL DEFAULT 25"],
  ['aiProvider', "TEXT DEFAULT 'gemini'"],
  ['geminiApiKey', "TEXT"],
  ['geminiModel', "TEXT"],
  ['openaiApiKey', "TEXT"],
  ['openaiModel', "TEXT"],
  ['codexApiKey', "TEXT"],
  ['codexModel', "TEXT"],
  ['employeeName', "TEXT"],
  ['employeeCode', "TEXT"],
  ['role', "TEXT"],
  ['location', "TEXT"],
  ['companyName', "TEXT"],
  ['companyCnpj', "TEXT"],
  ['cardNumber', "TEXT"],
  ['dependentes', "INTEGER DEFAULT 0"],
  ['adiantamentoPercent', "REAL DEFAULT 45"],
  ['adiantamentoIR', "REAL DEFAULT 0"],
  ['saturdayCompensation', "INTEGER DEFAULT 0"],
  ['cycleStartDay', "INTEGER DEFAULT 15"],
  ['compDays', "TEXT DEFAULT '1,2,3,4'"],
  ['workStart', "TEXT DEFAULT '12:00'"],
  ['lunchStart', "TEXT DEFAULT '17:00'"],
  ['lunchEnd', "TEXT DEFAULT '18:00'"],
  ['workEnd', "TEXT DEFAULT '21:00'"],
  ['saturdayWorkStart', "TEXT DEFAULT '12:00'"],
  ['saturdayWorkEnd', "TEXT DEFAULT '16:00'"],
  ['defaultEmployeeId', "INTEGER REFERENCES employees(id) ON DELETE SET NULL"],
  ['defaultCompanyId', "INTEGER REFERENCES companies(id) ON DELETE SET NULL"]
];

for (const [name, type] of requiredSettings) {
  if (!settingsColNames.includes(name)) {
    db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${type}`);
  }
}

// Migration check for banco_horas type column
const bhCols = db.prepare("PRAGMA table_info(banco_horas)").all() as any[];
if (!bhCols.some(c => c.name === 'type')) {
  db.exec(`ALTER TABLE banco_horas ADD COLUMN type TEXT DEFAULT 'extra'`);
}

// Migration check for entries.isDPAnnotation
const entryCols = db.prepare("PRAGMA table_info(entries)").all() as any[];
if (!entryCols.some(c => c.name === 'isDPAnnotation')) {
  db.exec(`ALTER TABLE entries ADD COLUMN isDPAnnotation INTEGER DEFAULT 0`);
}

// Migration check for holeriths snapshot columns
const holerithCols = db.prepare("PRAGMA table_info(holeriths)").all() as any[];
const holerithColNames = holerithCols.map(c => c.name);
const holerithRenames = [
  ['employeeName', 'snapshot_employeeName'],
  ['employeeCode', 'snapshot_employeeCode'],
  ['role', 'snapshot_role'],
  ['location', 'snapshot_location'],
  ['companyName', 'snapshot_companyName'],
  ['companyCnpj', 'snapshot_companyCnpj'],
  ['cardNumber', 'snapshot_cardNumber']
];
for (const [oldName, newName] of holerithRenames) {
  if (holerithColNames.includes(oldName) && !holerithColNames.includes(newName)) {
    try {
      db.exec(`ALTER TABLE holeriths RENAME COLUMN ${oldName} TO ${newName}`);
    } catch (e) {
      console.warn(`[MIGRATION] Failed to rename ${oldName} to ${newName} in holeriths:`, e);
    }
  }
}

const requiredHolerith = [
  ['employee_id', "INTEGER REFERENCES employees(id) ON DELETE CASCADE"],
  ['snapshot_employeeName', "TEXT"],
  ['snapshot_employeeCode', "TEXT"],
  ['snapshot_role', "TEXT"],
  ['snapshot_location', "TEXT"],
  ['snapshot_companyName', "TEXT"],
  ['snapshot_companyCnpj', "TEXT"],
  ['snapshot_cardNumber', "TEXT"],
  ['createdAt', "TEXT DEFAULT (datetime('now'))"],
  ['updatedAt', "TEXT"]
];

for (const [name, type] of requiredHolerith) {
  const updatedHolerithCols = db.prepare("PRAGMA table_info(holeriths)").all() as any[];
  if (!updatedHolerithCols.some(c => c.name === name)) {
    db.exec(`ALTER TABLE holeriths ADD COLUMN ${name} ${type}`);
  }
}

// Create indexes after migrations ensure columns exist
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
  CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
  CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
  CREATE INDEX IF NOT EXISTS idx_holeriths_employee ON holeriths(employee_id);
  CREATE INDEX IF NOT EXISTS idx_holeriths_month_year ON holeriths(year, month);
  CREATE INDEX IF NOT EXISTS idx_marcacoes_holerith ON marcacoes(holerith_id);
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(workDate);
  CREATE INDEX IF NOT EXISTS idx_entries_marcacao_date ON entries(marcacao_id, workDate);
  CREATE INDEX IF NOT EXISTS idx_settings_defaultEmployeeId ON settings(defaultEmployeeId);
  CREATE INDEX IF NOT EXISTS idx_settings_defaultCompanyId ON settings(defaultCompanyId);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expiresAt);
  CREATE INDEX IF NOT EXISTS idx_simulator_plans_ref ON simulator_plans(reference);
  CREATE INDEX IF NOT EXISTS idx_simulator_plans_employee_ref ON simulator_plans(employee_id, reference);
`);

// Initial data insertion after migrations
db.prepare(`
  INSERT OR IGNORE INTO settings (id, baseSalary, monthlyHours, dailyJourney, weeklyLimit, nightCutoff, percent50, percent100, percentNight, aiProvider, geminiModel)
  VALUES (1, 2500, 220, 8, 3, '22:00', 50, 100, 25, 'gemini', 'gemini-3-flash-preview')
`).run();

const SESSION_COOKIE_NAME = "smart_point_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

const EMPLOYEE_SCOPE_SEPARATOR = "::";

function buildScopedEmployeeCode(userId: number, rawCode: string): string {
  return `u${userId}${EMPLOYEE_SCOPE_SEPARATOR}${String(rawCode || "").trim()}`;
}

function parseEmployeeScope(code: string): { scopedUserId: number | null; rawCode: string } {
  const txt = String(code || "").trim();
  const m = txt.match(/^u(\d+)::(.+)$/);
  if (!m) return { scopedUserId: null, rawCode: txt };
  return {
    scopedUserId: Number(m[1]),
    rawCode: m[2]
  };
}

function isEmployeeCodeOwnedByUser(code: string, userId: number): boolean {
  const { scopedUserId } = parseEmployeeScope(code);
  if (scopedUserId === userId) return true;
  // Compatibilidade: registros legados sem escopo pertencem ao usuário administrador (id=1).
  if (scopedUserId === null && userId === 1) return true;
  return false;
}

function clearLeakedSettingsReferences(userId: number) {
  db.prepare(`
    UPDATE settings
    SET
      defaultEmployeeId = NULL,
      defaultCompanyId = NULL,
      employeeName = NULL,
      employeeCode = NULL,
      role = NULL,
      location = NULL,
      companyName = NULL,
      companyCnpj = NULL,
      cardNumber = NULL
    WHERE id = ?
  `).run(userId);
}

function ensureSettingsForUser(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const existing = db.prepare("SELECT id FROM settings WHERE id = ?").get(userId) as any;
  if (existing?.id) return;
  db.prepare(`
    INSERT OR IGNORE INTO settings (
      id,
      baseSalary, monthlyHours, dailyJourney, weeklyLimit, nightCutoff,
      percent50, percent100, percentNight,
      aiProvider, geminiModel,
      dependentes, adiantamentoBruto, adiantamentoIR, adiantamentoPercent,
      saturdayCompensation, cycleStartDay, compDays,
      workStart, lunchStart, lunchEnd, workEnd, saturdayWorkStart, saturdayWorkEnd
    )
    VALUES (
      ?,
      2500, 220, 8, 3, '22:00',
      50, 100, 25,
      'gemini', 'gemini-3-flash-preview',
      0, 0, 0, 40,
      0, 15, '1,2,3,4',
      '12:00', '17:00', '18:00', '21:00', '12:00', '16:00'
    )
  `).run(userId);
}

function getSafeDefaultEmployeeId(userId: number): number {
  ensureSettingsForUser(userId);
  const sRow: any = db.prepare("SELECT defaultEmployeeId FROM settings WHERE id = ?").get(userId);
  const employeeId = Number(sRow?.defaultEmployeeId || 0);
  if (!employeeId) return 0;

  const employee: any = db.prepare("SELECT code FROM employees WHERE id = ?").get(employeeId);
  if (!employee?.code || !isEmployeeCodeOwnedByUser(String(employee.code), userId)) {
    clearLeakedSettingsReferences(userId);
    return 0;
  }
  return employeeId;
}

function sanitizeSharedSettingsData() {
  try {
    const rows = db.prepare("SELECT id FROM settings ORDER BY id ASC").all() as Array<{ id: number }>;
    let fixed = 0;
    for (const row of rows) {
      if (!row?.id) continue;
      const before: any = db.prepare("SELECT defaultEmployeeId FROM settings WHERE id = ?").get(Number(row.id));
      const beforeEmpId = Number(before?.defaultEmployeeId || 0);
      const afterEmpId = getSafeDefaultEmployeeId(Number(row.id));
      if (beforeEmpId > 0 && afterEmpId === 0) fixed += 1;
    }
    if (fixed > 0) {
      console.log(`[AUTH] Sanitized leaked user references in settings. affected=${fixed}`);
    }
  } catch (error) {
    console.warn("[AUTH] Failed to sanitize shared settings data:", error);
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function hashPassword(password: string, salt?: string): string {
  const safeSalt = salt || crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, safeSalt, 64).toString("hex");
  return `${safeSalt}:${digest}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expectedHash] = stored.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function normalizeAuthIdentifier(raw: any): string {
  return String(raw || "").trim().toLowerCase();
}

function normalizeOrigin(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return value.replace(/\/+$/, "").toLowerCase();
  }
}

function resolveAllowedOrigins(): Set<string> {
  const configured = String(process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);

  if (configured.length === 0) {
    configured.push("https://jhonnata.github.io");
  }

  return new Set(configured);
}

function resolveCookieSameSite(): "Lax" | "Strict" | "None" {
  const raw = String(process.env.SESSION_COOKIE_SAMESITE || "").trim().toLowerCase();
  if (raw === "none") return "None";
  if (raw === "strict") return "Strict";
  if (raw === "lax") return "Lax";
  return process.env.NODE_ENV === "production" ? "None" : "Lax";
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expiresAt, createdAt)
    VALUES (?, ?, datetime('now', '+14 days'), datetime('now'))
  `).run(token, userId);
  return token;
}

function setSessionCookie(res: any, token: string) {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  const sameSite = resolveCookieSameSite();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`
  );
}

function clearSessionCookie(res: any) {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  const sameSite = resolveCookieSameSite();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secureFlag}`
  );
}

function cleanupExpiredSessions() {
  db.prepare("DELETE FROM user_sessions WHERE datetime(expiresAt) <= datetime('now')").run();
}

function getUserFromSessionToken(token: string | undefined) {
  if (!token) return null;
  cleanupExpiredSessions();
  const row = db.prepare(`
    SELECT u.id, u.username, u.displayName
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND datetime(s.expiresAt) > datetime('now')
    LIMIT 1
  `).get(token) as any;
  if (!row) return null;
  ensureSettingsForUser(Number(row.id));
  const email = String(row.username || "");
  return {
    id: Number(row.id),
    username: email,
    email,
    displayName: row.displayName || ""
  };
}

function getAuthUserFromRequest(req: any) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  return getUserFromSessionToken(token);
}

function bootstrapDefaultUser() {
  const adminUsername = "smart";
  const adminDisplayName = "Administrador";
  const adminPasswordHash = hashPassword("123smart");

  const currentAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername) as any;
  if (currentAdmin?.id) {
    ensureSettingsForUser(Number(currentAdmin.id));
    return;
  }

  const legacyAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as any;
  if (legacyAdmin?.id) {
    db.prepare(`
      UPDATE users
      SET username = ?, displayName = ?, passwordHash = ?, updatedAt = datetime('now')
      WHERE id = ?
    `).run(adminUsername, adminDisplayName, adminPasswordHash, Number(legacyAdmin.id));
    ensureSettingsForUser(Number(legacyAdmin.id));
    console.log("[AUTH] Legacy admin migrated -> username: smart");
    return;
  }

  db.prepare(`
    INSERT INTO users (username, displayName, passwordHash, createdAt, updatedAt)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `).run(adminUsername, adminDisplayName, adminPasswordHash);

  const createdAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername) as any;
  if (createdAdmin?.id) {
    ensureSettingsForUser(Number(createdAdmin.id));
  }
  console.log("[AUTH] Default admin created -> username: smart");
}

// Migration: Backfill companies and employees from settings
try {
  const s = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
  if (s && s.companyName) {
    db.prepare("INSERT OR IGNORE INTO companies (name, cnpj) VALUES (?, ?)").run(s.companyName, s.companyCnpj || null);
    const company = db.prepare("SELECT id FROM companies WHERE name = ?").get(s.companyName) as any;
    if (company && !s.defaultCompanyId) {
      db.prepare("UPDATE settings SET defaultCompanyId = ? WHERE id = 1").run(company.id);
    }
    
    if (s.employeeName && s.employeeCode) {
      db.prepare("INSERT OR IGNORE INTO employees (code, name, role, location, company_id, cardNumber) VALUES (?, ?, ?, ?, ?, ?)")
        .run(s.employeeCode, s.employeeName, s.role || null, s.location || null, company ? company.id : null, s.cardNumber || null);
      const employee = db.prepare("SELECT id FROM employees WHERE code = ?").get(s.employeeCode) as any;
      if (employee && !s.defaultEmployeeId) {
        db.prepare("UPDATE settings SET defaultEmployeeId = ? WHERE id = 1").run(employee.id);
      }
    }
  }
} catch (e) {
  console.warn("[MIGRATION] Company/Employee backfill failed:", e);
}

// Backfill holeriths for new schema (linking to employee)
try {
  const s = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
  const empId = s?.defaultEmployeeId;
  if (empId) {
    db.prepare("UPDATE holeriths SET employee_id = ? WHERE employee_id IS NULL").run(empId);
  }
} catch (e) {
  // Ignora erro se a coluna já tiver NOT NULL ou dados corretos
}

function clampCycleStartDay(raw: any): number {
  const value = Number(raw || 15);
  return Math.max(1, Math.min(31, Number.isFinite(value) ? value : 15));
}

function normalizeTextValue(value: any): string | null {
  const txt = (value ?? "").toString().trim();
  return txt === "" ? null : txt;
}

function normalizeClockValue(value: any): string {
  const txt = (value ?? "").toString().trim();
  return /^\d{1,2}:\d{2}$/.test(txt) ? txt : "";
}

function getDayNumberFromRow(row: any): number | null {
  const dayRaw = row?.day || (row?.date || row?.workDate || "").slice(8, 10);
  const dayNum = Number(dayRaw);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return null;
  return dayNum;
}

function normalizeOvernightRows(rows: any[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const cloned = rows.map((row) => ({ ...row }));
  const ordered = cloned
    .map((row) => ({ row, dayNum: getDayNumberFromRow(row) }))
    .filter((item) => item.dayNum !== null)
    .sort((a, b) => (a.dayNum as number) - (b.dayNum as number));

  const pairs: Array<[string, string]> = [
    ["entry1", "exit1"],
    ["entry2", "exit2"],
    ["entryExtra", "exitExtra"]
  ];

  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].row;
    const next = ordered[i + 1].row;

    for (const [startKey, endKey] of pairs) {
      const currentStart = normalizeClockValue(current?.[startKey]);
      const currentEnd = normalizeClockValue(current?.[endKey]);
      const nextStart = normalizeClockValue(next?.[startKey]);
      const nextEnd = normalizeClockValue(next?.[endKey]);

      // Move overnight end punch to the start day when OCR split it across rows.
      if (currentStart && !currentEnd && !nextStart && nextEnd) {
        current[endKey] = nextEnd;
        next[endKey] = "";
      }
    }
  }

  return cloned;
}

function timeToMinutes(value: string): number {
  if (!value || !value.includes(":")) return 0;
  const [hh, mm] = value.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function calcEntryTotalMinutes(entry: any): number {
  const periods = [
    [entry?.entry1, entry?.exit1],
    [entry?.entry2, entry?.exit2],
    [entry?.entryExtra, entry?.exitExtra]
  ];
  let total = 0;
  for (const [start, end] of periods) {
    if ((!start || start === "") && (!end || end === "")) continue;
    if (!start || !start.includes(":") || !end || !end.includes(":")) continue;
    let d = timeToMinutes(end) - timeToMinutes(start);
    if (d < 0) d += 24 * 60;
    total += d;
  }
  return total;
}

function minutesToHHMM(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = Math.round(minutes % 60);
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

function recomputeBancoHorasForHolerith(
  holerithId: number,
  journeyMinutes: number,
  hasSatComp: boolean,
  compDays: number[]
) {
  db.prepare("DELETE FROM banco_horas WHERE holerith_id = ? AND type IN ('extra', 'atraso')").run(holerithId);

  const normalMarc = db.prepare(
    "SELECT id FROM marcacoes WHERE holerith_id = ? AND type = 'normal'"
  ).get(holerithId) as any;
  if (!normalMarc?.id) return;

  const insBH = db.prepare(
    "INSERT INTO banco_horas (holerith_id, date, minutes, type, description) VALUES (?, ?, ?, ?, ?)"
  );
  const finalRows = db.prepare(`
    SELECT workDate AS date, entry1, exit1, entry2, exit2, entryExtra, exitExtra
    FROM entries
    WHERE marcacao_id = ?
    ORDER BY workDate ASC
  `).all(normalMarc.id) as any[];

  for (const row of finalRows) {
    const dateStr = row.date;
    if (!dateStr) continue;
    const dDate = new Date(dateStr + "T12:00:00");
    const dayOfWeek = dDate.getDay();
    const isSunday = dayOfWeek === 0;
    let curJourney = journeyMinutes;
    if (hasSatComp) {
      if (compDays.includes(dayOfWeek)) curJourney += 60;
      else if (dayOfWeek === 6) curJourney = 0;
    }
    const total = calcEntryTotalMinutes(row);
    if (isSunday) {
      if (total > 0) insBH.run(holerithId, dateStr, total, "extra", "Domingo - banco de horas");
    } else {
      if (total > curJourney) {
        insBH.run(holerithId, dateStr, total - curJourney, "extra", "Excedente cartao normal");
      } else if (total > 0 && total < curJourney) {
        insBH.run(holerithId, dateStr, curJourney - total, "atraso", "Atraso cartao normal");
      } else if (total === 0 && curJourney > 0) {
        insBH.run(holerithId, dateStr, curJourney, "atraso", "Falta cartao normal");
      }
    }
  }
}

function migrateLegacyCycleCutoverData() {
  try {
    const sRow: any = db.prepare(
      "SELECT cycleStartDay, dailyJourney, saturdayCompensation, compDays FROM settings WHERE id = 1"
    ).get();
    const cycleStartDay = clampCycleStartDay(sRow?.cycleStartDay);
    if (cycleStartDay <= 1) return;

    const journeyMinutes = Math.round(((sRow?.dailyJourney || 0) as number) * 60);
    const hasSatComp = !!sRow?.saturdayCompensation;
    const compDays = (sRow?.compDays || "1,2,3,4")
      .split(",")
      .map((n: string) => Number(n))
      .filter((n: number) => Number.isFinite(n));

    const rows = db.prepare(`
      SELECT m.id AS marcacao_id, m.type, h.id AS holerith_id, h.month AS refMonth, h.year AS refYear
      FROM marcacoes m
      JOIN holeriths h ON h.id = m.holerith_id
    `).all() as any[];

    const findEntry = db.prepare("SELECT * FROM entries WHERE marcacao_id = ? AND workDate = ?");
    const updateEntry = db.prepare(`
      UPDATE entries
      SET entry1 = ?, exit1 = ?, entry2 = ?, exit2 = ?, entryExtra = ?, exitExtra = ?,
          totalHours = ?, notes = ?, isDPAnnotation = ?, updatedAt = datetime('now')
      WHERE id = ?
    `);
    const moveEntry = db.prepare("UPDATE entries SET workDate = ?, totalHours = ?, updatedAt = datetime('now') WHERE id = ?");
    const deleteEntry = db.prepare("DELETE FROM entries WHERE id = ?");

    let moved = 0;
    let merged = 0;
    const changedHoleriths = new Set<number>();

    const tx = db.transaction(() => {
      for (const row of rows) {
        const refMonth = Number(row.refMonth);
        const refYear = Number(row.refYear);
        if (!refMonth || !refYear) continue;

        let prevMonth = refMonth - 1;
        let prevYear = refYear;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear -= 1;
        }

        const dayStr = cycleStartDay.toString().padStart(2, "0");
        const sourceDate = `${prevYear}-${prevMonth.toString().padStart(2, "0")}-${dayStr}`;
        const targetDate = `${refYear}-${refMonth.toString().padStart(2, "0")}-${dayStr}`;
        if (sourceDate === targetDate) continue;

        const source = findEntry.get(row.marcacao_id, sourceDate) as any;
        if (!source) continue;
        const target = findEntry.get(row.marcacao_id, targetDate) as any;

        if (target) {
          const pick = (primary: any, fallback: any) => {
            const p = normalizeTextValue(primary);
            if (p !== null) return p;
            return normalizeTextValue(fallback);
          };

          const mergedRow = {
            entry1: pick(target.entry1, source.entry1),
            exit1: pick(target.exit1, source.exit1),
            entry2: pick(target.entry2, source.entry2),
            exit2: pick(target.exit2, source.exit2),
            entryExtra: pick(target.entryExtra, source.entryExtra),
            exitExtra: pick(target.exitExtra, source.exitExtra),
            notes: pick(target.notes, source.notes),
            isDPAnnotation: (target.isDPAnnotation || source.isDPAnnotation) ? 1 : 0
          };
          const totalMinutes = calcEntryTotalMinutes(mergedRow);
          const totalHours = totalMinutes > 0 ? minutesToHHMM(totalMinutes) : null;

          updateEntry.run(
            mergedRow.entry1,
            mergedRow.exit1,
            mergedRow.entry2,
            mergedRow.exit2,
            mergedRow.entryExtra,
            mergedRow.exitExtra,
            totalHours,
            mergedRow.notes,
            mergedRow.isDPAnnotation,
            target.id
          );
          deleteEntry.run(source.id);
          merged += 1;
        } else {
          const totalMinutes = calcEntryTotalMinutes(source);
          const totalHours = totalMinutes > 0 ? minutesToHHMM(totalMinutes) : null;
          moveEntry.run(targetDate, totalHours, source.id);
          moved += 1;
        }

        changedHoleriths.add(Number(row.holerith_id));
      }
    });

    tx();

    if (changedHoleriths.size > 0) {
      for (const holerithId of changedHoleriths) {
        recomputeBancoHorasForHolerith(holerithId, journeyMinutes, hasSatComp, compDays);
      }
      console.log(
        `[MIGRATION] cycleStartDay cutover adjusted. moved=${moved}, merged=${merged}, holerithsRecomputed=${changedHoleriths.size}`
      );
    }
  } catch (error) {
    console.warn("[MIGRATION] Failed to migrate legacy cycle cutover data:", error);
  }
}

migrateLegacyCycleCutoverData();
bootstrapDefaultUser();
sanitizeSharedSettingsData();

async function startServer() {
  const app = express();
  const allowedOrigins = resolveAllowedOrigins();

  app.use((req, res, next) => {
    const originHeader = String(req.headers.origin || "");
    const normalizedOrigin = normalizeOrigin(originHeader);
    const allowOrigin = normalizedOrigin && allowedOrigins.has(normalizedOrigin) ? originHeader : "";

    if (allowOrigin) {
      res.header("Access-Control-Allow-Origin", allowOrigin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }

    if (req.method === "OPTIONS") {
      if (allowOrigin) return res.sendStatus(204);
      return res.sendStatus(403);
    }

    next();
  });

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/auth/register", (req, res) => {
    try {
      const emailRaw = normalizeAuthIdentifier(req.body?.email || req.body?.username);
      const password = String(req.body?.password || "");
      const displayName = String(req.body?.displayName || "").trim();

      if (!isValidEmail(emailRaw)) {
        return res.status(400).json({ error: "Email invalido. Informe um e-mail valido." });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Senha invalida. Minimo de 6 caracteres." });
      }

      const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(emailRaw) as any;
      if (exists?.id) {
        return res.status(409).json({ error: "Email ja cadastrado." });
      }

      const passwordHash = hashPassword(password);
      const info = db.prepare(`
        INSERT INTO users (username, displayName, passwordHash, createdAt, updatedAt)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(emailRaw, displayName || emailRaw, passwordHash);

      const userId = Number(info.lastInsertRowid);
      ensureSettingsForUser(userId);
      const token = createSession(userId);
      setSessionCookie(res, token);

      res.json({
        user: {
          id: userId,
          username: emailRaw,
          email: emailRaw,
          displayName: displayName || emailRaw
        }
      });
    } catch (err: any) {
      console.error("Error in POST /api/auth/register:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const identifierRaw = normalizeAuthIdentifier(req.body?.email || req.body?.username);
      const password = String(req.body?.password || "");
      if (!identifierRaw || !password) {
        return res.status(400).json({ error: "Email e senha sao obrigatorios." });
      }

      const user = db.prepare("SELECT id, username, displayName, passwordHash FROM users WHERE username = ?").get(identifierRaw) as any;
      if (!user?.id || !verifyPassword(password, String(user.passwordHash || ""))) {
        return res.status(401).json({ error: "Credenciais invalidas." });
      }

      ensureSettingsForUser(Number(user.id));
      const token = createSession(Number(user.id));
      setSessionCookie(res, token);
      res.json({
        user: {
          id: Number(user.id),
          username: String(user.username || ""),
          email: String(user.username || ""),
          displayName: String(user.displayName || user.username || "")
        }
      });
    } catch (err: any) {
      console.error("Error in POST /api/auth/login:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) return res.status(401).json({ user: null });
    return res.json({ user: authUser });
  });

  app.post("/api/auth/logout", (req, res) => {
    try {
      const cookies = parseCookies(req.headers?.cookie);
      const token = cookies[SESSION_COOKIE_NAME];
      if (token) {
        db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
      }
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/auth/logout:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    if (req.path.startsWith("/api/auth/")) return next();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return res.status(401).json({ error: "Nao autenticado." });
    }
    (req as any).authUser = authUser;
    ensureSettingsForUser(Number(authUser.id));
    next();
  });

  // API Routes
  app.get("/api/settings", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    ensureSettingsForUser(userId);
    getSafeDefaultEmployeeId(userId);
    const settings = db.prepare("SELECT * FROM settings WHERE id = ?").get(userId);
    console.log("[DEBUG] GET /api/settings ->", settings);
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    ensureSettingsForUser(userId);
    const { 
      baseSalary, monthlyHours, dailyJourney, weeklyLimit, nightCutoff, 
      percent50, percent100, percent125, percentNight, 
      aiProvider, geminiApiKey, geminiModel, openaiApiKey, openaiModel, codexApiKey, codexModel,
      employeeName, employeeCode, role, location, companyName, companyCnpj, cardNumber,
      dependentes, adiantamentoPercent, adiantamentoIR, saturdayCompensation, cycleStartDay, compDays,
      workStart, lunchStart, lunchEnd, workEnd, saturdayWorkStart, saturdayWorkEnd,
      defaultEmployeeId, defaultCompanyId
    } = req.body;
    const current: any = db.prepare("SELECT defaultEmployeeId, defaultCompanyId FROM settings WHERE id = ?").get(userId);
    const currentSafeEmployeeId = getSafeDefaultEmployeeId(userId) || null;

    let safeDefaultEmployeeId = currentSafeEmployeeId;
    if (Number.isInteger(Number(defaultEmployeeId)) && Number(defaultEmployeeId) > 0) {
      const employee = db.prepare("SELECT code FROM employees WHERE id = ?").get(Number(defaultEmployeeId)) as any;
      if (employee?.code && isEmployeeCodeOwnedByUser(String(employee.code), userId)) {
        safeDefaultEmployeeId = Number(defaultEmployeeId);
      }
    }

    const safeDefaultCompanyId = Number.isInteger(Number(defaultCompanyId)) && Number(defaultCompanyId) > 0
      ? Number(defaultCompanyId)
      : Number(current?.defaultCompanyId || 0) || null;

    db.prepare(`
      UPDATE settings SET 
        baseSalary = ?, monthlyHours = ?, dailyJourney = ?, weeklyLimit = ?, 
        nightCutoff = ?, percent50 = ?, percent100 = ?, percent125 = ?, percentNight = ?,
        aiProvider = ?, geminiApiKey = ?, geminiModel = ?, openaiApiKey = ?, openaiModel = ?, codexApiKey = ?, codexModel = ?,
        employeeName = ?, employeeCode = ?, role = ?, location = ?, companyName = ?, companyCnpj = ?, cardNumber = ?,
        dependentes = ?, adiantamentoPercent = ?, adiantamentoIR = ?, saturdayCompensation = ?, cycleStartDay = ?, compDays = ?,
        workStart = ?, lunchStart = ?, lunchEnd = ?, workEnd = ?, saturdayWorkStart = ?, saturdayWorkEnd = ?,
        defaultEmployeeId = ?, defaultCompanyId = ?
      WHERE id = ?
    `).run(
      baseSalary, monthlyHours, dailyJourney, weeklyLimit, nightCutoff, 
      percent50, percent100, percent125, percentNight, 
      aiProvider, geminiApiKey, geminiModel, openaiApiKey, openaiModel, codexApiKey, codexModel,
      employeeName, employeeCode, role, location, companyName, companyCnpj, cardNumber,
      dependentes || 0, adiantamentoPercent || 0, adiantamentoIR || 0, saturdayCompensation ? 1 : 0, cycleStartDay || 15, compDays || '1,2,3,4',
      workStart || '12:00', lunchStart || '17:00', lunchEnd || '18:00', workEnd || '21:00',
      saturdayWorkStart || '12:00', saturdayWorkEnd || '16:00',
      safeDefaultEmployeeId, safeDefaultCompanyId,
      userId
    );
    res.json({ success: true });
  });

  // GET /api/holeriths - lista todos os meses disponiveis
  app.get("/api/holeriths", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    const employeeId = getSafeDefaultEmployeeId(userId);
    if (!employeeId) {
      return res.json([]);
    }
    const rows = db.prepare(`
      SELECT
        h.id, h.month, h.year,
        h.snapshot_employeeName AS employeeName,
        h.snapshot_employeeCode AS employeeCode,
        h.snapshot_role AS role,
        h.snapshot_location AS location,
        h.snapshot_companyName AS companyName,
        h.snapshot_companyCnpj AS companyCnpj,
        h.snapshot_cardNumber AS cardNumber
      FROM holeriths h
      WHERE h.employee_id = ?
      ORDER BY h.year DESC, h.month DESC
    `).all(employeeId);
    console.log(`[DEBUG] GET /api/holeriths -> ${rows.length} rows`);
    res.json(rows);
  });

  app.get("/api/banco-horas", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    const employeeId = getSafeDefaultEmployeeId(userId);
    if (!employeeId) {
      return res.json([]);
    }
    const data = db.prepare(`
      SELECT b.*, h.month, h.year 
      FROM banco_horas b
      LEFT JOIN holeriths h ON h.id = b.holerith_id
      WHERE h.employee_id = ?
      ORDER BY b.date ASC
    `).all(employeeId);
    res.json(data);
  });

  app.post("/api/banco-horas", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    const employeeId = getSafeDefaultEmployeeId(userId);
    if (!employeeId) {
      return res.status(400).json({ error: "Funcionario padrao nao configurado." });
    }
    const { holerith_id, date, minutes, type, description } = req.body;
    const own = db.prepare("SELECT id FROM holeriths WHERE id = ? AND employee_id = ?").get(holerith_id, employeeId) as any;
    if (!own?.id) {
      return res.status(403).json({ error: "Holerith nao pertence ao usuario." });
    }
    const info = db.prepare("INSERT INTO banco_horas (holerith_id, date, minutes, type, description) VALUES (?, ?, ?, ?, ?)")
      .run(holerith_id, date, minutes, type || 'extra', description);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/banco-horas/:id", (req, res) => {
    const userId = Number((req as any).authUser?.id || 0);
    const employeeId = getSafeDefaultEmployeeId(userId);
    if (!employeeId) {
      return res.json({ success: true, count: 0 });
    }
    const result = db.prepare(`
      DELETE FROM banco_horas
      WHERE id = ?
        AND holerith_id IN (SELECT id FROM holeriths WHERE employee_id = ?)
    `).run(req.params.id, employeeId);
    res.json({ success: true, count: result.changes });
  });

  app.get("/api/simulator-plan/:ref", (req, res) => {
    try {
      const { ref } = req.params;
      if (!ref || ref.length !== 6) {
        return res.status(400).json({ error: "Referencia invalida. Use MMYYYY." });
      }

      const userId = Number((req as any).authUser?.id || 0);
      const employeeId = getSafeDefaultEmployeeId(userId);

      const planOwnerId = employeeId > 0 ? employeeId : -userId;
      const row = db.prepare(
        "SELECT payload, createdAt, updatedAt FROM simulator_plans WHERE employee_id = ? AND reference = ?"
      ).get(planOwnerId, ref) as any;

      if (!row) {
        return res.json({ plan: null, updatedAt: null });
      }

      let plan: any = null;
      try {
        plan = JSON.parse(row.payload || "{}");
      } catch {
        plan = null;
      }

      res.json({
        plan,
        updatedAt: row.updatedAt || row.createdAt || null
      });
    } catch (err: any) {
      console.error("Error in GET /api/simulator-plan/:ref:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/simulator-plan/:ref", (req, res) => {
    try {
      const { ref } = req.params;
      if (!ref || ref.length !== 6) {
        return res.status(400).json({ error: "Referencia invalida. Use MMYYYY." });
      }

      const userId = Number((req as any).authUser?.id || 0);
      const employeeId = getSafeDefaultEmployeeId(userId);
      const payload = JSON.stringify(req.body || {});
      const planOwnerId = employeeId > 0 ? employeeId : -userId;

      db.prepare(`
        INSERT INTO simulator_plans (employee_id, reference, payload, createdAt, updatedAt)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(employee_id, reference) DO UPDATE SET
          payload = excluded.payload,
          updatedAt = datetime('now')
      `).run(planOwnerId, ref, payload);

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/simulator-plan/:ref:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/simulator-plan/:ref", (req, res) => {
    try {
      const { ref } = req.params;
      if (!ref || ref.length !== 6) {
        return res.status(400).json({ error: "Referencia invalida. Use MMYYYY." });
      }

      const userId = Number((req as any).authUser?.id || 0);
      const employeeId = getSafeDefaultEmployeeId(userId);
      const planOwnerId = employeeId > 0 ? employeeId : -userId;
      const result = db.prepare("DELETE FROM simulator_plans WHERE employee_id = ? AND reference = ?").run(planOwnerId, ref);
      res.json({ success: true, count: result.changes });
    } catch (err: any) {
      console.error("Error in DELETE /api/simulator-plan/:ref:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/referencia/:ref - salva dados do cartao (normal + horas extras) para um mes
  app.post("/api/referencia/:ref", (req, res) => {
    const { ref } = req.params;
    if (!ref || ref.length !== 6) {
      return res.status(400).json({ error: "Referência inválida. Use MMYYYY." });
    }
    const month = parseInt(ref.substring(0, 2), 10);
    const year = parseInt(ref.substring(2), 10);

    const body = req.body as {
      companyName?: string; companyCnpj?: string;
      employeeName?: string; employeeCode?: string;
      role?: string; location?: string; cardNumber?: string;
      frontImage?: string; backImage?: string;
      frontImageHe?: string; backImageHe?: string;
      hours?: any[]; he?: any[];
    };

    const userId = Number((req as any).authUser?.id || 0);
    ensureSettingsForUser(userId);
    getSafeDefaultEmployeeId(userId);
    const sRow: any = db.prepare("SELECT * FROM settings WHERE id = ?").get(userId);
    const journeyMinutes = Math.round(((sRow?.dailyJourney || 0) as number) * 60);
    const hasSatComp = !!sRow?.saturdayCompensation;
    const compDays = (sRow?.compDays || '1,2,3,4').split(',').map(Number);
    const cycleStartDay = clampCycleStartDay(sRow?.cycleStartDay);
    const workDateForDay = (dayNum: number): string => {
      let m = month;
      let y = year;
      if (cycleStartDay > 1 && dayNum > cycleStartDay) {
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      return `${y}-${m.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
    };

    try {
      const tx = db.transaction(() => {
        // 1. Resolver Company
        let companyId = sRow?.defaultCompanyId || null;
        const cName = body.companyName || sRow?.companyName;
        const cCnpj = body.companyCnpj || sRow?.companyCnpj;
        if (cName) {
          db.prepare("INSERT OR IGNORE INTO companies (name, cnpj) VALUES (?, ?)").run(cName, cCnpj || null);
          const c = db.prepare("SELECT id FROM companies WHERE name = ?").get(cName) as any;
          if (c) companyId = c.id;
        }

        // 2. Resolver Employee
        let employeeId = getSafeDefaultEmployeeId(userId) || null;
        const eName = normalizeTextValue(body.employeeName || sRow?.employeeName);
        const eCodeRaw = normalizeTextValue(body.employeeCode || sRow?.employeeCode);
        if (eName && eCodeRaw) {
          const scopedCode = buildScopedEmployeeCode(userId, eCodeRaw);
          let e = db.prepare("SELECT id FROM employees WHERE code = ?").get(scopedCode) as any;
          if (!e && userId === 1) {
            e = db.prepare("SELECT id FROM employees WHERE code = ?").get(eCodeRaw) as any;
          }
          if (!e) {
            db.prepare(`INSERT INTO employees (code, name, role, location, company_id, cardNumber) VALUES (?, ?, ?, ?, ?, ?)`)
              .run(
                scopedCode,
                eName,
                body.role || sRow?.role || null,
                body.location || sRow?.location || null,
                companyId,
                body.cardNumber || sRow?.cardNumber || null
              );
            e = db.prepare("SELECT id FROM employees WHERE code = ?").get(scopedCode) as any;
          }
          if (e?.id) employeeId = e.id;
        }

        if (!employeeId) throw new Error('Funcionário não encontrado. Configure o funcionário padrão nas configurações.');

        // 3. Criar/Atualizar Holerith
        db.prepare(`INSERT OR IGNORE INTO holeriths (employee_id, month, year) VALUES (?, ?, ?)`).run(employeeId, month, year);
        const h = db.prepare("SELECT id FROM holeriths WHERE employee_id = ? AND month = ? AND year = ?").get(employeeId, month, year) as any;
        db.prepare(`UPDATE holeriths SET
          snapshot_employeeName = ?, snapshot_employeeCode = ?, snapshot_role = ?, snapshot_location = ?,
          snapshot_companyName = ?, snapshot_companyCnpj = ?, snapshot_cardNumber = ?, updatedAt = datetime('now')
          WHERE id = ?`).run(eName, eCodeRaw, body.role || null, body.location || null, cName, cCnpj || null, body.cardNumber || null, h.id);

        // 4. Atualizar defaultEmployeeId / defaultCompanyId nas settings se necessário
        if (!getSafeDefaultEmployeeId(userId) && employeeId) {
          db.prepare("UPDATE settings SET defaultEmployeeId = ? WHERE id = ?").run(employeeId, userId);
        }
        if (!sRow?.defaultCompanyId && companyId) {
          db.prepare("UPDATE settings SET defaultCompanyId = ? WHERE id = ?").run(companyId, userId);
        }

        const saveCardType = (type: 'normal' | 'overtime', rows: any[], frontImg?: string, backImg?: string) => {
          if (!rows || rows.length === 0) return;
          const normalizedRows = normalizeOvernightRows(rows);

          const hasIncomingData = normalizedRows.some((row: any) => {
            const fields = [row?.entry1, row?.exit1, row?.entry2, row?.exit2, row?.entryExtra, row?.exitExtra];
            return fields.some(v => normalizeTextValue(v) !== null) || typeof row?.isDPAnnotation === 'boolean';
          });

          let marc = db.prepare("SELECT id FROM marcacoes WHERE holerith_id = ? AND type = ?").get(h.id, type) as any;
          if (!marc && !hasIncomingData && !frontImg && !backImg) return;

          db.prepare("INSERT OR IGNORE INTO marcacoes (holerith_id, type) VALUES (?, ?)").run(h.id, type);
          marc = db.prepare("SELECT id FROM marcacoes WHERE holerith_id = ? AND type = ?").get(h.id, type) as any;
          if (frontImg || backImg) {
            db.prepare("UPDATE marcacoes SET frontImage = COALESCE(?, frontImage), backImage = COALESCE(?, backImage), updatedAt = datetime('now') WHERE id = ?")
              .run(frontImg || null, backImg || null, marc.id);
          }

          const findEntry = db.prepare("SELECT * FROM entries WHERE marcacao_id = ? AND workDate = ?");
          const upsertEntry = db.prepare(`
            INSERT INTO entries (
              id, marcacao_id, workDate,
              entry1, exit1, entry2, exit2, entryExtra, exitExtra,
              totalHours, notes, isDPAnnotation, createdAt, updatedAt
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(marcacao_id, workDate) DO UPDATE SET
              entry1 = excluded.entry1,
              exit1 = excluded.exit1,
              entry2 = excluded.entry2,
              exit2 = excluded.exit2,
              entryExtra = excluded.entryExtra,
              exitExtra = excluded.exitExtra,
              totalHours = excluded.totalHours,
              notes = excluded.notes,
              isDPAnnotation = excluded.isDPAnnotation,
              updatedAt = datetime('now')
          `);

          const seenDates = new Map<string, any>();
          for (const row of normalizedRows) {
            const dayRaw = row?.day || (row?.date || row?.workDate || '').slice(8, 10);
            const dayNum = Number(dayRaw);
            if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) continue;
            const wd = workDateForDay(dayNum);
            seenDates.set(wd, {
              ...row,
              day: dayNum.toString().padStart(2, '0'),
              date: wd,
              workDate: wd
            });
          }

          for (const row of seenDates.values()) {
            const wd = row?.date || row?.workDate;
            if (!wd) continue;
            const existing = findEntry.get(marc.id, wd) as any;

            const pick = (incoming: any, current: any) => {
              const v = normalizeTextValue(incoming);
              return v !== null ? v : (current ?? null);
            };

            const merged = {
              entry1: pick(row.entry1, existing?.entry1),
              exit1: pick(row.exit1, existing?.exit1),
              entry2: pick(row.entry2, existing?.entry2),
              exit2: pick(row.exit2, existing?.exit2),
              entryExtra: pick(row.entryExtra, existing?.entryExtra),
              exitExtra: pick(row.exitExtra, existing?.exitExtra),
              notes: pick(row.notes, existing?.notes),
              isDPAnnotation: typeof row?.isDPAnnotation === 'boolean'
                ? (row.isDPAnnotation ? 1 : 0)
                : (existing?.isDPAnnotation ? 1 : 0),
            };

            const mergedMinutes = calcEntryTotalMinutes(merged);
            const mergedTotalHours = mergedMinutes > 0 ? minutesToHHMM(mergedMinutes) : null;

            upsertEntry.run(
              existing?.id || `${marc.id}-${wd}`,
              marc.id,
              wd,
              merged.entry1,
              merged.exit1,
              merged.entry2,
              merged.exit2,
              merged.entryExtra,
              merged.exitExtra,
              mergedTotalHours,
              merged.notes,
              merged.isDPAnnotation
            );
          }

          if (type === 'normal') {
            recomputeBancoHorasForHolerith(h.id, journeyMinutes, hasSatComp, compDays);
          }
        };

        if (body.hours && body.hours.length > 0) saveCardType('normal', body.hours, body.frontImage, body.backImage);
        if (body.he && body.he.length > 0) saveCardType('overtime', body.he, body.frontImageHe, body.backImageHe);
      });

      tx();
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error in POST /api/referencia/:ref:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/referencia/:ref", (req, res) => {
    const { ref } = req.params;

    if (!ref || ref.length !== 6) {
      return res.status(400).json({ error: "Referência inválida. Use MMYYYY." });
    }
    const month = parseInt(ref.substring(0, 2), 10);
    const year = parseInt(ref.substring(2), 10);

    console.log(`[DEBUG] GET /api/referencia/${ref} -> month=${month}, year=${year}`);

    // Obter funcionário padrão (ou do holerith se existissem múltiplos, mas o app foca em um)
    const userId = Number((req as any).authUser?.id || 0);
    ensureSettingsForUser(userId);
    const employeeId = getSafeDefaultEmployeeId(userId);

    if (!employeeId) {
      return res.json({
        month: String(month).padStart(2, '0'),
        year,
        hours: [],
        he: [],
        hasNormalCard: false,
        hasOvertimeCard: false,
        frontImage: null,
        backImage: null,
        frontImageHe: null,
        backImageHe: null
      });
    }

    // Obter metadados do holerith com dados de snapshot
    const h = db.prepare("SELECT * FROM holeriths WHERE employee_id = ? AND month = ? AND year = ?").get(employeeId, month, year) as any;
    
    // Obter todas as entries deste holerith (via marcacoes)
    const sql = `
      SELECT e.*, m.type AS mType
      FROM entries e
      JOIN marcacoes m ON m.id = e.marcacao_id
      WHERE m.holerith_id = ?
      ORDER BY e.workDate ASC, e.id ASC
    `;
    
    let entries: any[] = [];
    let marcacoes: any[] = [];
    if (h) {
      entries = db.prepare(sql).all(h.id) as any[];
      marcacoes = db.prepare("SELECT type, frontImage, backImage FROM marcacoes WHERE holerith_id = ?").all(h.id) as any[];
    }

    // Garantir 31 dias preenchidos em cada cartão com base no ciclo de fechamento
    const sRow: any = db.prepare("SELECT cycleStartDay FROM settings WHERE id = ?").get(userId);
    const cycleStartDay = clampCycleStartDay(sRow?.cycleStartDay);

    const getCorrectDate = (d: number, refMonth: number, refYear: number, cycle: number) => {
      let m = refMonth;
      let y = refYear;
      if (cycle > 1 && d > cycle) {
        m -= 1;
        if (m === 0) { m = 12; y -= 1; }
      }
      const dayStr = d.toString().padStart(2, '0');
      const monStr = m.toString().padStart(2, '0');
      return `${y}-${monStr}-${dayStr}`;
    };

    const buildFull = (type: 'normal'|'overtime') => {
      const byDate: Record<string, any> = {};
      entries.filter(e => e.mType === type).forEach(e => { if (e.workDate) byDate[e.workDate] = e; });
      const out: any[] = [];
      for (let d = 1; d <= 31; d++) {
        const dateStr = getCorrectDate(d, month, year, cycleStartDay);
        const src = byDate[dateStr];
        out.push({
          date: dateStr,
          day: d.toString().padStart(2, '0'),
          entry1: src?.entry1 || "",
          exit1: src?.exit1 || "",
          entry2: src?.entry2 || "",
          exit2: src?.exit2 || "",
          entryExtra: src?.entryExtra || "",
          exitExtra: src?.exitExtra || "",
          totalHours: src?.totalHours || "",
          isDPAnnotation: !!src?.isDPAnnotation
        });
      }
      return out;
    };

    const hasAnyContent = (row: any) => {
      const fields = [row?.entry1, row?.exit1, row?.entry2, row?.exit2, row?.entryExtra, row?.exitExtra, row?.totalHours];
      return fields.some(v => (v ?? '').toString().trim() !== '') || !!row?.isDPAnnotation;
    };

    const hasNormalRows = entries.some(e => e.mType === 'normal' && hasAnyContent(e));
    const hasOvertimeRows = entries.some(e => e.mType === 'overtime' && hasAnyContent(e));
    const normalMark = marcacoes.find(m => m.type === 'normal');
    const overtimeMark = marcacoes.find(m => m.type === 'overtime');
    const hasNormalCard = !!normalMark && (hasNormalRows || !!normalMark?.frontImage || !!normalMark?.backImage);
    const hasOvertimeCard = !!overtimeMark && (hasOvertimeRows || !!overtimeMark?.frontImage || !!overtimeMark?.backImage);
    const hours = hasNormalCard ? buildFull('normal') : [];
    const he = hasOvertimeCard ? buildFull('overtime') : [];

    res.json({
      companyName: h?.snapshot_companyName || "",
      companyCnpj: h?.snapshot_companyCnpj || "",
      employeeName: h?.snapshot_employeeName || "",
      employeeCode: h?.snapshot_employeeCode || "",
      role: h?.snapshot_role || "",
      location: h?.snapshot_location || "",
      month: String(month).padStart(2, '0'),
      year: year,
      cardNumber: h?.snapshot_cardNumber || "",
      isOvertimeCard: hasOvertimeCard && !hasNormalCard,
      hasNormalCard,
      hasOvertimeCard,
      frontImage: normalMark?.frontImage || null,
      backImage: normalMark?.backImage || null,
      frontImageHe: overtimeMark?.frontImage || null,
      backImageHe: overtimeMark?.backImage || null,
      hours,
      he
    });
  });

  app.delete("/api/referencia/:ref", (req, res) => {
    try {
      const { ref } = req.params;
      const type = String(req.query.type || 'all');
      if (!ref || ref.length !== 6) {
        return res.status(400).json({ error: "Referência inválida. Use MMYYYY." });
      }

      const month = parseInt(ref.substring(0, 2), 10);
      const year = parseInt(ref.substring(2), 10);
      const userId = Number((req as any).authUser?.id || 0);
      const employeeId = getSafeDefaultEmployeeId(userId);
      if (!employeeId) return res.json({ success: true, count: 0 });

      const hol = db.prepare("SELECT id FROM holeriths WHERE employee_id = ? AND month = ? AND year = ?").get(employeeId, month, year) as any;
      if (!hol) return res.json({ success: true, count: 0 });

      const tx = db.transaction(() => {
        if (type === 'normal' || type === 'overtime') {
          const marc = db.prepare("SELECT id FROM marcacoes WHERE holerith_id = ? AND type = ?").get(hol.id, type) as any;
          if (!marc) return { count: 0 };

          const delE = db.prepare("DELETE FROM entries WHERE marcacao_id = ?").run(marc.id);
          db.prepare("DELETE FROM marcacoes WHERE id = ?").run(marc.id);
          if (type === 'normal') {
            db.prepare("DELETE FROM banco_horas WHERE holerith_id = ? AND type IN ('extra', 'atraso')").run(hol.id);
          }

          const remain = db.prepare("SELECT COUNT(*) AS cnt FROM marcacoes WHERE holerith_id = ?").get(hol.id) as any;
          if (!remain?.cnt) {
            db.prepare("DELETE FROM banco_horas WHERE holerith_id = ?").run(hol.id);
            db.prepare("DELETE FROM holeriths WHERE id = ?").run(hol.id);
          }
          return { count: delE.changes };
        }

        const delE = db.prepare("DELETE FROM entries WHERE marcacao_id IN (SELECT id FROM marcacoes WHERE holerith_id = ?)").run(hol.id);
        db.prepare("DELETE FROM marcacoes WHERE holerith_id = ?").run(hol.id);
        db.prepare("DELETE FROM banco_horas WHERE holerith_id = ?").run(hol.id);
        db.prepare("DELETE FROM simulator_plans WHERE employee_id = ? AND reference = ?").run(employeeId, ref);
        db.prepare("DELETE FROM holeriths WHERE id = ?").run(hol.id);
        return { count: delE.changes };
      });

      const result = tx() as any;
      res.json({ success: true, count: result?.count || 0 });
    } catch (err: any) {
      console.error("Error in DELETE /api/referencia/:ref:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/referencias", (req, res) => {
    try {
      const userId = Number((req as any).authUser?.id || 0);
      const employeeId = getSafeDefaultEmployeeId(userId);
      if (!employeeId) {
        return res.json({ success: true, count: 0 });
      }
      const tx = db.transaction(() => {
        const holerithIds = db.prepare("SELECT id FROM holeriths WHERE employee_id = ?").all(employeeId) as Array<{ id: number }>;
        const ids = holerithIds.map((row) => row.id);
        let deletedEntries = 0;
        for (const holId of ids) {
          const delE = db.prepare("DELETE FROM entries WHERE marcacao_id IN (SELECT id FROM marcacoes WHERE holerith_id = ?)").run(holId);
          deletedEntries += delE.changes;
          db.prepare("DELETE FROM marcacoes WHERE holerith_id = ?").run(holId);
          db.prepare("DELETE FROM banco_horas WHERE holerith_id = ?").run(holId);
          db.prepare("DELETE FROM holeriths WHERE id = ?").run(holId);
        }
        db.prepare("DELETE FROM simulator_plans WHERE employee_id = ?").run(employeeId);
        return deletedEntries;
      });

      const count = tx();
      res.json({ success: true, count });
    } catch (err: any) {
      console.error("Error in DELETE /api/referencias:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), "dist");
    const distIndex = path.join(distDir, "index.html");
    if (fs.existsSync(distIndex)) {
      app.use(express.static(distDir));
      app.get("*", (req, res) => {
        res.sendFile(distIndex);
      });
    } else {
      app.get("/", (_req, res) => {
        res.json({ status: "ok", service: "smart-point-api" });
      });
    }
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`SQLite path: ${dbPath}`);
  });
}

startServer();


