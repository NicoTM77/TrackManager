# TrackManager - Self-Hosted Media Library Auditor

<p align="center">
  <img src="frontend/src/assets/logo.png" alt="TrackManager Logo" width="160" />
</p>

TrackManager is a beautiful, premium, self-hosted media library auditing web application. It recursively scans local media folders (organized Movies and TV Shows), parses high-fidelity tracks metadata utilizing `mediainfo`, indexes everything in a local SQLite database, and executes a custom Abstract Syntax Tree (AST) compliance rules engine. 

Features include a fully responsive, dark-mode first **glassmorphic React dashboard** where users can inspect compliance scores, filter library qualities, visually trace AST clause cards, sandbox-simulate audits, and monitor deleted/missing historical files (ghost records).

---

## 🚀 Spawning Development Environment

### 1. Prerequisites
Ensure you have the following installed on your host:
* **Node.js:** Version `>= 20.0.0` (Node 26+ is fully supported).
* **MediaInfo CLI:** The crawling engine relies on `mediainfo` CLI utility to inspect video files.
  * **macOS:** `brew install mediainfo`
  * **Ubuntu/Debian:** `sudo apt-get update && sudo apt-get install -y mediainfo`
  * **Windows:** Download binary from [MediaInfo website](https://mediaarea.net/en/MediaInfo) and add it to system `PATH`.

### 2. Quick-Start Developer Setup
Get the entire decoupled workspace up and running in seconds:

1. **Install Dependencies:**
   ```bash
   npm install
   ```
   *This single command leverages npm workspaces to install dependencies across both `backend` and `frontend` environments.*

2. **Configure Environment:**
   A template has been pre-configured at `backend/.env`. You can adjust configurations inside:
   * Root: `.env.example`
   * Backend: `backend/.env.example`

3. **Run Dev Servers Concurrently:**
   ```bash
   npm run dev
   ```
   * *This single command simultaneously launches the backend Express server on port `3000` and the frontend Vite React server on port `5173`.*
   * *Log traces are dynamically prefixed and color-coded (`[api]` in cyan, `[web]` in magenta).*
   * *Pressing **`Ctrl + C`** gracefully terminates both servers instantly, cleaning up background ports.*

---

## 🧪 Isolated Testing Environment

To guarantee that active development and indexing data are never corrupted or polluted, **testing is completely separated from your development environment**:

* **State Isolation:** The automated test runner forces `process.env.DATABASE_URL = ':memory:'` and `process.env.NODE_ENV = 'test'`.
* **Zero Disk-Write Footprints:** Vitest tests operate on a purely in-memory SQLite buffer database. Your local development file (`backend/local.db`) remains completely untouched and isolated during tests.
* **Synchronous Log Output:** Pretty-log transport delays are turned off during test suites, ensuring synchronous flushes so stack traces align directly with test assertions.

To execute the automated unit and integration tests:
```bash
npm run test
```
*Runs all 16 Vitest test suites (rules engines, directory crawlers, language normalizers, and indexing transactions).*

---

## 📂 Codebase Architecture

```
TrackManager/
├── package.json              # Monorepo workspaces definition
├── .env.example              # Central environment reference template
├── spec.md                   # Core project product specification
├── docs/                     # Comprehensive decoupled guidebooks
│   ├── API.md                # Decoupled REST specifications
│   ├── DEVELOPMENT.md        # Technical developer roadmap
│   └── DEPLOYMENT.md         # Production Compose & volume guide
├── backend/                  # TypeScript Express REST API & crawling service
│   ├── .env.example          # Backend configuration reference template
│   ├── .env                  # Immediate developer active environment
│   ├── src/
│   │   ├── index.ts          # Express API endpoints router
│   │   ├── db/
│   │   │   ├── connection.ts # SQLite connection pool (WAL mode enabled)
│   │   │   └── schema.ts     # DDL Drizzle ORM database tables
│   │   ├── services/
│   │   │   ├── scanService.ts  # Recursive crawler & sync engine
│   │   │   ├── rulesEngine.ts  # AST hierarchical conditional validator
│   │   │   └── auditService.ts # Compliance coordinator upsert logic
│   │   └── __tests__/        # Isolated Vitest validation suites
│   └── drizzle/              # Generated SQL migrations artifacts
└── frontend/                 # Premium React Single Page Application (WebUI)
    ├── src/
    │   ├── index.css         # Custom CSS Design System (Outfit & Inter fonts)
    │   ├── App.tsx           # Navigational container sidebar & view controller
    │   └── components/
    │       ├── DashboardOverview.tsx  # Compliance scores radial progress gauge
    │       ├── AuditGrid.tsx          # Real-time search filter and slide Drawer
    │       ├── RulesBuilder.tsx       # Interactive AST visual cards & sandbox
    │       └── HistoryPanel.tsx       # Opacity ghost rows & deleted timeline
```

---

## 📖 Additional Documentation
For complete roadmap structures, deployment maps, and API listings, explore the dedicated guidebooks:
* 🗺️ **[Developer Blueprint](file:///Users/baern/Documents/TrackManager/docs/DEVELOPMENT.md)**
* 📡 **[REST API Specifications](file:///Users/baern/Documents/TrackManager/docs/API.md)**
* 🐳 **[Docker Production Guide](file:///Users/baern/Documents/TrackManager/docs/DEPLOYMENT.md)**
