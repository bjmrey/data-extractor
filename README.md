# Financials Extractor

A React app that extracts company financials from a PDF (annual report, financial statements) into an output template, using the LLM provider of your choice. The only server code is a small file API in the Vite dev/preview server that stores data in `data/`.

## Features

- **Output templates** (Excel / CSV / JSON, any combination), all for a single fiscal year:
  - Build fields in the UI: section, label, key, type, and a hint for the model.
  - **Upload a spreadsheet (.xlsx / .csv) and save it as a template.** Rows (or columns) become fields. Bold, `ALL CAPS` or `Label:` rows become section headings. Year header rows and formula cells are detected; you can override each row's role. The spreadsheet itself becomes the Excel/CSV output layout: extracted values are written into the chosen value column, and formulas and formatting are kept.
  - Prefill JSON fields from a sample JSON document (one field per leaf; dot keys = nesting).
  - JSON options: nested by section or flat, an optional metadata envelope (company, year, currency, unit), a default destination, and a live preview.
  - Monetary scale (units / thousands / millions / billions) and expected currency.
- **Output destinations:** an API endpoint (POST / PUT / PATCH) with a Bearer token, a token in a custom header, and extra headers. Includes a "Send test" button.
- **Extraction:** upload a PDF, pick a template and a provider, and optionally a fiscal year, a page range and extra instructions.
  - Claude and OpenAI receive the PDF itself, which handles tables and scanned pages. Other providers receive layout-aware extracted text.
  - Structured JSON output (JSON schema), plus a source page, an excerpt and a confidence level for every value.
- **Review and edit:** inline editing (edited values are flagged), "needs review" / "missing" filters, and a click on a page number opens the PDF at that page.
- **Output:** download Excel (the filled template plus an "Extraction details" sheet), CSV or JSON, or **send the JSON** to a destination. A send history is kept.

## LLM providers

| Provider | SDK | PDF handling |
|---|---|---|
| Anthropic (Claude), default model `claude-opus-5-5` | `@anthropic-ai/sdk` | Native PDF |
| OpenAI | `openai` | Native PDF |
| Google Gemini (OpenAI-compatible endpoint) | `openai` | Extracted text |
| Mistral | `openai` | Extracted text |
| Any OpenAI-compatible endpoint (Azure, Groq, Ollama, LM Studio…) | `openai` | Extracted text |

Model names can be edited in **Settings**. Requests go **directly from the browser** to the provider:

- **Claude** uses the SDK's `dangerouslyAllowBrowser` mode, streaming, structured outputs, a configurable effort level, and server-side refusal fallbacks on the models that support them.
- **The other providers** use the OpenAI SDK. The request first asks for strict JSON schema output; if the endpoint rejects it, it retries with JSON mode, then with plain text.

## Storage: flat files

Everything is a plain file:

```
settings.json              LLM providers (incl. API keys), default provider
templates/<id>.json        output templates
destinations/<id>.json     API endpoints + tokens
extractions/<id>.json      extracted + edited data, send history
files/<id>.pdf|.xlsx|.csv  uploaded PDFs and template spreadsheets
```

- **`npm run dev` / `npm run preview` (default):** files are saved in **`data/`** at the root of the app, which is gitignored. A small file API in the Vite server ([server/data-api.js](server/data-api.js)) handles reads and writes, and only accepts the paths above. The first time `data/` is empty, the app copies in whatever it had stored before (browser storage, or a connected workspace folder).
- **Static build hosted elsewhere** (no data API), the app falls back to the options below.
- **Chrome / Edge:** in *Settings → Storage*, pick a **workspace folder** and the app reads and writes these files there directly (File System Access API). The folder is remembered across sessions; after a browser restart you may need to click "Reconnect folder".
- **Other browsers:** the same files are kept in browser storage (IndexedDB). Use *Export / Import workspace (.zip)* to move or back them up.

> API keys and destination tokens are stored in those files in plain text, and they are visible to anyone who can use the browser profile. Keep the workspace folder private. For shared or production use, put a small server-side proxy in front of the LLM and destination APIs.

## Browser constraints (no back end)

- **CORS:** a JSON destination must allow cross-origin requests from the app's origin, so the browser can POST to it. The same applies to self-hosted OpenAI-compatible endpoints (Ollama: set `OLLAMA_ORIGINS`).
- **Long requests:** processing runs in the tab, so keep it open until the extraction finishes.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ — host it anywhere (it uses hash routing)
npm test           # unit tests for parsing, detection, coercion, prompt/schema, JSON building
```

## Code map

```
server/data-api.js       Vite plugin: file API for the data/ folder
src/lib/storage.js       data/ folder (via the file API), local folder (File System Access) and IndexedDB backends
src/lib/db.js            JSON flat-file repositories (templates, destinations, extractions, settings, files)
src/lib/pdf.js           pdf.js text extraction with line/column reconstruction, page subsetting (pdf-lib)
src/lib/llm.js           provider adapters (Anthropic SDK / OpenAI SDK)
src/lib/prompt.js        system prompt, user prompt, JSON schema
src/lib/extract.js       extraction pipeline
src/lib/sheet-detect.js  CSV parsing, field detection from spreadsheets
src/lib/spreadsheet.js   ExcelJS read / fill template / generate Excel & CSV
src/lib/fields.js        field types, value coercion, JSON payload builder
src/lib/send.js          send JSON to a destination
src/pages/*              UI
```
