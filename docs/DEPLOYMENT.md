# TrackManager - Deployment & Production Reference

This document provides deployment guidelines, system footprint layouts, Docker Compose configurations, and performance tuning configurations for self-hosting TrackManager in production.

---

## 1. Production Docker Compose Deployment

The recommended method to self-host TrackManager is using **Docker Compose**. The container runs securely as a non-privileged user and bundles all Node.js services with the `mediainfo` parsing CLI.

### A. The `docker-compose.yml` Blueprint

Create a `docker-compose.yml` file in your home directory or service folder (e.g., `/opt/trackmanager`):

```yaml
version: '3.8'

services:
  trackmanager:
    image: nicolas/trackmanager:latest
    container_name: trackmanager
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - LOG_LEVEL=info
      - DATABASE_URL=/app/data/local.db
    volumes:
      # Persistent SQLite Storage directory
      - ./data:/app/data
      
      # Mapped Local Media Directories (Read-Only for security)
      - /mnt/nas/movies:/media/movies:ro
      - /mnt/nas/tvshows:/media/tvshows:ro
```

### B. Mapped Volumes Requirements
1.  **SQLite Data Folder (`./data`):** The persistent folder mounting `./data` on the host to `/app/data` inside the container must be readable and writable by the container's app user.
2.  **Read-Only Media Mounts (`:ro`):** For absolute peace of mind and data safety, map your local Plex Movie/TV library directories using the **Read-Only (`:ro`)** flag. TrackManager only parses file headers; it does not write to or modify your media files in any way.

---

## 2. Standalone Host Installation (Without Docker)

To run the compiled production build directly on a host machine (e.g. Mac, Debian server, Windows):

1.  **Build Codebase:**
    ```bash
    npm run build --workspaces
    ```
2.  **Set Environment Variables:**
    Configure a `.env` file in `backend/` or set system envs:
    ```bash
    PORT=3000
    NODE_ENV=production
    LOG_LEVEL=info
    DATABASE_URL=/var/lib/trackmanager/local.db
    ```
3.  **Start Production Daemon:**
    Run using a process manager like `pm2`:
    ```bash
    pm2 start backend/dist/index.js --name "trackmanager-backend"
    ```

---

## 3. High Performance Storage & WAL Mode

TrackManager utilizes **SQLite's Write-Ahead Logging (WAL)** mode for superior concurrency, speed, and safety.

### Why SQLite WAL Mode Matters
*   **Concurrent Read/Writes:** In standard rollback journal mode, writing to a database locks the entire file, blocking readers. In WAL mode, writes are appended to a separate `-wal` file, allowing readers to query the database concurrently without lock delays.
*   **Background Scanning Safety:** When TrackManager runs recursive media audits, it performs multiple database insertions/updates. WAL mode ensures that the interactive React WebUI stays lightning-fast and responsive, displaying audit charts smoothly even while a heavy scanning sync runs in the background.
*   **Startup Verification:** WAL mode and foreign key cascades are enabled automatically on connection startup in `backend/src/db/connection.ts`:
    ```typescript
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    ```

---

## 4. Performance & Scanning Footprint

TrackManager is built from the ground up to consume minimal host resources.

*   **Fast-Path Sync Skipping ($O(N)$):** During scans, the synchronization crawler performs a simple stat call on file paths to match sizes and modified times (`mtimeMs`). If they match the SQLite record, the scanner skips executing `mediainfo` entirely. An incremental scan of 10,000 files completes in **under 2 seconds** with virtually 0% CPU consumption.
*   **Sequential Extraction:** Newly added or modified files are parsed sequentially. The parser invokes `mediainfo` one file at a time, keeping RAM consumption under **50MB** and avoiding CPU thread starvation.
*   **Database Indexes:** Explicit unique constraints are configured on library paths and media item paths. Paginated audits search filters leverage SQLite indices for instant queries.
