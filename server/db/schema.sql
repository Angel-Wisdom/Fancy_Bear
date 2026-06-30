-- ============================================================
-- Suraksha 2.0 — Full Database Schema
-- Real-time Document Anomaly Detection System
-- ============================================================

-- ── Users & Authentication ──────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('verifier')),
    email           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_login      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Customers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id              TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL,
    date_of_birth   TEXT NOT NULL,
    gender          TEXT CHECK (gender IN ('M', 'F', 'O')),
    pan_number      TEXT UNIQUE,
    aadhaar_number  TEXT UNIQUE,
    phone           TEXT,
    email           TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    city            TEXT,
    state           TEXT,
    pincode         TEXT,
    occupation      TEXT,
    annual_income   REAL,
    risk_score      REAL DEFAULT 0.0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Documents ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    uploaded_by     TEXT NOT NULL,
    doc_type        TEXT NOT NULL CHECK (doc_type IN (
                        'pan_card', 'aadhaar_card', 'passport',
                        'bank_statement', 'salary_slip', 'itr',
                        'land_title', 'encumbrance_cert', 'sale_deed',
                        'property_tax', 'photograph', 'other'
                    )),
    original_name   TEXT NOT NULL,
    stored_path     TEXT NOT NULL,
    mime_type       TEXT,
    file_size       INTEGER,
    file_hash       TEXT,                -- SHA-256 hash of the file
    fingerprint     TEXT,                -- Document fingerprint for dedup
    ocr_text        TEXT,                -- Extracted OCR text
    ocr_confidence  REAL,                -- Average OCR confidence (0-100)
    metadata_json   TEXT,                -- EXIF / PDF metadata as JSON
    status          TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                        'uploaded', 'processing', 'verified', 'flagged', 'rejected'
                    )),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (uploaded_by)  REFERENCES users(id)
);

-- ── Financial Records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_records (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    record_type     TEXT NOT NULL CHECK (record_type IN (
                        'credit', 'debit', 'salary', 'emi', 'transfer',
                        'cash_deposit', 'cash_withdrawal', 'refund', 'fee', 'interest'
                    )),
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    source_account  TEXT,
    dest_account    TEXT,
    description     TEXT,
    transaction_date TEXT NOT NULL,
    reference_number TEXT,
    is_flagged      INTEGER NOT NULL DEFAULT 0,
    flag_reason     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ── Land Records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS land_records (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    survey_number   TEXT NOT NULL,
    sub_division    TEXT,
    village         TEXT NOT NULL,
    taluk           TEXT NOT NULL,
    district        TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'Karnataka',
    total_area      REAL NOT NULL,          -- in sq. metres
    area_unit       TEXT NOT NULL DEFAULT 'sqm',
    registered_owner TEXT NOT NULL,
    previous_owner  TEXT,
    registration_number TEXT,
    registration_date   TEXT,
    market_value    REAL,
    guideline_value REAL,
    has_encumbrance INTEGER NOT NULL DEFAULT 0,
    encumbrance_details TEXT,
    mutation_status TEXT CHECK (mutation_status IN ('completed', 'pending', 'disputed', 'not_applicable')),
    ownership_chain_json TEXT,            -- JSON array of historical owners
    is_flagged      INTEGER NOT NULL DEFAULT 0,
    flag_reason     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ── Verification Results ────────────────────────────────────
CREATE TABLE IF NOT EXISTS verification_results (
    id              TEXT PRIMARY KEY,
    document_id     TEXT,
    customer_id     TEXT NOT NULL,
    verification_type TEXT NOT NULL CHECK (verification_type IN (
                        'kyc', 'financial', 'land_record', 'forensic', 'full'
                    )),
    status          TEXT NOT NULL CHECK (status IN (
                        'pass', 'fail', 'warning', 'pending', 'error'
                    )),
    overall_score   REAL,                  -- 0–100, higher = more trustworthy
    details_json    TEXT NOT NULL,          -- Full structured result
    engine_version  TEXT DEFAULT '2.0.0',
    run_by          TEXT NOT NULL,
    run_duration_ms INTEGER,               -- How long the check took
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id)  REFERENCES documents(id),
    FOREIGN KEY (customer_id)  REFERENCES customers(id),
    FOREIGN KEY (run_by)       REFERENCES users(id)
);

-- ── Alerts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT,
    document_id     TEXT,
    verification_id TEXT,
    alert_type      TEXT NOT NULL CHECK (alert_type IN (
                        'benford_violation', 'salami_attack', 'duplicate_document',
                        'metadata_tampering', 'kyc_mismatch', 'land_dispute',
                        'statistical_outlier', 'ela_anomaly', 'ownership_mismatch',
                        'forged_document', 'system'
                    )),
    severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    is_resolved     INTEGER NOT NULL DEFAULT 0,
    resolved_by     TEXT,
    resolved_at     TEXT,
    resolution_note TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id)    REFERENCES customers(id),
    FOREIGN KEY (document_id)    REFERENCES documents(id),
    FOREIGN KEY (verification_id) REFERENCES verification_results(id),
    FOREIGN KEY (resolved_by)    REFERENCES users(id)
);

-- ── Audit Log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    details_json    TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── System Settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    description     TEXT,
    updated_by      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- ── Indexes for Performance ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_customer     ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_status       ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_type         ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_financial_customer     ON financial_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_financial_date         ON financial_records(transaction_date);
CREATE INDEX IF NOT EXISTS idx_financial_amount       ON financial_records(amount);
CREATE INDEX IF NOT EXISTS idx_financial_flagged      ON financial_records(is_flagged);
CREATE INDEX IF NOT EXISTS idx_land_customer          ON land_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_land_survey            ON land_records(survey_number);
CREATE INDEX IF NOT EXISTS idx_land_flagged           ON land_records(is_flagged);
CREATE INDEX IF NOT EXISTS idx_verification_customer  ON verification_results(customer_id);
CREATE INDEX IF NOT EXISTS idx_verification_type      ON verification_results(verification_type);
CREATE INDEX IF NOT EXISTS idx_alerts_customer        ON alerts(customer_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity        ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved        ON alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_audit_user             ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action           ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created          ON audit_log(created_at);
