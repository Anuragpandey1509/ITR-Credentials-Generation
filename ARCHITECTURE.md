# Architecture Document

## ITR Credentials Generation Automation

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Operator Browser                             │
│                    http://localhost:3000                             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  REST (Bearer Auth)     SSE (live stream)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         UI Layer                                    │
│                   Next.js 15 + React 19                             │
│                                                                     │
│  /               → Dashboard (metrics + run table)                  │
│  /runs/[jobId]   → Run Console (stepper + live log + OTP/CAPTCHA)   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  REST (Bearer Auth)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Service Layer                                 │
│                  Node.js + Express + MongoDB                        │
│                     http://localhost:4000                           │
│                                                                     │
│  POST /jobs            → start job, spawn bot                       │
│  GET  /jobs            → list jobs (paginated)                      │
│  GET  /jobs/:id/stream → SSE live event fan-out                     │
│  POST /jobs/:id/otp    → operator submits OTP                       │
│  POST /jobs/:id/captcha→ operator submits CAPTCHA                   │
│  GET  /metrics         → p50/p99/success-rate                       │
│  POST /webhook/events  → receives events from bot (webhook secret)  │
└──────────┬──────────────────────────────────────────────────────────┘
           │  spawn child process       │  webhook HTTP (WEBHOOK_SECRET)
           ▼                           │
┌─────────────────────────┐            │
│     Automation Layer    │────────────┘
│   Playwright + Node.js  │
│                         │
│  StateMachine (FSM)     │
│  WebhookClient (retry)  │
│  Browser (Chromium)     │
└─────────────────────────┘
           │  drives
           ▼
┌─────────────────────────┐
│   Income Tax Portal     │
│  incometax.gov.in       │
│  Forgot Password Flow   │
└─────────────────────────┘
```

---

## 2. Data Flow

### 2.1 Initiating a Run

```
Operator          UI             Service              Bot (child process)
   │                │               │                       │
   │──POST /jobs────►               │                       │
   │                │──POST /jobs──►│                       │
   │                │               │── spawn(node dist/index.js --jobId X --pan Y)
   │                │               │                       │
   │                │◄── { jobId }──│                       │
   │◄─ redirect ────│               │                       │
```

### 2.2 Event Streaming

```
Bot               Service            UI (SSE client)
 │                   │                    │
 │─ POST /webhook ──►│                    │
 │   (step event)    │── INSERT event ───►MongoDB
 │                   │── fanOut.publish() │
 │                   │       │            │
 │                   │       ├── write to all SSE subscribers ──► UI
 │                   │       └── push to ring buffer              │
 │                   │                    │ (rendered in LiveConsole)
```

### 2.3 Human-in-the-Loop (OTP / CAPTCHA)

```
Bot                 Service             Operator (UI)
 │                     │                     │
 │ (screenshot CAPTCHA)│                     │
 │─ POST /webhook ────►│ fanOut.publish()    │
 │   { captchaImage }  │────SSE event───────►│
 │                     │                     │ (CaptchaDialog renders)
 │─ GET /captcha-poll ►│                     │──POST /jobs/:id/captcha──►│
 │ (204 Not ready yet) │◄── storeCaptcha() ──│                           │
 │─ GET /captcha-poll ►│                     │
 │◄── { captcha: "XY" }│ (consumeCaptcha – atomic $unset)
 │ (fills portal field)│
```

---

## 3. State Machine Design

The automation bot uses a strict **Finite State Machine (FSM)** to prevent invalid portal transitions and make the flow auditable via events.

### State Diagram

```
                    ┌─────────────────┐
              ┌────►│   NAVIGATING    │◄──────┐
              │     └────────┬────────┘       │ (captcha retry)
              │              │                │
         IDLE─┤              ▼                │
              │     ┌────────────────┐        │
              │     │    CAPTCHA     │────────┘
              │     └────────┬───────┘
              │              │
              │              ▼
              │     ┌────────────────────┐
              │     │   FILLING_DETAILS  │
              │     └────────┬───────────┘
              │              │
              │              ▼
              │     ┌────────────────────┐
              │     │  WAITING_FOR_OTP   │◄────┐
              │     └────────┬───────────┘     │ (wrong OTP retry)
              │              │                 │
              │              ▼                 │
              │     ┌────────────────────┐     │
              │     │  SUBMITTING_OTP    │─────┘
              │     └────────┬───────────┘
              │              │
              │              ▼
              │     ┌────────────────────┐
              │     │  SETTING_PASSWORD  │
              │     └────────┬───────────┘
              │              │
              │              ▼
              │           ┌──────┐
              │           │ DONE │
              │           └──────┘
              │
              └──── FAILED / CANCELLED (from any active state)
```

### Transition Table

| From | To | Trigger |
|---|---|---|
| `IDLE` | `NAVIGATING` | Bot starts |
| `NAVIGATING` | `CAPTCHA` | Login page loaded |
| `CAPTCHA` | `NAVIGATING` | Bad CAPTCHA, retry |
| `CAPTCHA` | `FILLING_DETAILS` | CAPTCHA accepted |
| `FILLING_DETAILS` | `WAITING_FOR_OTP` | OTP generation requested |
| `WAITING_FOR_OTP` | `SUBMITTING_OTP` | OTP received from operator |
| `SUBMITTING_OTP` | `WAITING_FOR_OTP` | Invalid OTP, retry |
| `SUBMITTING_OTP` | `SETTING_PASSWORD` | OTP accepted |
| `SETTING_PASSWORD` | `DONE` | Password reset complete |
| any non-terminal | `FAILED` | Unrecoverable error |
| any non-terminal | `CANCELLED` | Operator cancelled |

---

## 4. Event Pipeline (SSE + Webhook)

### Design Goals
1. **Zero-loss replay** — clients that reconnect (or open a run detail page later) must see all historical events in order
2. **Low latency** — connected clients must receive events with sub-100ms fan-out
3. **Durability** — events must survive service restarts

### Solution: Dual-Source Architecture

```
Bot push → POST /webhook/events
              │
              ├─ INSERT into MongoDB events collection (durable)
              │
              └─ fanOut.publish(event)
                      │
                      ├─ push to per-job RingBuffer<JobEvent> (size 500)
                      │
                      └─ iterate subscribers → res.write(SSE frame)

Client connect → GET /jobs/:id/stream?Last-Event-ID=42
                      │
                      ├─ getEventsAfterSeq(jobId, 42) → MongoDB (replay gap)
                      │
                      └─ fanOut.subscribe(jobId, res, 42) (tail live)
```

**Why two sources?** MongoDB is the replay source (durable, ordered, queryable). The ring buffer is the fan-out source (zero DB round-trip for live clients). The ring bridges the gap between the Mongo read and subscribe registration, preventing missed events during reconnect.

### SSE Frame Format

```
id:42
data:{"jobId":"...","seq":42,"level":"info","phase":"CAPTCHA","step":"CAPTCHA_SCREENSHOT","message":"...","timestamp":"...","meta":{...}}

```

- `id:` is the SSE `Last-Event-ID` — browsers automatically send this on reconnect
- Sequence numbers are assigned **server-side** (not by the bot) to prevent duplicates on retry

---

## 5. Database Schema

### Collection: `jobs`

```
{
  jobId:        String (unique index)
  pan:          String (AES-256-GCM ciphertext — never queried)
  panMasked:    String (e.g. "ABCDE****F" — safe for display)
  phase:        String (enum: IDLE | NAVIGATING | ... | DONE | FAILED | CANCELLED)
  outcome:      String? (success | failure | cancelled)
  startedAt:    Date
  updatedAt:    Date (auto-managed by Mongoose timestamps)
  completedAt:  Date?
  durationMs:   Number?
  error:        String?
  credentials:  { userId: String, password: String }?  ← both AES-256 ciphertext
  pendingOtp:       String? (select:false — not returned in queries, atomically unset on consume)
  pendingCaptcha:   String? (select:false)
  eventSeq:     Number (monotonic counter, incremented server-side)
}
```

**Indexes:**
- `{ jobId: 1 }` unique — primary key
- `{ phase: 1, updatedAt: -1 }` — admin list filtering by phase
- `{ outcome: 1, startedAt: -1 }` — metrics aggregation

### Collection: `events`

```
{
  jobId:     String
  seq:       Number
  level:     String (debug | info | warn | error)
  phase:     String
  step:      String
  message:   String
  timestamp: Date
  meta:      Mixed?
}
```

**Indexes:**
- `{ jobId: 1, seq: 1 }` unique — primary replay index, O(1) cursor queries
- `{ jobId: 1, timestamp: 1 }` — time-based queries

**Why separate collection?** Embedding events in the job document would eventually hit MongoDB's 16 MB BSON document limit for long-running jobs. A separate collection with `{ jobId, seq }` index enables efficient cursor-based replay without loading the entire event history on every job query.

---

## 6. Security Architecture

### Encryption at Rest

```
PAN (plaintext) ──► encrypt(pan) ──► AES-256-GCM ciphertext stored in MongoDB
                                     IV + AuthTag + Ciphertext packed as Base64

Password (generated) ──► encrypt(pwd) ──► stored in credentials.password
```

- Algorithm: AES-256-GCM (authenticated encryption — detects tampering)
- Key: 32-byte random hex, stored only in environment variable
- IV: 16 random bytes, unique per encryption call
- AuthTag: 16 bytes, stored alongside ciphertext

### Authentication Layers

```
Operator → UI → Service:  Authorization: Bearer <API_BEARER_TOKEN>
Bot     → Service:        X-Webhook-Secret: <WEBHOOK_SECRET>
```

Two separate secrets mean a compromised bot token cannot be used to masquerade as an operator, and vice versa.

### PII Redaction

- Pino logger `redact` config strips `pan`, `otp`, `password` fields from all log output
- `panMasked` (`ABCDE****F`) is the only PAN-derived value allowed in events/logs/UI
- OTP is never logged; it's consumed from DB in a single atomic `findOneAndUpdate` + `$unset`

---

## 7. Resilience Design

| Failure Scenario | Mitigation |
|---|---|
| Bot crashes mid-run | Service detects exit code, job stays in last known phase; operator can see state in dashboard |
| Webhook delivery fails | WebhookClient retries up to 5× with exponential backoff (500ms → 16s) |
| SSE client disconnects | `onerror` triggers reconnect after 2s; `Last-Event-ID` enables gapless replay from MongoDB |
| Wrong OTP entered | FSM allows `SUBMITTING_OTP → WAITING_FOR_OTP` retry up to 3 times |
| Bad CAPTCHA entered | FSM allows `CAPTCHA → NAVIGATING` re-navigation and re-screenshot |
| MongoDB write fails | Express error handler returns 500; client retries |
| Stale ring buffer | Ring is best-effort; MongoDB is always the canonical source for replay |

---

## 8. Module Dependency Graph

```
shared/types.ts   (zero dependencies — pure types + utilities)
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
service/src/                        automation/src/
  ├─ config/                          ├─ config/
  ├─ crypto/ (AES-256-GCM)            ├─ crypto/ (same algorithm)
  ├─ db/ (Mongoose models)            ├─ state-machine/ (FSM)
  ├─ repository/ (DB access)          ├─ webhook-client/ (POST events)
  ├─ domain/job.ts (lifecycle)        ├─ browser/ (Playwright)
  ├─ sse/fan-out.ts (ring+SSE)        └─ runner.ts (main loop)
  └─ routes/ (Express)
                                      ui/
                                        ├─ lib/api.ts (REST client)
                                        ├─ components/ (React)
                                        └─ app/ (Next.js pages)
```

---

## 9. Trade-offs and Design Decisions

### Manual CAPTCHA Solve (vs. 3rd-party API)
**Decision:** Screenshot the CAPTCHA image, push it via SSE event to the operator dashboard, and wait for manual input.

**Rationale:** The Income Tax portal's CAPTCHA changes frequently and is harder to solve programmatically. A paid 3rd-party CAPTCHA service adds cost and a network dependency. Manual solve via the dashboard is reliable and aligns with the human-in-the-loop requirement of the assignment.

### Server-Side Sequence Numbers
**Decision:** The service assigns `seq` numbers to events, not the bot.

**Rationale:** The bot may retry a webhook delivery on transient network errors. If the bot assigned seq numbers, a retried delivery would arrive with a duplicate seq and corrupt the event log. Server-side assignment with idempotent checks (unique `{ jobId, seq }` index) prevents duplicates.

### Child Process vs. Queue
**Decision:** The service spawns the bot as a Node.js child process (not a job queue like Bull/BullMQ).

**Rationale:** For a take-home assignment, a child process is simpler to set up and demonstrate. In production, a persistent queue (e.g. BullMQ + Redis) would be preferable for horizontal scaling, retries across restarts, and rate-limiting concurrent runs.

### Ring Buffer Size
**Decision:** 500 events per job in memory.

**Rationale:** A 3-minute run produces roughly 50–100 events. 500 events covers ~15 minutes of burst events. The ring is only for zero-latency fan-out to live clients; MongoDB is always the authoritative source for replay.
