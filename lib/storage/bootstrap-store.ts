import "server-only";

import {randomBytes} from "node:crypto";
import {mkdirSync} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_BOOTSTRAP_SQLITE_RELATIVE_PATH = path.join(
  ".sisyphus",
  "local-data",
  "storage-bootstrap.db"
);
const BOOTSTRAP_SINGLETON_ID = "global";

interface BootstrapRow {
  id: string;
  admin_session_secret: string | null;
  updated_at: string | null;
}

let bootstrapDbCache:
  | {
      filePath: string;
      db: Database.Database;
    }
  | null = null;

function normalizeEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getBootstrapFilePath(): string {
  const configured = normalizeEnv(process.env.STORAGE_BOOTSTRAP_SQLITE_PATH);
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  return path.resolve(process.cwd(), DEFAULT_BOOTSTRAP_SQLITE_RELATIVE_PATH);
}

function getBootstrapDb(): Database.Database {
  const filePath = getBootstrapFilePath();
  if (bootstrapDbCache?.filePath === filePath) {
    return bootstrapDbCache.db;
  }

  mkdirSync(path.dirname(filePath), {recursive: true});
  const db = new Database(filePath) as Database.Database;
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_settings (
      id text PRIMARY KEY,
      admin_session_secret text,
      updated_at text NOT NULL
    )
  `);

  bootstrapDbCache = {filePath, db};
  return db;
}

function ensureSingletonRow(): BootstrapRow {
  const db = getBootstrapDb();
  const existing = db
    .prepare(`SELECT * FROM bootstrap_settings WHERE id = ? LIMIT 1`)
    .get(BOOTSTRAP_SINGLETON_ID) as BootstrapRow | undefined;

  if (existing) {
    return existing;
  }

  db.prepare(
    `
      INSERT INTO bootstrap_settings (id, admin_session_secret, updated_at)
      VALUES (?, null, ?)
    `
  ).run(BOOTSTRAP_SINGLETON_ID, new Date().toISOString());

  return db
    .prepare(`SELECT * FROM bootstrap_settings WHERE id = ? LIMIT 1`)
    .get(BOOTSTRAP_SINGLETON_ID) as BootstrapRow;
}

export function getBootstrapAdminSessionSecret(): string | null {
  return ensureSingletonRow().admin_session_secret;
}

export function ensureBootstrapAdminSessionSecret(): string {
  const existing = getBootstrapAdminSessionSecret();
  if (existing) {
    return existing;
  }

  const generated = randomBytes(32).toString("base64url");
  const db = getBootstrapDb();
  db.prepare(
    `
      UPDATE bootstrap_settings
      SET admin_session_secret = ?,
          updated_at = ?
      WHERE id = ?
    `
  ).run(generated, new Date().toISOString(), BOOTSTRAP_SINGLETON_ID);

  return generated;
}
