# Annual report verifier

A focused, local-first tool for checking adjacent-year Swedish annual reports. It renders the source PDFs side by side, compares prior-year values with coordinate-linked evidence, and keeps uncertain alignments gray rather than reporting a false discrepancy.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For production-style verification:

```bash
npm test
npm run start
```

## Analyze annual reports

`/analyze` is the primary workflow. Drop one newer and one prior report into the two viewers. The app detects the report years, enforces adjacency, compares prior-year figures, and links every result to both PDF locations.

- Exact and high-confidence equal comparisons are green. Model-approved split/merge comparisons are blue and show their equation in the tooltip.
- Red requires a unique, exact-label, same-context counterpart with a deterministically unequal value.
- Missing, ambiguous, weakly extracted, renamed, or weakly aligned counterparts are gray. False positives are treated as more harmful than false negatives.
- Both PDFs scroll continuously. They can be kept synced or desynced, clicking a finding resyncs at that location, and red marks on the scrollbar show discrepancies.
- The hideable model sidebar is available on both routes. It supports TypeSafe Jev, session-only API keys, connection tests, and an audit record of every request, typed response, latency, and token count.

## Model setup

Either paste a key into the right sidebar or set it before starting the app:

```bash
export TYPESAFE_API_KEY=...
npm run dev
```

You can also copy `.env.example` to `.env.local`. Environment files are ignored by Git. Keys pasted in the UI stay only in React memory for the current tab, are sent only to the local `/api/model` route, and are never included in the call log or browser storage.

The sidebar defaults to the pinned `jev-1.13.0` release for reproducible audits; `jev-latest` is also available. Jev receives typed Score questions for narrow semantic judgments:

1. whether one bounded newer/older row pair is the same reported financial concept;
2. whether a deterministically equal group is one complete accounting concept;
3. whether the local table structure supports a reclassification; and
4. whether each newly appearing or disappearing term plausibly belongs inside the retained broader row.

Each Score has explicit `different`, `uncertain`, and `same/coherent` levels. Only a uniquely dominant top outcome can produce a mapping. If competing direct candidates have similar approval probability, the app rejects them and leaves the row gray. Jev never receives numeric values and never decides numeric equality. Candidate retrieval, exact totals, occurrence uniqueness, cross-year validation, and the red/gray policy all remain deterministic. Blue controls show both the probability assigned to the approved outcome and TypeSafe confidence; confidence measures concentration of the distribution, not correctness. The sidebar is the source of truth for actual token use in a session.

## Token spend

`TOKEN_SPEND.md` preserves the previous OpenAI verification baseline for comparison. It is historical and does not describe the Jev integration. The model sidebar records Jev input and output tokens for current sessions. The automated suite covers request construction, typed-answer routing, model orchestration, and deterministic fallbacks without spending API tokens.

## Matching strategy

MuPDF reads each page's text and character coordinates in the same structured-text pass. Characters are grouped into visual rows while preserving `[x0, y0, x1, y1]` rectangles for rendering and interaction. Touching text fragments are rejoined to handle PDFs that encode kerning as overlapping glyph runs, while ordinary word spaces stay separate. No OCR is performed.

The analyzer:

1. detects table header years and assigns numeric cells to the nearest year column, preferring the preceding header so the next note cannot steal a final row;
2. recognizes date-formatted headers and consecutive multi-year bands, including `NYCKELTAL` tables;
3. excludes the newer report's current-year values;
4. normalizes labels, note prefixes, units, Swedish separators, decimal commas, negatives, English comma thousands, and bounded damaged-glyph variants from imperfect PDF text layers;
5. matches the same reported year using label, table title, section, table position, relative page, and numeric equality for disambiguation;
6. asks Jev only about bounded unresolved row pairs or deterministic split/merge proposals when a key is configured;
7. marks equal values green, Jev-approved arithmetic equalities blue, unique exact-context differences red, and missing or ambiguous counterparts gray.

The implementation covers year-column tables throughout the multi-year overview, income statement, balance sheet, cash-flow/equity tables, and notes when their text layer exposes aligned headers and cells. Layouts without at least two recognizable year headers are intentionally left unjudged.

## Arithmetic split and merge checks

The analyzer never asks Jev to do the arithmetic. Before applying the semantic direct-pair shortlist, it searches the full compatible table context for exact equations of up to four terms, for example:

```text
68 908 = 59 645 + 2 465 + 6 798
```

It protects prior rows already used by an unambiguous equal match, limits candidate combinations, and checks equality with deterministic numeric parsing. Only then does it show the candidate labels and context to Jev without values. Separate concept, structure, and term-inclusion Scores are combined, with the narrow term judgments carrying the most weight. The UI shows approved arithmetic comparisons in blue with the equation, all linked values, outcome probability, and confidence in the tooltip. Unapproved or ambiguous proposals remain gray.

Unresolved rows are reviewed in bounded batches so a later note cannot be skipped merely because an earlier section has many unresolved rows. Each batch is visible as its own audited model call.

## Jev validation questions

Jev is used for language and structure, not numeric truth. Every actual TypeSafe request and typed response is displayed in the model sidebar; API keys are never displayed there. Direct row pairs use a three-level Score rubric: different concepts, related but ambiguous, or the same reported concept. Exact arithmetic proposals use a parallel rubric: incoherent, plausible but insufficient, or a complete coherent split/merge.

Questions explicitly identify the relevant state path and instruct Jev to use labels, section, year, page, table title, and nearby rows. Residual labels such as `Övrigt` are contextual categories and never match by that word alone. Annual-report text is treated as data, and numeric values are omitted from the request entirely.

The app converts only top-level Score outcomes into candidate mappings, rejects competing approvals, then revalidates occurrence IDs, years, reuse, proposal membership, deterministic totals, and pre-existing exact-label discrepancies. A Jev-assisted unequal rename remains gray unless the deterministic matcher independently establishes the unique exact-label alignment required for red.

## Structure

- `app/` — routes and the server-side model/PDF proxy endpoints
- `components/` — library, analyzer, PDF viewer, shell, and model audit UI
- `lib/pdf-engine.ts` — extraction, rendering, redaction, and export
- `lib/compare.ts` — deterministic matching and discrepancy policy
- `lib/catalog.ts` — curated official report pairs
- `TOKEN_SPEND.md` — measured model usage and development spend
- `AGENTS.md` — product and engineering constraints for future agent work

## Extras: Library and scrambling

`/library` is an optional companion to analysis. It provides a searchable, scrollable catalogue of six adjacent-year pairs from Thule Group, HMS Networks, and engcon. Catalogue PDFs remain on publishers' servers and are streamed through the app when selected. You can open two reports side by side, download either original, or enter scramble mode.

Choose **Upload your own pair** for the same viewing, scrambling, reset, and download workflow with local documents. Local files stay in browser memory for the current tab and are not sent to the app server.

In scramble mode, click a word or number. Numbers receive a small deterministic alteration; word replacements are entered directly because Jev is a judgment model, not a text generator. Export permanently redacts the selected source glyphs, adds the replacement, and leaves the original download untouched.
