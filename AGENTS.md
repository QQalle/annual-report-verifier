# Annual report verifier agent guide

## Product scope

This is a lean, local-first tool for adjacent-year Swedish annual reports.
It has exactly two primary routes:

- `/library`: find an adjacent-year report pair, inspect it, download it, or
  scramble selected words and numbers before exporting a modified PDF.
- `/analyze`: drop two PDFs, compare their prior-year figures, and inspect
  linked discrepancies in side-by-side page viewers.

Do not add accounts, generic dashboards, collaboration, quarterly reports, or
unrelated document tooling unless the product scope is explicitly expanded.

## Product rules

- Prefer a working, understandable flow over a broad feature set.
- Keep uploaded documents local to the browser wherever possible.
- Treat adjacent years as a hard validation rule, with a clear manual override
  only when metadata extraction is uncertain.
- A missing or ambiguous counterpart is gray, never red.
- OpenAI or Anthropic may propose Swedish synonyms and semantic label mappings. The model must not
  decide numeric equality or fabricate source values.
- Every model request and structured response must be visible in the audit
  sidebar together with token usage. Never log or redisplay the full API key.

## PDF conventions

- PDF page coordinates use an upper-left origin in page points.
- Store rectangles as `[x0, y0, x1, y1]` and normalize only at the rendering
  boundary.
- Text and bounding boxes must come from the same extraction pass.
- Scrambling must permanently remove the selected source text before adding the
  replacement. Do not merely draw an opaque box over live text.
- Preserve the source bytes so reset and original download are lossless.

## UI conventions

- Follow the Vercel Geist visual language: Geist type, monochrome surfaces,
  compact 32-36px controls, one-pixel borders, restrained radii, and minimal
  motion.
- The report canvas is the primary surface. Controls should stay quiet.
- Use lucide icons through the React package; do not author decorative SVGs.
- Keep the model audit sidebar hideable and shared across both routes.
- Support keyboard focus, reduced motion, and meaningful empty/error states.

## Engineering boundaries

- Keep catalogue data, PDF processing, comparison logic, model calls, and UI
  components in separate modules.
- Use deterministic normalization and matching before any model call.
- Validate all model output before applying it.
- Keep secrets server-side or in ephemeral request state; never commit keys or
  store them in browser persistence.
- Preserve the starter's package manager and Cloudflare-compatible build.

## Quality gates

Before handing off changes:

1. Run `npm run build`.
2. Run the focused tests.
3. Verify both routes and the hideable model sidebar.
4. Verify at least one local PDF render, linked discrepancy, and scrambled PDF
   export.
5. Manually review every fixture marked red; false discrepancies are the most
   serious failure mode.

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Validate: `npm test`
- Production preview: `npm run start`
