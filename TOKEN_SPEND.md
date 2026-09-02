# Token spend

This page records the measured model usage from the live analysis cases and the
September 2026 Smulgubben acceptance tuning. The figures come from provider
usage returned by the model endpoint and the in-app **Session usage** audit.
They are development snapshots, not a forecast or a fixed per-report allowance.

## Recorded cases

| Case | Model | Input | Output | Total | API calls | Analysis snapshot |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Brf Smulgubben, 2024 compared with 2023 | OpenAI `gpt-5.6-luna` | 19,526 | 2,786 | 22,312 | 2 | 216 cells; 197 matches, 3 discrepancies, 16 without a counterpart; 11 model-assisted |
| HMS Networks, 2023 compared with 2022 | OpenAI `gpt-5.6-sol` | 131,655 | 16,298 | 147,953 | 9 | 382 cells; 167 matches, 8 discrepancies, 207 without a counterpart; 49 model-assisted |
| Smulgubben acceptance tuning, three command-line runs plus final browser run | OpenAI `gpt-5.6` | 96,678 | 14,835 | 111,513 | 8 | Final run: 216 cells; 198 green, 2 blue, 1 red, 15 gray; 14 accepted mappings |
| **Combined** | — | **247,859** | **33,919** | **281,778** | **19** | — |

The first two recorded cases include the small connection-test requests shown
in their sessions. Each later acceptance run made two semantic batch calls and
no separate connection-test call.

## Development cost

No currency estimate is attached to the expanded total. Token count alone does
not determine cost: input and output can be priced differently, and rates vary
by model and provider.

## What the model was used for

Model calls were limited to semantic work: proposing Swedish synonyms for
scrambling and reviewing unresolved label mappings or deterministic
split/merge candidates. Numeric parsing, equality, arithmetic totals, and the
red/green/gray status policy remained deterministic.

The audit sidebar is the source of truth for a live session. It records the
provider, model, purpose, request, structured response, latency, and token use
for every call without logging the API key. Usage is session-scoped and is
cleared when the browser tab is reloaded or the call log is cleared.
