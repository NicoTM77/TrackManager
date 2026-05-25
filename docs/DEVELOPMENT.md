# TrackManager - Developer Reference Guide

This document describes the design patterns, storage structures, Drizzle schemas, rules AST formats, and setup procedures for developers maintaining or extending the TrackManager workspace.

---

## 1. Directory Structure Layout

TrackManager uses an npm workspaces monorepo structure to keep both codebases cleanly separated yet extremely easy to build, test, and manage:

```
TrackManager/
├── package.json              # Monorepo workspaces definition
├── package-lock.json
├── spec.md                   # Core Product Specification
├── docs/                     # System & Deployment References
│   ├── API.md                # Decoupled REST specifications
│   ├── DEVELOPMENT.md        # Developer setup & database
│   └── DEPLOYMENT.md         # Production guides
├── backend/                  # TypeScript Express & DB Service
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts     # Drizzle Kit migration settings
│   ├── src/
│   │   ├── index.ts          # Express API server entry
│   │   ├── db/
│   │   │   ├── connection.ts # SQLite connection (WAL, foreign keys)
│   │   │   └── schema.ts     # Drizzle Database Schemas
│   │   ├── services/
│   │   │   ├── rulesEngine.ts # Rules AST evaluation
│   │   │   ├── scanService.ts  # Directory crawler & sync worker
│   │   │   └── auditService.ts # Multi-dimensional audits coordinator
│   │   ├── utils/
│   │   │   ├── logger.ts     # Structured Pino logging wrapper
│   │   │   ├── crawler.ts    # Recursive file path walker
│   │   │   └── mediainfo.ts  # MediaInfo CLI json parser
│   │   └── __tests__/        # Automated Vitest suites
│   └── drizzle/              # Generated SQL migrations artifacts
└── frontend/                 # React SPA (Vite + Vanilla CSS)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── index.css         # Styling system & variables
        ├── main.tsx
        ├── App.tsx
        └── components/
```

---

## 2. Developer Workspace Setup

### A. Prerequisites
1.  **Node.js:** Node.js version `>= 20.0.0` (Node 26+ fully supported).
2.  **MediaInfo CLI:** The crawler executes the command-line utility `mediainfo` directly via child processes. It must be installed on your local host:
    *   **Mac OS (via Homebrew):**
        ```bash
        brew install mediainfo
        ```
    *   **Linux (Debian/Ubuntu):**
        ```bash
        sudo apt-get update && sudo apt-get install -y mediainfo
        ```
    *   **Windows:** Download the CLI binary and add it to your System `PATH`.

### B. Installing Workspace Dependencies
From the monorepo root, run:
```bash
npm install
```
This automatically installs dependencies across both npm workspaces (`backend` and `frontend`).

### C. Spawning Development Environment (Simultaneous WebUI & API Server)
You can spawn both the Express SQLite API backend and the React Vite frontend server concurrently with a single command from the monorepo root:
```bash
npm run dev
```
* **API Logs:** Colored cyan and prefixed with `[api]`. Runs on `http://localhost:3000`.
* **WebUI Logs:** Colored magenta and prefixed with `[web]`. Runs on `http://localhost:5173`.
* **Graceful Exit:** Pressing `Ctrl + C` in your terminal cleanly terminates both child processes simultaneously.

Alternatively, you can run either server individually:
* **Backend Only:** `npm run dev:backend`
* **Frontend Only:** `npm run dev:frontend`

### D. Database Setup and Migrations
TrackManager uses Drizzle ORM to manage SQLite tables. Local SQLite file defaults to `backend/local.db`.

1.  **Generate Migration Scripts:** If you modify `backend/src/db/schema.ts`, run Drizzle Kit to create a new SQL migration script:
    ```bash
    npm run db:generate --workspace=backend
    ```
    This compiles Drizzle definitions and deposits SQL scripts inside `backend/drizzle/`.
2.  **Startup Migrations:** Drizzle migrations are automatically applied on server boot via the database re-initializer inside `backend/src/db/connection.ts`. There is no manual SQLite command needed to initialize databases in dev or prod!

### E. Environmental Configurations
Developers can configure the following variables inside `.env` or the environment:
*   `PORT` (default `3000`): Port on which the backend Express server listens.
*   `LOG_LEVEL` (default `info`): Structured logging verbosity level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).
*   `DATABASE_URL` (default `local.db`): Filepath to the local SQLite database.
*   `CONCURRENT_SCAN_THREADS` (default `4`): Number of concurrent workers spawning parallel MediaInfo subprocesses during filesystem sweeps. Safe sequencing in a centralized promise queue protects Drizzle transactions against SQLite locking issues.

---

## 3. Rules Evaluation AST (JSON Syntax)

Compliance rules are structured as a hierarchical Abstract Syntax Tree (AST) stored inside SQLite as a text string. The AST supports two primary structural structures.

### Structural Schema Definition
```typescript
interface RuleAST {
  logicalOperator: 'AND' | 'OR';
  conditions: RuleCondition[];
}

interface RuleCondition {
  field: 'container' | 'videoResolution' | 'videoCodec' | 'videoColorDepth' | 'videoHdrFormat' | 'audio' | 'subtitles';
  operator: 'EQUALS' | 'CONTAINS' | 'IN' | 'GTE' | 'LTE' | 'HAS_AUDIO' | 'HAS_SUBTITLE';
  value?: any;        // Utilized by direct fields (e.g. "HEVC", 10)
  params?: {          // Utilized by track matchers (audio/subtitles)
    language?: string | string[];
    format?: string | string[];
    channels?: number | string | { operator: 'GTE'|'LTE'|'EQUALS', value: number };
    isForced?: boolean;
    isHearingImpaired?: boolean;
    isDefault?: boolean;
  };
}
```

### Examples of AST JSON
1.  **HDR movies must have high fidelity Dolby/DTS audio:**
    ```json
    {
      "logicalOperator": "AND",
      "conditions": [
        {
          "field": "videoHdrFormat",
          "operator": "CONTAINS",
          "value": "HDR"
        },
        {
          "field": "audio",
          "operator": "HAS_AUDIO",
          "params": {
            "format": ["Dolby TrueHD", "DTS-HD", "DTS"]
          }
        }
      ]
    }
    ```

2.  **Every TV episode must include German subtitles OR German audio:**
    ```json
    {
      "logicalOperator": "OR",
      "conditions": [
        {
          "field": "audio",
          "operator": "HAS_AUDIO",
          "params": { "language": "ger" }
        },
        {
          "field": "subtitles",
          "operator": "HAS_SUBTITLE",
          "params": { "language": "ger" }
        }
      ]
    }
    ```

---

## 4. Run Automated Testing Suite

TrackManager features a high-speed unit and integration testing suite utilizing **Vitest**.

To execute the test sweeps:
```bash
npm run test --workspace=backend
```

### Test Isolation Patterns
*   **Pino Logging:** Pino pretty-transports are disabled when `process.env.NODE_ENV === 'test'`. Logs print synchronously to the console, ensuring detailed stack traces are visible directly in Vitest's stdout should a test assertion fail.
*   **In-Memory DB:** SQLite is connected with `:memory:` in testing environments.
*   **Test Mutex:** Sequential serial execution of database tests is protected by a custom `Mutex` class in our integration suite, completely preventing concurrent SQLite table conflicts or cross-test mock pollution.
