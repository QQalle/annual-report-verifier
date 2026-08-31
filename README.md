# Annual report verifier

A focused, local-first tool for checking adjacent-year Swedish annual reports. It renders the source PDFs side by side, compares prior-year values with coordinate-linked evidence, and keeps uncertain matches gray rather than reporting a false discrepancy.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to the report library.

For production-style verification:

```bash
npm test
npm run start
```

## What is included

- `/library` — a searchable, scrollable catalogue of six adjacent-year pairs from Thule Group, HMS Networks, and engcon. Catalogue PDFs remain on the publishers' servers and are streamed through the app when selected. Open two official reports side by side, download either original, or enter scramble mode.
- Local library pair — choose **Upload your own pair** to drop or select two PDFs for the same viewing, scrambling, reset, and download workflow. Local files stay in browser memory for the current tab and are not sent to the app server.
- Scrambling — click a word or number. Numbers receive a small deterministic alteration; Swedish word synonyms can be proposed by the selected model. Export permanently redacts the selected source glyphs, adds the replacement, flattens it into the PDF, and leaves the original download untouched.
- `/analyze` — drag one newer and one prior report into the two viewers. The app detects the years, enforces adjacency, compares the reports, and draws linked green, red, or gray highlights. Clicking a highlight synchronizes both viewers; previous/next controls step through red-only or red-and-gray findings.
- Model sidebar — available on both routes and hideable. Switch between OpenAI and Anthropic, add a session-only key, test the connection, and inspect every request, structured response, latency, and input/output/cache token count.

## Anthropic setup

Either paste a key into the right sidebar or set one or both before starting the app:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-proj-...
npm run dev
```

You can also copy `.env.example` to `.env.local`. Environment files are ignored by Git. Keys pasted in the UI stay only in React memory for the current tab, are sent only to the local `/api/model` route, and are never included in the call log or browser storage.

The model sidebar lets you choose a model independently for each provider. OpenAI presets are `gpt-5.6` / `gpt-5.6-sol` (Sol), `gpt-5.6-terra` (Terra), `gpt-5.6-luna` (Luna), `gpt-5-mini`, and `gpt-4.1`; Anthropic presets are `claude-haiku-4-5`, `claude-sonnet-4-5`, and `claude-opus-4-5`. All use JSON-schema structured outputs for two narrow tasks:

1. proposing a Swedish synonym when a user scrambles a word;
2. mapping unresolved row labels that were renamed or merged between reports.

The selected model never decides whether two numbers are equal. The numeric comparison remains deterministic, and model mappings are validated against labels extracted from the PDFs. The sidebar is the source of truth for actual token use in a session; repository verification used no provider key and therefore consumed zero API tokens.

## Extraction and matching

MuPDF reads each page's text and character coordinates in the same structured-text pass. Characters are grouped into tokens and visual rows, preserving `[x0, y0, x1, y1]` rectangles for rendering and interaction. No OCR is performed.

The analyzer:

1. detects table header years and assigns numeric cells to the nearest year column;
2. excludes the newer report's current-year values;
3. normalizes labels, note prefixes, units, Swedish separators, decimal commas, negatives, and English comma thousands;
4. matches the same reported year using normalized labels, section, table position, relative page, and numeric equality for disambiguation;
5. asks the selected model only about unresolved labels when a key is configured;
6. marks equal values green, unique high-confidence differences red, and missing or ambiguous counterparts gray.

The implementation covers year-column tables throughout the multi-year overview, income statement, balance sheet, cash-flow/equity tables, and notes when their text layer exposes aligned headers and cells. Layouts without at least two recognizable year headers are intentionally left unjudged.

## Accuracy and limitations

False red findings are treated as the most serious failure mode. The included engcon 2023/2022 audit fixture produced two reviewed red findings: `Current lease liabilities (+)` (18 versus 17) and `EBITDA` (453 versus 462), both printed on the same alternative-performance-measure table in the two reports. Repeated labels and structurally ambiguous rows remain gray.

- Scanned PDFs need OCR and are not supported yet.
- Complex tables with floating labels, charts, or non-year column headers may be gray.
- The catalogue is a small curated local list, not a complete Swedish filings index.
- Publisher links can change; the two reports load independently so one unavailable source does not block the other viewer.
- PDF support is powered by `mupdf` (AGPL-3.0); review that license before distributing a modified hosted version.

## Structure

- `app/` — routes and the server-side model/PDF proxy endpoints
- `components/` — library, analyzer, PDF viewer, shell, and model audit UI
- `lib/pdf-engine.ts` — extraction, rendering, redaction, and export
- `lib/compare.ts` — deterministic matching and discrepancy policy
- `lib/catalog.ts` — curated official report pairs
- `AGENTS.md` — product and engineering constraints for future agent work

## Next

- Add a trustworthy Swedish filings source and more regression fixtures.
- Improve table identity and merged-row handling while preserving the conservative red policy.
- Add OCR as an explicit fallback.
- Extend the pair model to quarterly reports after annual-report accuracy is stable.
