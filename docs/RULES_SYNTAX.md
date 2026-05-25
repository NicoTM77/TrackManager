# 📜 Advanced Rules AST JSON Syntax Guide

This document is a comprehensive handbook for power users who want to write, edit, or customize TrackManager compliance rules directly using the JSON Abstract Syntax Tree (AST) editor. 

Writing rules directly in JSON unlocks advanced capabilities, multiple parameter matching arrays, and shorthand filters that exceed the defaults of the visual rules builder.

---

## 🏛️ Core Document Architecture

A rule is represented by a root JSON object containing a logical evaluator and an array of conditions:

```json
{
  "logicalOperator": "AND",
  "conditions": [
    {
      "field": "container",
      "operator": "EQUALS",
      "value": "mkv"
    }
  ]
}
```

### Root Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `logicalOperator` | `string` | Optional | Logical link between conditions. Allowed values: `"AND"` or `"OR"`. Defaults to `"AND"` if omitted. |
| `conditions` | `array` | **Required** | A list of condition objects to evaluate. An empty conditions array vacuously evaluates as **Passed**. |

---

## 1. Direct Media Properties (`field` Matchers)

These conditions evaluate metadata properties stored directly in the media file's primary indexing header.

### Fields and Values

*   `container`: The file extension format (e.g., `"mkv"`, `"mp4"`, `"avi"`).
*   `videoResolution`: Resolution format dimensions (e.g., `"3840x2160"`, `"1920x1080"`).
*   `videoCodec`: Compression codec (e.g., `"HEVC"`, `"AVC"`, `"AV1"`).
*   `videoColorDepth`: Digital bit-depth (e.g., `8`, `10`, `12` - parsed as numbers).
*   `videoHdrFormat`: High Dynamic Range metadata style (e.g., `"Dolby Vision"`, `"HDR10"`, `"SDR"`).

### Operators

| Operator | Evaluates... | Input Value Type | Example |
| :--- | :--- | :--- | :--- |
| **`EQUALS`** | Case-insensitive exact match | `string` or `number` | `"value": "HEVC"` |
| **`NOT_EQUALS`** | Case-insensitive mismatch | `string` or `number` | `"value": "avi"` |
| **`CONTAINS`** | Case-insensitive substring match | `string` | `"value": "Vision"` |
| **`NOT_CONTAINS`** | Substring exclusion | `string` | `"value": "SDR"` |
| **`IN`** | Inclusion inside a list | `array` or `string` | `"value": ["mkv", "mp4"]` |
| **`NOT_IN`** | Exclusion from a list | `array` or `string` | `"value": ["avi", "m4v"]` |
| **`GTE`** | Greater than or equal to | `number` | `"value": 10` |
| **`LTE`** | Less than or equal to | `number` | `"value": 8` |

---

## 2. Advanced Audio Track Matching (`audio`)

To enforce audio track presence, set the field to `"audio"` and the operator to `"HAS_AUDIO"`. You can then customize a `params` object to fine-tune matching criteria. **At least one audio track must satisfy ALL specified parameters.**

```json
{
  "field": "audio",
  "operator": "HAS_AUDIO",
  "params": {
    "language": "eng",
    "format": "TrueHD",
    "channels": "GTE 6"
  }
}
```

### Parameters (`params` block)

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `language` | `string` \| `array` | Optional | Matches track language (case-insensitive). Automatically normalized. |
| `format` | `string` \| `array` | Optional | Substring match on track codec/format. |
| `channels` | `number` \| `string` \| `object` | Optional | Evaluates audio channel counts. Supports multiple syntax structures. |
| `isDefault` | `boolean` | Optional | Matches the default track state flag (`true` or `false`). |
| `isForced` | `boolean` | Optional | Matches the forced track state flag (`true` or `false`). |

### 🌐 Language Normalization Power Feature
You do not need to worry about writing exact three-letter ISO-639-2 codes. The rules engine automatically normalizes all common input languages:
*   `"english"` / `"en"` ➜ `"eng"`
*   `"german"` / `"de"` / `"deutsch"` ➜ `"ger"`
*   `"japanese"` / `"ja"` ➜ `"jpn"`
*   `"french"` / `"fr"` ➜ `"fre"`
*   *Other inputs:* Automatically converted to lowercase and truncated to the first 3 characters.

### 🔊 Advanced Channels Comparison Syntaxes
TrackManager offers three distinct ways to evaluate channel counts:

1.  **Exact Number Match (Shorthand):**
    ```json
    "channels": 8
    ```
2.  **Comparison Expression (String):**
    Allows mathematical conditions (`GTE`, `LTE`, `EQUALS`, `>=`, `<=`, `=`) prefixed to the number:
    ```json
    "channels": "GTE 6"
    ```
    ```json
    "channels": ">= 8"
    ```
3.  **Operator Object (Structured):**
    ```json
    "channels": {
      "operator": "GTE",
      "value": 6
    }
    ```

---

## 3. Advanced Subtitle Track Matching (`subtitles`)

To enforce subtitle presence, set the field to `"subtitles"` and the operator to `"HAS_SUBTITLE"`. You can customize a `params` object to filter matching criteria. **At least one subtitle track must satisfy ALL specified parameters.**

```json
{
  "field": "subtitles",
  "operator": "HAS_SUBTITLE",
  "params": {
    "language": ["eng", "ger"],
    "format": "SRT",
    "isHearingImpaired": true
  }
}
```

### Parameters (`params` block)

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `language` | `string` \| `array` | Optional | Matches track language (case-insensitive, normalized). |
| `format` | `string` \| `array` | Optional | Substring match on subtitle format (e.g. `"SRT"`, `"PGS"`, `"ASS"`). |
| `isDefault` | `boolean` | Optional | Matches the default subtitle state flag. |
| `isForced` | `boolean` | Optional | Matches the forced subtitle state flag. |
| `isHearingImpaired` | `boolean` | Optional | Matches **Hearing Impaired / SDH** subtitles flag. |

---

## 💡 Pro-User Special Cases & Shorthand Features

Writing rules manually in the JSON sandbox allows you to utilize several special behaviors:

### 1. The Omitted Parameter Shorthand (Accept Any)
Any parameter in the `params` block that is completely omitted is **ignored** during evaluation. For example, the following rule evaluates whether the file has *any English audio track*, completely ignoring its codec format, default flags, or channel counts:
```json
{
  "field": "audio",
  "operator": "HAS_AUDIO",
  "params": {
    "language": "eng"
  }
}
```

### 2. Multi-Format Acceptances (Arrays)
By using arrays for the `format` or `language` properties, you can match **any** format or language in that list.
*   **Match a high-fidelity surround codec (Atmos TrueHD OR DTS-HD Master Audio):**
    ```json
    {
      "field": "audio",
      "operator": "HAS_AUDIO",
      "params": {
        "format": ["TrueHD", "DTS-HD"]
      }
    }
    ```
*   **Enforce that subtitles are in either English OR German:**
    ```json
    {
      "field": "subtitles",
      "operator": "HAS_SUBTITLE",
      "params": {
        "language": ["english", "german"]
      }
    }
    ```

### 3. Composite Logical Nests (`OR` Alternatives)
You can build alternative rules where multiple full pathways are accepted. For example: **Every TV Show must have either a German Audio track OR a German Subtitle track:**
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
If this rule fails, the coordinator generates a clean, consolidated failure message outlining both alternatives:
> *All alternatives failed compliance check: Option 1: [Missing Audio track with: language "ger"] OR Option 2: [Missing Subtitle track with: language "ger"]*
