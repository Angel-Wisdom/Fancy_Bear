# SuRaksha 2.0 — Document Anomaly Detection & Fraud Prevention

> Real-time offline document verification stack for bank underwriting — featuring KYC checks, financial anomaly detection (Benford's Law, salami slicing), land record verification, Aadhaar QR decoding, and a full audit trail.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start — Docker (Recommended)](#quick-start--docker-recommended)
- [Manual Setup](#manual-setup)
- [Login Credentials](#login-credentials)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser :5173                     │
│            React + Vite (client/)                   │
└──────────────────────┬──────────────────────────────┘
                       │ /api/*  (proxied)
┌──────────────────────▼──────────────────────────────┐
│              Node.js Express :3001                  │
│                  (server/)                          │
│  auth · customers · documents · verify · reports   │
└────────┬─────────────────────────────────┬──────────┘
         │ JSON store                      │ http proxy
         ▼                                 ▼
  suraksha.store.json          ┌───────────────────────┐
  (no DB required)             │  Flask Aadhaar QR :5000│
                               │      (aadhar/)         │
                               │  pyzbar · pyaadhaar    │
                               └───────────────────────┘
```

**Three services, all offline — no cloud dependency:**

| Service | Tech | Port | Role |
|---------|------|------|------|
| `client` | React 18 + Vite | 5173 | UI — all screens, canvas QR scanner |
| `server` | Node.js 22 + Express | 3001 | REST API, verification engines, JWT auth |
| `aadhaar` | Python 3.11 + Flask | 5000 | Aadhaar QR decode microservice |

---

## Features

| Module | What it does |
|--------|-------------|
| **Upload & Verify** | Drag-and-drop document upload, SHA-256 hashing, OCR, ELA forensics |
| **Aadhaar QR Verification** | Camera/upload image → auto-detect QR → decode Secure V2/V1/Old XML — all offline |
| **Financial Analysis** | Benford's Law, salami-slicing detection, statistical outliers |
| **Land Records** | Ownership chain, survey number, encumbrance checks |
| **KYC Engine** | PAN, Aadhaar, name, DOB, address field matching |
| **Reports** | Verification summary, PDF export |
| **Audit Log** | Immutable log of every action with cryptographic signature |
| **Dashboard** | Live stats, alerts, recent activity |

---

## Prerequisites

### Docker setup (easiest)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — that's all you need.

### Manual setup
- **Node.js** ≥ 22  →  [nodejs.org](https://nodejs.org/)
- **Python** ≥ 3.10  →  [python.org](https://www.python.org/)
- **pip** (comes with Python)

---

## Quick Start — Docker (Recommended)

**One command. Everything starts automatically.**

```bash
# Clone and enter the project
git clone <repo-url>
cd SuRaksha2.0_FancyBear

# Build images and start all three services
docker compose up --build
```

Wait for all three services to be ready (first build takes ~3–5 min to pull images and install packages):

```
suraksha-aadhaar  | * Running on http://0.0.0.0:5000
suraksha-server   | [server] Listening on http://127.0.0.1:3001
suraksha-client   | ➜  Local:   http://localhost:5173/
```

Then open **http://localhost:5173** in your browser.

### Docker commands cheat sheet

```bash
# Start everything (after first build)
docker compose up

# Start and rebuild if source changed
docker compose up --build

# Start in background (detached)
docker compose up -d

# Stop all containers
docker compose down

# Watch combined logs from all services
docker compose logs -f

# Watch logs from one service only
docker compose logs -f aadhaar
docker compose logs -f server
docker compose logs -f client

# Rebuild a single service (e.g. after server code change)
docker compose up --build server

# Open a shell inside a running container
docker compose exec server sh
docker compose exec aadhaar bash
```

> **Hot-reload**: React client supports hot-module-reload in Docker — save a `.jsx` file and the browser updates instantly. For Node server or Flask changes, rebuild with `docker compose up --build server` or `docker compose up --build aadhaar`.

---

## Manual Setup

Run each step in the project root unless otherwise noted.

### Step 1 — Install JS dependencies

```bash
npm install
```

> On Windows PowerShell, if `npm` is not recognized:
> ```powershell
> & "$env:ProgramFiles\nodejs\npm.cmd" install
> ```

### Step 2 — Seed demo data

```bash
npm run seed
```

This generates `server/suraksha.store.json` with demo users, customers, financial records, land records, alerts, and documents. **Skip if the file already exists.**

### Step 3 — Install Python dependencies for Aadhaar service

```bash
cd aadhar

# Create and activate a virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

pip install -r requirements.txt
```

### Step 4 — Start all three services

You need **three separate terminal windows**:

**Terminal 1 — Aadhaar Flask microservice**
```bash
cd aadhar
venv\Scripts\activate   # if using venv
python app.py
# Starts on http://localhost:5000
```

**Terminal 2 — Node.js API server**
```bash
cd server
node index.js
# Starts on http://localhost:3001
```

**Terminal 3 — React client**
```bash
cd client
npm run dev
# Starts on http://localhost:5173
```

> **Shortcut**: Terminals 2 & 3 can be combined from the project root:
> ```bash
> npm run dev
> ```
> (starts both client and server via `concurrently` — but you still need Terminal 1 for Flask)

### Step 5 — Open the app

Navigate to **http://localhost:5173**

---

## Login Credentials

| Username | Password | Role |
|----------|----------|------|
| `junior1` | `suraksha@123` | Junior Officer |
| `senior1` | `suraksha@456` | Senior Officer |
| `manager1` | `suraksha@789` | Manager |

---

## Project Structure

```
SuRaksha2.0_FancyBear/
│
├── docker-compose.yml          ← One-command Docker orchestration
│
├── client/                     ← React 18 + Vite frontend
│   ├── Dockerfile
│   ├── vite.config.js          ← Dev server + API proxy config
│   └── src/
│       ├── App.jsx             ← Route definitions
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── UploadVerify.jsx
│       │   ├── AadhaarVerify.jsx   ← Canvas-based QR scanner
│       │   ├── VerificationResults.jsx
│       │   ├── FinancialAnalysis.jsx
│       │   ├── LandRecords.jsx
│       │   ├── Reports.jsx
│       │   └── AuditLog.jsx
│       ├── components/
│       │   ├── layout/         ← Sidebar, Header, MainLayout
│       │   ├── RiskGauge.jsx
│       │   ├── BenfordChart.jsx
│       │   └── ...
│       ├── context/
│       │   └── AuthContext.jsx ← JWT auth state, role checks
│       └── utils/
│           └── api.js          ← Fetch wrapper with auth headers
│
├── server/                     ← Node.js 22 + Express API
│   ├── Dockerfile
│   ├── index.js                ← Express app entry point
│   ├── routes/
│   │   ├── auth.js             ← POST /api/auth/login
│   │   ├── customers.js        ← GET  /api/customers
│   │   ├── documents.js        ← POST /api/documents/upload
│   │   ├── verify.js           ← POST /api/verify/{kyc,financial,land,full}
│   │   ├── dashboard.js        ← GET  /api/dashboard/stats
│   │   ├── reports.js          ← GET  /api/reports
│   │   └── aadhaar.js          ← POST /api/aadhaar/detect  ← proxies to Flask
│   ├── engines/
│   │   ├── ocr-engine.js
│   │   ├── crypto-engine.js    ← SHA-256, HMAC, AES
│   │   ├── anomaly-engine.js   ← Benford, salami, outliers, duplicates
│   │   ├── forensics-engine.js ← Metadata tamper signals
│   │   ├── kyc-engine.js       ← PAN, Aadhaar, field matching
│   │   └── land-record-engine.js
│   ├── middleware/
│   │   ├── auth.js             ← JWT verifyToken
│   │   └── security.js         ← Helmet, CORS, rate-limit
│   └── db/
│       ├── database.js         ← Pure-JS JSON store (no SQLite required)
│       ├── schema.sql          ← Reference schema
│       └── seed.js             ← Demo data generator
│
├── aadhar/                     ← Python Flask Aadhaar microservice
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py                  ← POST /detect — pyzbar + pyaadhaar decode
│
└── uploads/                    ← Uploaded document files (git-ignored)
```

---

## API Reference

All routes except `/api/auth/login` and `/api/health` require a Bearer token.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/customers` | List customers |
| `POST` | `/api/documents/upload` | Upload document files |
| `POST` | `/api/verify/kyc` | Run KYC verification |
| `POST` | `/api/verify/financial` | Run financial anomaly analysis |
| `POST` | `/api/verify/land-record` | Run land record verification |
| `POST` | `/api/verify/full` | Run full combined verification |
| `GET` | `/api/dashboard/stats` | Dashboard statistics |
| `GET` | `/api/reports` | Verification report list |
| `POST` | `/api/aadhaar/detect` | Decode Aadhaar QR from base64 image |

---

## Environment Variables

### Node server (`server/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Express listen port |
| `AADHAAR_SERVICE_HOST` | `127.0.0.1` | Flask service host (set to `aadhaar` in Docker) |
| `AADHAAR_SERVICE_PORT` | `5000` | Flask service port |

### React client (`client/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_TARGET` | `http://localhost:3001` | API proxy target (set to `http://server:3001` in Docker) |
