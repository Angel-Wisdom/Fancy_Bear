// ============================================================
// Suraksha 2.0 — Offline JSON Store
// Pure JavaScript fallback to avoid native build requirements.
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORE_PATH = join(__dirname, '..', 'suraksha.store.json');

const TABLES = [
    'users', 'customers', 'documents', 'financial_records', 'land_records',
    'verification_results', 'alerts', 'audit_log', 'system_settings'
];

let _db = null;

function createEmptyStore() {
    return Object.fromEntries(TABLES.map((table) => [table, []]));
}

function loadStore() {
    if (!existsSync(STORE_PATH)) return createEmptyStore();

    try {
        const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
        const store = createEmptyStore();
        for (const table of TABLES) {
            store[table] = Array.isArray(parsed?.[table]) ? parsed[table] : [];
        }
        return store;
    } catch {
        return createEmptyStore();
    }
}

function saveStore(store) {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function clone(row) {
    return row ? JSON.parse(JSON.stringify(row)) : row;
}

function stripQuotes(value) {
    return String(value).replace(/^['"]|['"]$/g, '');
}

function extractTable(sql) {
    const match = sql.match(/from\s+([a-z_]+)/i) || sql.match(/into\s+([a-z_]+)/i) || sql.match(/delete\s+from\s+([a-z_]+)/i);
    return match ? match[1] : null;
}

function compareValues(left, right) {
    if (left == null || right == null) return left === right;
    return String(left) === String(right);
}

function sortByField(rows, field, direction = 'asc') {
    return [...rows].sort((a, b) => {
        const left = a?.[field];
        const right = b?.[field];
        if (left === right) return 0;
        return (String(left) < String(right) ? -1 : 1) * (direction.toLowerCase() === 'desc' ? -1 : 1);
    });
}

function applyLimit(rows, sql) {
    const limit = sql.match(/limit\s+(\d+)/i);
    return limit ? rows.slice(0, Number(limit[1])) : rows;
}

function getParamValue(params, index, name) {
    if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
        const source = params[0];
        if (name && name in source) return source[name];
        const keys = Object.keys(source);
        if (index < keys.length) return source[keys[index]];
    }
    return params[index];
}

function rowsForInsert(sql, params) {
    const columnsMatch = sql.match(/\(([^)]+)\)\s*values/i);
    const columns = columnsMatch ? columnsMatch[1].split(',').map((value) => stripQuotes(value.trim()).replace(/^@/, '')) : [];
    const row = {};
    columns.forEach((column, index) => {
        const placeholder = sql.match(/values\s*\(([^)]+)\)/i)?.[1]?.split(',')[index]?.trim() || '';
        const key = placeholder.replace(/^[@:$]/, '').replace(/[?)]+$/, '');
        if (placeholder.startsWith('@') && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
            row[column] = params[0][key];
        } else {
            row[column] = getParamValue(params, index, key || column);
        }
    });
    return row;
}

function handleSelect(sql, params, store) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (/select count\(\*\) as count from documents/i.test(normalized)) {
        return [{ count: store.documents.length }];
    }

    if (/select count\(\*\) as count from alerts/i.test(normalized)) {
        return [{ count: store.alerts.length }];
    }

    if (/select coalesce\(round\(100\.0 \* sum\(case when status = 'pass' then 1 else 0 end\)\/nullif\(count\(\*\), 0\), 1\), 0\) as value from verification_results/i.test(normalized)) {
        const total = store.verification_results.length;
        const passed = store.verification_results.filter((row) => row.status === 'pass').length;
        return [{ value: total ? Math.round((1000 * passed / total)) / 10 : 0 }];
    }

    if (/select coalesce\(round\(avg\(run_duration_ms\), 1\), 0\) as value from verification_results/i.test(normalized)) {
        const durations = store.verification_results.map((row) => Number(row.run_duration_ms) || 0).filter(Boolean);
        const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
        return [{ value: Math.round(average * 10) / 10 }];
    }

    if (/select \* from users where username = \? and is_active = 1/i.test(normalized)) {
        const username = params[0];
        return store.users.filter((row) => row.username === username && Number(row.is_active ?? 1) === 1).map(clone);
    }

    if (/select id, full_name, date_of_birth, city, state, occupation, annual_income, risk_score from customers/i.test(normalized)) {
        return applyLimit(sortByField(store.customers, 'full_name', 'asc').map(({ id, full_name, date_of_birth, city, state, occupation, annual_income, risk_score }) => ({ id, full_name, date_of_birth, city, state, occupation, annual_income, risk_score })), normalized);
    }

    if (/select \* from customers where id = \?/i.test(normalized)) {
        const customerId = params[0];
        return store.customers.filter((row) => compareValues(row.id, customerId)).map(clone);
    }

    if (/select \* from financial_records where customer_id = \?/i.test(normalized)) {
        const customerId = params[0];
        return applyLimit(sortByField(store.financial_records.filter((row) => compareValues(row.customer_id, customerId)), 'transaction_date', 'desc').map(clone), normalized);
    }

    if (/select \* from documents where customer_id = \?/i.test(normalized)) {
        const customerId = params[0];
        return applyLimit(sortByField(store.documents.filter((row) => compareValues(row.customer_id, customerId)), 'created_at', 'desc').map(clone), normalized);
    }

    if (/select id from customers limit 1/i.test(normalized)) {
        return store.customers.slice(0, 1).map(({ id }) => ({ id }));
    }

    if (/select \* from land_records where customer_id = \?/i.test(normalized)) {
        const customerId = params[0];
        return applyLimit(store.land_records.filter((row) => compareValues(row.customer_id, customerId)).map(clone), normalized);
    }

    if (/select d\.\*, c\.full_name as customer_name from documents d join customers c on c\.id = d\.customer_id/i.test(normalized)) {
        const joined = store.documents.map((document) => ({
            ...document,
            customer_name: store.customers.find((customer) => compareValues(customer.id, document.customer_id))?.full_name || null,
        }));
        return applyLimit(sortByField(joined, 'created_at', 'desc').map(clone), normalized);
    }

    if (/select \* from documents where id = \?/i.test(normalized)) {
        const documentId = params[0];
        return store.documents.filter((row) => compareValues(row.id, documentId)).map(clone);
    }

    if (/select v\.\*, c\.full_name as customer_name from verification_results v join customers c on c\.id = v\.customer_id where v\.customer_id = \?/i.test(normalized)) {
        const customerId = params[0];
        const results = store.verification_results.filter((row) => compareValues(row.customer_id, customerId));
        const latest = sortByField(results, 'created_at', 'desc')[0];
        if (!latest) return [];
        return [{
            ...clone(latest),
            customer_name: store.customers.find((customer) => compareValues(customer.id, latest.customer_id))?.full_name || null,
        }];
    }

    if (/select \* from alerts order by created_at desc limit 20/i.test(normalized)) {
        return applyLimit(sortByField(store.alerts, 'created_at', 'desc').map(clone), normalized);
    }

    if (/select \* from audit_log order by created_at desc limit 100/i.test(normalized)) {
        return applyLimit(sortByField(store.audit_log, 'created_at', 'desc').map(clone), normalized);
    }

    if (/select \* from [a-z_]+ where id = \?/i.test(normalized)) {
        const table = extractTable(normalized);
        const rowId = params[0];
        return (store[table] || []).filter((row) => compareValues(row.id, rowId)).map(clone);
    }

    if (/select \* from [a-z_]+ where customer_id = \?/i.test(normalized)) {
        const table = extractTable(normalized);
        const customerId = params[0];
        return (store[table] || []).filter((row) => compareValues(row.customer_id, customerId)).map(clone);
    }

    return [];
}

function handleDelete(sql, store) {
    const table = extractTable(sql);
    if (!table || !(table in store)) return { changes: 0 };
    const count = store[table].length;
    store[table] = [];
    return { changes: count };
}

function handleInsert(sql, params, store) {
    const table = extractTable(sql);
    if (!table || !(table in store)) return { changes: 0, lastInsertRowid: null };
    const row = rowsForInsert(sql, params);
    store[table].push(row);
    return { changes: 1, lastInsertRowid: row.id ?? null };
}

class Statement {
    constructor(sql, store) {
        this.sql = sql;
        this.store = store;
    }

    run(...params) {
        const normalized = this.sql.replace(/\s+/g, ' ').trim();
        if (/^insert into/i.test(normalized)) {
            return handleInsert(normalized, params, this.store);
        }
        if (/^delete from/i.test(normalized)) {
            return handleDelete(normalized, this.store);
        }
        return { changes: 0 };
    }

    get(...params) {
        return this.all(...params)[0] || undefined;
    }

    all(...params) {
        return handleSelect(this.sql, params, this.store);
    }
}

function createDb() {
    const store = loadStore();

    return {
        pragma() {},
        exec() {},
        transaction(fn) {
            return (...args) => fn(...args);
        },
        prepare(sql) {
            return new Statement(sql, store);
        },
        close() {
            saveStore(store);
        },
        __store: store,
    };
}

export function getDb() {
    if (_db) return _db;
    _db = createDb();
    return _db;
}

export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
        console.log('[DB] Store closed.');
    }
}

export function runInTransaction(fn) {
    const db = getDb();
    const transaction = db.transaction(fn);
    return transaction();
}

export function run(sql, ...params) {
    return getDb().prepare(sql).run(...params);
}

export function getOne(sql, ...params) {
    return getDb().prepare(sql).get(...params);
}

/**
 * Helper: prepare + get all rows.
 */
export function getAll(sql, ...params) {
    return getDb().prepare(sql).all(...params);
}

export default { getDb, closeDb, runInTransaction, run, getOne, getAll };
