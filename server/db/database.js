import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SURAKSHA_DB_PATH || path.join(__dirname, '..', 'suraksha.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

export function getDb() {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const schemaSql = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schemaSql); // idempotent — every statement is CREATE TABLE/INDEX IF NOT EXISTS

  // Polyfill better-sqlite3's db.transaction(fn) API, which node:sqlite's DatabaseSync
  // doesn't have natively. This means seed.js's existing `db.transaction((rows) => {...})`
  // calls keep working completely unmodified — no changes needed there.
  db.transaction = (fn) => {
    return (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    };
  };

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// node:sqlite's DatabaseSync has no built-in `.transaction()` wrapper (better-sqlite3 does —
// this is the one real API gap between the two). Small hand-rolled equivalent:
export function runInTransaction(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

export function getOne(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

export function getAll(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

export default { getDb, closeDb, runInTransaction, run, getOne, getAll };
