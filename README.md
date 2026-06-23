# ITR Credentials Generation Automation

> Take-home assignment submission for **RegisterKaro** — Full-Stack Developer role.

A production-grade automation system that drives the Income Tax e-filing portal's "Forgot Password" flow using Playwright, persists the generated credentials encrypted in MongoDB, and exposes a real-time operations dashboard built with Next.js 15.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Project Structure](#project-structure)
5. [Environment Variables](#environment-variables)
6. [Running Locally](#running-locally)
7. [Running Tests](#running-tests)
8. [API Reference](#api-reference)
9. [Security Design](#security-design)
10. [Tech Stack](#tech-stack)

---

## System Overview

The system has three distinct, independently deployable layers:

| Layer | Tech | Role |
|---|---|---|
| `service/` | Node.js + Express + MongoDB | REST API, webhook ingestion, SSE fan-out, job lifecycle |
| `automation/` | Playwright + TypeScript | Headless browser bot driving the IT portal |
| `ui/` | Next.js 15 + React 19 | Operations dashboard — live console, OTP/CAPTCHA input |

**Flow:**
1. Operator submits a PAN via the dashboard → `POST /jobs`
2. Service spawns the Playwright bot as a child process
3. Bot navigates the IT portal, pushing events to `POST /webhook/events` at each step
4. Service persists events and fans them out over SSE to all connected dashboard clients
5. When the bot reaches CAPTCHA/OTP steps, it pauses and polls for operator input
6. Operator enters CAPTCHA/OTP in the dashboard — service stores it for the bot to consume
7. On success, credentials are encrypted (AES-256-GCM) and stored in MongoDB

---

## Prerequisites

- **Node.js** ≥ 18 (tested on v22)
- **npm** ≥ 9
- **MongoDB** running locally (default: `mongodb://localhost:27017`)
  - Install via [MongoDB Community Edition](https://www.mongodb.com/try/download/community)
  - Or use **MongoDB Compass** (GUI) to verify/manage data
- **Playwright browsers**: `npx playwright install chromium`

---

## Quick Start

```bash
# 1. Clone / unzip the repository
cd "ITR Credential Generation"

# 2. Build the shared types package
cd shared && npm install && npm run build && cd ..

# 3. Install all dependencies
cd service    && npm install && cd ..
cd automation && npm install && cd ..
cd ui         && npm install && cd ..

# 4. Install Playwright browser
cd automation && npx playwright install chromium && cd ..

# 5. Start MongoDB (if not already running as a service)
#    On Windows: net start MongoDB
#    Or open MongoDB Compass and connect to mongodb://localhost:27017

# 6. Start service + UI together (from project root)
cd .. # go to project root
npm install
npm run dev
```

Open **http://localhost:3000** for the dashboard and **http://localhost:4000/health** to verify the service.

---

## Project Structure

```
ITR Credential Generation/
├── shared/                     # Shared TypeScript types (@itr/shared)
│   ├── types.ts                # Job, JobEvent, Phase, Outcome, helpers
│   └── package.json
│
├── service/                    # Node.js/Express backend service
│   ├── src/
│   │   ├── config/             # Environment config + validation
│   │   ├── crypto/             # AES-256-GCM encrypt/decrypt helpers
│   │   ├── db/
│   │   │   ├── client.ts       # Mongoose connection
│   │   │   └── models/         # Job + Event Mongoose schemas
│   │   ├── domain/
│   │   │   └── job.ts          # Job lifecycle + bot process management
│   │   ├── middleware/
│   │   │   └── auth.ts         # Bearer token + webhook secret guards
│   │   ├── repository/
│   │   │   ├── job-repo.ts     # Job CRUD + metrics + OTP/CAPTCHA handshake
│   │   │   └── event-repo.ts   # Event persistence + cursor replay
│   │   ├── routes/
│   │   │   ├── jobs.ts         # POST /jobs, GET /jobs, GET /jobs/:id, POST /jobs/:id/cancel
│   │   │   ├── webhook.ts      # POST /webhook/events (bot → service)
│   │   │   ├── sse.ts          # GET /jobs/:id/stream (SSE live feed)
│   │   │   ├── otp.ts          # POST /jobs/:id/otp, POST /jobs/:id/captcha
│   │   │   ├── poll.ts         # GET /jobs/:id/otp-poll, GET /jobs/:id/captcha-poll (bot polls)
│   │   │   ├── events.ts       # GET /jobs/:id/events (full history)
│   │   │   └── metrics.ts      # GET /metrics (p50/p99 + counts)
│   │   ├── sse/
│   │   │   └── fan-out.ts      # Ring-buffer SSE fan-out manager
│   │   ├── logger/             # Pino structured logger
│   │   └── server.ts           # Express app + graceful shutdown
│   ├── tests/
│   │   └── event-replay.test.ts
│   └── .env                    # ← copy .env.example and fill in values
│
├── automation/                 # Playwright bot
│   ├── src/
│   │   ├── browser/            # Chromium launch/teardown + screenshot helper
│   │   ├── config/             # Bot environment config
│   │   ├── crypto/             # Encrypt helper (mirrors service)
│   │   ├── logger/             # Pino logger
│   │   ├── state-machine/      # FSM — Phase transitions + guards
│   │   ├── webhook-client/     # Authenticated POST to service with retry
│   │   ├── runner.ts           # Main automation loop (all portal phases)
│   │   └── index.ts            # Entry point — parses jobId + PAN from args
│   └── tests/
│       ├── state-machine.test.ts
│       └── validation.test.ts
│
├── ui/                         # Next.js 15 dashboard
│   ├── app/
│   │   ├── layout.tsx          # Root layout + header
│   │   ├── globals.css         # Design system + CSS variables
│   │   ├── page.tsx            # Dashboard — metrics strip + run table
│   │   └── runs/[jobId]/
│   │       ├── page.tsx        # Server-rendered run detail page
│   │       └── RunConsole.tsx  # Client — stepper, live console, OTP/CAPTCHA
│   ├── components/
│   │   ├── DashboardRefresher.tsx
│   │   ├── HumanInputDialogs.tsx  # OTP + CAPTCHA input modals
│   │   ├── LiveConsole.tsx        # SSE-subscribed event log
│   │   ├── MetricsStrip.tsx
│   │   ├── PhaseStepper.tsx
│   │   ├── RunTable.tsx
│   │   └── StartJobModal.tsx
│   ├── lib/
│   │   ├── api.ts              # Client-side API wrapper
│   │   └── api-server.ts       # Server-side API wrapper (SSR)
│   └── .env.local
│
├── package.json                # Root — `npm run dev` starts service + UI
├── README.md
└── ARCHITECTURE.md
```

---

## Environment Variables

### `service/.env`

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string. Local: `mongodb://localhost:27017` |
| `PORT` | — | HTTP port (default: `4000`) |
| `NODE_ENV` | — | `development` / `production` |
| `API_BEARER_TOKEN` | ✅ | Secret token — UI sends `Authorization: Bearer <token>` |
| `WEBHOOK_SECRET` | ✅ | Secret — bot sends `X-Webhook-Secret: <secret>` |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex key for AES-256-GCM credential encryption |
| `RING_BUFFER_SIZE` | — | In-memory SSE ring buffer size (default: `500`) |
| `LOG_LEVEL` | — | Pino log level (default: `debug`) |

### `automation/.env`

| Variable | Required | Description |
|---|---|---|
| `SERVICE_URL` | ✅ | Base URL of the service (e.g. `http://localhost:4000`) |
| `WEBHOOK_SECRET` | ✅ | Must match service `WEBHOOK_SECRET` |
| `ENCRYPTION_KEY` | ✅ | Must match service `ENCRYPTION_KEY` |
| `HEADLESS` | — | `true`/`false` — whether to show the browser (default: `false`) |
| `PORTAL_URL` | — | IT portal URL (default: incometax.gov.in) |
| `STEP_TIMEOUT_MS` | — | Playwright page step timeout in ms (default: `30000`) |

### `ui/.env.local`

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Service base URL (default: `http://localhost:4000`) |
| `NEXT_PUBLIC_API_TOKEN` | Must match service `API_BEARER_TOKEN` |

---

## Running Locally

### Option A — All in one (recommended)

```bash
# From project root
npm run dev
# Service starts on :4000, UI on :3000
```

### Option B — Separately (for debugging)

**Terminal 1 — Service:**
```bash
cd service
npm run dev
# Watch logs for: Service listening on port 4000
# Watch logs for: MongoDB connected
```

**Terminal 2 — UI:**
```bash
cd ui
npm run dev
# Open http://localhost:3000
```

### Connecting MongoDB Compass

Open **MongoDB Compass** and connect to:
```
mongodb://localhost:27017
```
Database: `itr-credentials`
Collections visible after first run:
- `jobs` — one document per automation run
- `events` — all step-level events for every run

---

## Running Tests

```bash
# Service tests (event replay correctness)
cd service && npm test

# Automation tests (state machine + PAN validation)
cd automation && npm test

# All tests from root
npm run test:all
```

---

## API Reference

### Jobs

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/jobs` | Bearer | Start a new run. Body: `{ "pan": "ABCDE1234F" }` |
| `GET` | `/jobs` | Bearer | List all jobs. Query: `?phase=&outcome=` |
| `GET` | `/jobs/:id` | Bearer | Get job by ID |
| `POST` | `/jobs/:id/cancel` | Bearer | Cancel a running job |
| `GET` | `/jobs/:id/stream` | — | SSE live event stream. Supports `Last-Event-ID` |
| `GET` | `/jobs/:id/events` | Bearer | Full event history |
| `POST` | `/jobs/:id/otp` | Bearer | Submit OTP (operator → service) |
| `POST` | `/jobs/:id/captcha` | Bearer | Submit CAPTCHA solution |

### Metrics

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/metrics` | — | Success rate, p50/p99 duration, active run count |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |

### Webhook (bot → service, internal)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/webhook/events` | X-Webhook-Secret | Bot pushes step events |
| `GET` | `/jobs/:id/otp-poll` | X-Webhook-Secret | Bot polls for operator OTP |
| `GET` | `/jobs/:id/captcha-poll` | X-Webhook-Secret | Bot polls for CAPTCHA solution |

---

## Security Design

| Concern | Solution |
|---|---|
| PAN at rest | AES-256-GCM encrypted; only masked version (`ABCDE****F`) stored in plain text |
| Password at rest | AES-256-GCM encrypted before storing |
| PAN in logs | Redacted via Pino `redact` config — never appears in log output |
| API access | Bearer token required on all mutating/read routes |
| Bot → Service | Shared webhook secret header (`X-Webhook-Secret`) |
| CAPTCHA | Manual solve — screenshot sent to operator in the dashboard; no 3rd-party API |
| OTP | Never stored beyond the instant the bot consumes it (`$unset` in same DB round-trip) |

---

## Tech Stack

| Category | Technology |
|---|---|
| Automation | Playwright, TypeScript |
| Backend | Node.js, Express, Mongoose, Pino |
| Database | MongoDB (local or Atlas) |
| Frontend | Next.js 15, React 19, CSS Variables |
| Icons | Phosphor Icons |
| Testing | Jest, ts-jest |
| Dev tooling | ts-node-dev, concurrently |
