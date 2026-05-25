# TrackManager - REST API Specification

This document provides detailed references for the decoupled HTTP REST API endpoints exposed by the TrackManager backend service. All endpoints consume and return `application/json` payloads.

The default local endpoint is: `http://localhost:3000`

---

## 1. Libraries Configuration API

Endpoints to manage Plex-organized media library directories and scan states.

### GET `/api/libraries`
Lists all registered media libraries, attaching active background scanning status.

*   **Method:** `GET`
*   **Success Response (200 OK):**
    ```json
    [
      {
        "id": 1,
        "name": "Personal Movies",
        "path": "/data/media/movies",
        "type": "movie",
        "status": "idle",
        "lastScannedAt": "2026-05-25T12:00:00.000Z",
        "createdAt": "2026-05-25T11:00:00.000Z",
        "updatedAt": "2026-05-25T12:00:00.000Z"
      },
      {
        "id": 2,
        "name": "TV Classics",
        "path": "/data/media/tv",
        "type": "tv",
        "status": "scanning",
        "lastScannedAt": null,
        "createdAt": "2026-05-25T11:30:00.000Z",
        "updatedAt": "2026-05-25T11:30:00.000Z"
      }
    ]
    ```

### POST `/api/libraries`
Registers a new local library path. If the path does not exist on disk, the backend will pro-actively attempt to create it.

*   **Method:** `POST`
*   **Request Body:**
    ```json
    {
      "name": "SciFi Series",
      "path": "/data/media/scifi",
      "type": "tv"
    }
    ```
*   **Success Response (201 Created):**
    ```json
    {
      "id": 3,
      "name": "SciFi Series",
      "path": "/data/media/scifi",
      "type": "tv",
      "createdAt": "2026-05-25T12:45:00.000Z",
      "updatedAt": "2026-05-25T12:45:00.000Z"
    }
    ```
*   **Error Responses:**
    *   `400 Bad Request`: Missing parameters or invalid library type.
    *   `400 Bad Request`: Unique path constraint violated (library already exists at path).

### DELETE `/api/libraries/:id`
Deletes a library configuration. Deletion cascade-drops all indexed media files, tracks, and compliance audit histories.

*   **Method:** `DELETE`
*   **Success Response (200 OK):**
    ```json
    {
      "message": "Successfully deleted library: SciFi Series"
    }
    ```
*   **Error Responses:**
    *   `404 Not Found`: Library ID does not exist.

### POST `/api/libraries/:id/scan`
Triggers an immediate background synchronization scan. The scan recursively crawls folders, matches renames, indexes codecs, and updates compliance cache in a non-blocking process.

*   **Method:** `POST`
*   **Success Response (202 Accepted):**
    ```json
    {
      "message": "Scan triggered in background.",
      "libraryId": 3
    }
    ```
*   **Error Responses:**
    *   `409 Conflict`: A scan is already running for this library.
    *   `404 Not Found`: Library ID not found.

---

## 2. Auditing Rules Configuration API

Endpoints to manage custom compliance rules and simulate AST checks prior to saving.

### GET `/api/rules`
Lists all user-configured rules, parsing the stored AST conditions.

*   **Method:** `GET`
*   **Success Response (200 OK):**
    ```json
    [
      {
        "id": 1,
        "name": "Subtitles Requirement",
        "description": "Movies must include English SRT or ASS subtitles.",
        "isActive": true,
        "targetType": "movie",
        "conditions": {
          "logicalOperator": "OR",
          "conditions": [
            {
              "field": "subtitles",
              "operator": "HAS_SUBTITLE",
              "params": {
                "language": "eng",
                "format": ["SRT", "ASS"]
              }
            }
          ]
        },
        "createdAt": "2026-05-25T11:00:00.000Z",
        "updatedAt": "2026-05-25T11:00:00.000Z"
      }
    ]
    ```

### POST `/api/rules`
Creates a compliance rule with a hierarchical condition AST.

*   **Method:** `POST`
*   **Request Body:**
    ```json
    {
      "name": "German Audio & Subtitles",
      "description": "Must have German DTS/TrueHD audio OR German SRT subtitles",
      "isActive": true,
      "targetType": "all",
      "conditions": {
        "logicalOperator": "OR",
        "conditions": [
          {
            "field": "audio",
            "operator": "HAS_AUDIO",
            "params": {
              "language": "ger",
              "format": ["DTS", "Dolby TrueHD"]
            }
          },
          {
            "field": "subtitles",
            "operator": "HAS_SUBTITLE",
            "params": {
              "language": "ger",
              "format": "SRT"
            }
          }
        ]
      }
    }
    ```
*   **Success Response (201 Created):**
    ```json
    {
      "id": 2,
      "name": "German Audio & Subtitles",
      "description": "Must have German DTS/TrueHD audio OR German SRT subtitles",
      "isActive": true,
      "targetType": "all",
      "conditions": {
        "logicalOperator": "OR",
        "conditions": [ ... ]
      },
      "createdAt": "2026-05-25T12:50:00.000Z",
      "updatedAt": "2026-05-25T12:50:00.000Z"
    }
    ```

### PUT `/api/rules/:id`
Updates a rule details or AST conditions.

*   **Method:** `PUT`
*   **Request Body:** `{ name, description, isActive, targetType, conditions }`
*   **Success Response (200 OK):** Updated rule object.

### DELETE `/api/rules/:id`
Removes a rule configuration. Associated audit result cache is cascade-deleted.

*   **Method:** `DELETE`
*   **Success Response (200 OK):** `{ "message": "Successfully deleted compliance rule: name" }`

### POST `/api/rules/test`
Simulates running a new/unsaved condition AST against an indexed media file. Useful for pre-testing custom rules inside the visual editor UI.

*   **Method:** `POST`
*   **Request Body:**
    ```json
    {
      "mediaItemId": 42,
      "conditions": {
        "logicalOperator": "AND",
        "conditions": [
          {
            "field": "videoColorDepth",
            "operator": "GTE",
            "value": 10
          }
        ]
      }
    }
    ```
*   **Success Response (200 OK - Passes):**
    ```json
    {
      "passed": true
    }
    ```
*   **Success Response (200 OK - Fails):**
    ```json
    {
      "passed": false,
      "errorMessage": "Field \"videoColorDepth\" is 8, which is less than expected 10."
    }
    ```

---

## 3. Media Files API

Search, paginated filtering, and inspection routes for movie and TV media metadata.

### GET `/api/media`
Provides full-featured paginated filtering grids for movie and episode assets.

*   **Method:** `GET`
*   **Query Parameters:**
    *   `libraryId` (optional): Filter to specific library path ID.
    *   `status` (optional): `'active'` (default) or `'removed'` (to browse historical removed items).
    *   `search` (optional): Case-insensitive match on title or fileName.
    *   `failedOnly` (optional): `'true'` to fetch only items failing at least one active compliance rule.
    *   `videoQuality` (optional): `'4K'`, `'1080p'`, `'720p'`, or `'SD'`.
    *   `limit` (optional): Number of records (default `50`).
    *   `offset` (optional): Skip threshold (default `0`).
*   **Success Response (200 OK):**
    ```json
    {
      "total": 1,
      "limit": 50,
      "offset": 0,
      "items": [
        {
          "id": 12,
          "libraryId": 1,
          "filePath": "/data/movies/Interstellar (2014)/Interstellar.mkv",
          "fileName": "Interstellar.mkv",
          "fileSize": 45000000000,
          "mtimeMs": 1622000000000,
          "status": "active",
          "scannedAt": "2026-05-25T12:00:00.000Z",
          "removedAt": null,
          "title": "Interstellar",
          "season": null,
          "episode": null,
          "container": "mkv",
          "videoResolution": "3840x2160",
          "videoBitrate": 45000000,
          "videoCodec": "HEVC",
          "videoColorDepth": 10,
          "videoHdrFormat": "HDR10 / Dolby Vision",
          "createdAt": "2026-05-25T12:00:00.000Z",
          "updatedAt": "2026-05-25T12:00:00.000Z",
          "audioTracks": [
            {
              "id": 4,
              "mediaItemId": 12,
              "trackIndex": 1,
              "language": "eng",
              "format": "TrueHD (Atmos)",
              "channels": 8,
              "bitrate": 450000,
              "isDefault": true,
              "isForced": false
            }
          ],
          "subtitleTracks": [
            {
              "id": 9,
              "mediaItemId": 12,
              "trackIndex": 2,
              "language": "eng",
              "format": "PGS",
              "isDefault": true,
              "isForced": false,
              "isHearingImpaired": false
            }
          ],
          "auditResults": [
            {
              "mediaItemId": 12,
              "ruleId": 1,
              "ruleName": "Subtitles Requirement",
              "passed": true,
              "errorMessage": null,
              "auditedAt": "2026-05-25T12:00:00.000Z"
            }
          ]
        }
      ]
    }
    ```

### GET `/api/media/:id`
Retrieves granular track details and compliance status for a single media asset. Used by the right Slide-Drawer panel.

*   **Method:** `GET`
*   **Success Response (200 OK):** Individual media item detailing joined `audioTracks`, `subtitleTracks`, and `auditResults`.

### GET `/api/media/:id/raw`
Returns the exact, raw, unprocessed `JSON` metadata dump generated by the `MediaInfo` extraction command.

*   **Method:** `GET`
*   **Success Response (200 OK):** The raw MediaInfo JSON object.

---

## 4. Stats & Health Overview API

High-level analytical figures and data distributions used for charts.

### GET `/api/stats/overview`
Retrieves library aggregates, visual compliance score, quality groupings, and file format charts.

*   **Method:** `GET`
*   **Success Response (200 OK):**
    ```json
    {
      "moviesCount": 425,
      "episodesCount": 1820,
      "complianceScore": 87,
      "totalAudits": 4490,
      "passedAudits": 3906,
      "totalRemoved": 14,
      "qualityDistribution": {
        "4K": 125,
        "1080p": 1650,
        "720p": 430,
        "SD": 40
      },
      "containerDistribution": {
        "MKV": 2185,
        "MP4": 55,
        "M4V": 5
      },
      "codecDistribution": {
        "HEVC": 1200,
        "AVC": 1025,
        "AV1": 20
      }
    }
    ```
