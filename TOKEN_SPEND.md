# Token spend

This page records the model usage from the two final live analysis cases. The
figures come from the in-app **Session usage** and **API calls** audit views in
the supplied verification screenshots. They are a snapshot of those browser
sessions, not a forecast or a fixed per-report allowance.

## Recorded cases

| Case | Model | Input | Output | Total | API calls | Analysis snapshot |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Brf Smulgubben, 2024 compared with 2023 | OpenAI `gpt-5.6-luna` | 19,526 | 2,786 | 22,312 | 2 | 216 cells; 197 matches, 3 discrepancies, 16 without a counterpart; 11 model-assisted |
| HMS Networks, 2023 compared with 2022 | OpenAI `gpt-5.6-sol` | 131,655 | 16,298 | 147,953 | 9 | 382 cells; 167 matches, 8 discrepancies, 207 without a counterpart; 49 model-assisted |
| **Combined** | — | **151,181** | **19,084** | **170,265** | **11** | **598 cells; 60 model-assisted** |

The API-call count includes the small connection-test request shown in each
session. In the Smulgubben case, the semantic row-match request used 22,265
tokens and the connection test used 47, which reconciles to the 22,312-token
session total.

## Development cost

Approximately **USD 0.50 was spent on model API usage during development**.
After the recorded work, the provider account view showed **USD 4.51** in
remaining credit.

The spend is reported as the observed development total rather than allocated
between cases. Token count alone does not determine cost: input and output can
be priced differently, and rates vary by model and provider.

## What the model was used for

Model calls were limited to semantic work: proposing Swedish synonyms for
scrambling and reviewing unresolved label mappings or deterministic
split/merge candidates. Numeric parsing, equality, arithmetic totals, and the
red/green/gray status policy remained deterministic.

The audit sidebar is the source of truth for a live session. It records the
provider, model, purpose, request, structured response, latency, and token use
for every call without logging the API key. Usage is session-scoped and is
cleared when the browser tab is reloaded or the call log is cleared.
