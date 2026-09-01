import type { BrowserPdf } from "./pdf-engine";
import { parseSwedishNumber } from "./pdf-engine";
import type {
  AnalysisResult,
  Discrepancy,
  ExtractedPage,
  PdfLine,
  PdfToken,
  Rect,
  SectionJump,
} from "./types";

type ComparableCell = {
  id: string;
  year: number;
  label: string;
  normalizedLabel: string;
  valueText: string;
  value: number;
  section: string;
  page: number;
  token: PdfToken;
  relativePage: number;
  tableIndex: number;
  labelRect: Rect;
  yearRect: Rect;
};

type ModelRow = {
  id: string;
  label: string;
  section: string;
  year: number;
  page: number;
  table: number;
};

type ModelMapping = {
  newerId: string;
  olderIds: string[];
  relationship: "direct" | "aggregate" | "none";
};

type ResolveLabels = (
  newerRows: ModelRow[],
  olderRows: ModelRow[],
) => Promise<{ mappings: ModelMapping[] }>;

const sectionRules: Array<[RegExp, string]> = [
  [/flerårsöversikt|multi[- ]year overview|five[- ]year overview/i, "Multi-year overview"],
  [/resultaträkning|income statement|statement of profit/i, "Income statement"],
  [/balansräkning|balance sheet|statement of financial position/i, "Balance sheet"],
  [/förändringar i eget kapital|changes in equity/i, "Changes in equity"],
  [/kassaflödesanalys|cash flow statement/i, "Cash flow statement"],
  [/noter|notes to the financial statements|notes/i, "Notes"],
];

const stopwords = new Set([
  "and",
  "the",
  "of",
  "for",
  "in",
  "to",
  "och",
  "av",
  "för",
  "i",
  "till",
  "sek",
  "msek",
  "tsek",
  "kr",
  "note",
  "not",
]);

const genericLabels = new Set([
  "as at",
  "born",
  "december",
  "million",
  "was",
  "total",
  "year",
]);

export function normalizeLabel(label: string) {
  return label
    .toLocaleLowerCase("sv-SE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*(note|not)\s*\d+[a-z]?\s*/i, "")
    .replace(/\b(sek|msek|tsek|ksek|kr)\b/gi, " ")
    .replace(/[^a-z0-9åäöé]+/gi, " ")
    .split(/\s+/)
    .filter((word) => word && !stopwords.has(word))
    .join(" ")
    .trim();
}

function labelSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function pageSection(page: ExtractedPage) {
  const topText = page.lines
    .filter((line) => line.rect[1] < page.bounds[1] + (page.bounds[3] - page.bounds[1]) * 0.42)
    .map((line) => line.text)
    .join(" ");
  return sectionRules.find(([pattern]) => pattern.test(topText))?.[1] || "Financial tables";
}

function tokenCenter(token: PdfToken) {
  return (token.rect[0] + token.rect[2]) / 2;
}

function yearFromToken(token: PdfToken) {
  const year = Number(token.text.replace(/\s/g, ""));
  return Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : null;
}

function leadingLabel(line: PdfLine, number: PdfToken, labelCutoff: number, previous?: PdfLine) {
  const tokens = line.tokens
    .filter((token) => token.rect[2] <= Math.min(number.rect[0] + 1, labelCutoff) && !token.isNumber);
  if (tokens.length) {
    const rect = tokens.reduce<Rect | null>(
      (box, token) =>
        box
          ? [
              Math.min(box[0], token.rect[0]),
              Math.min(box[1], token.rect[1]),
              Math.max(box[2], token.rect[2]),
              Math.max(box[3], token.rect[3]),
            ]
          : token.rect,
      null,
    );
    return { text: tokens.map((token) => token.text).join(" ").trim(), rect: rect! };
  }
  if (previous && !previous.tokens.some((token) => token.isNumber)) return { text: previous.text.trim(), rect: previous.rect };
  return null;
}

function extractCells(pages: ExtractedPage[]) {
  const cells: ComparableCell[] = [];
  for (const page of pages) {
    const section = pageSection(page);
    const headerLines = page.lines
      .map((line) => ({
        line,
        years: line.tokens
          .map((token) => ({ token, year: yearFromToken(token) }))
          .filter((item): item is { token: PdfToken; year: number } => item.year !== null),
      }))
      .filter(({ years }) => years.length >= 2)
      .sort((a, b) => a.line.rect[1] - b.line.rect[1])
      .map((header, tableIndex) => ({ ...header, tableIndex }));

    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const numbers = line.tokens.filter(
        (token) => token.isNumber && yearFromToken(token) === null && parseSwedishNumber(token.text) !== null,
      );
      if (numbers.length < 2) continue;
      const y = line.rect[1];
      const header = headerLines
        .filter(({ line: headerLine }) => headerLine.rect[1] < y && y - headerLine.rect[1] < 420)
        .sort((a, b) => b.line.rect[1] - a.line.rect[1])[0];
      if (!header) continue;

      for (const number of numbers) {
        const sortedYears = [...header.years].sort((a, b) => tokenCenter(a.token) - tokenCenter(b.token));
        const nearest = [...sortedYears].sort(
          (a, b) =>
            Math.abs(tokenCenter(a.token) - tokenCenter(number)) -
            Math.abs(tokenCenter(b.token) - tokenCenter(number)),
        )[0];
        const nearestIndex = sortedYears.indexOf(nearest);
        const neighborDistances = [sortedYears[nearestIndex - 1], sortedYears[nearestIndex + 1]]
          .filter(Boolean)
          .map((neighbor) => Math.abs(tokenCenter(neighbor.token) - tokenCenter(nearest.token)));
        const allowedDistance = Math.min(58, (Math.min(...neighborDistances, 120) || 120) * 0.48);
        if (!nearest || Math.abs(tokenCenter(nearest.token) - tokenCenter(number)) > allowedDistance) continue;
        const leftmostYear = Math.min(...sortedYears.map((item) => tokenCenter(item.token)));
        const smallestYearGap = Math.min(
          ...sortedYears.slice(1).map((item, position) => tokenCenter(item.token) - tokenCenter(sortedYears[position].token)),
          90,
        );
        const labelCutoff = leftmostYear - Math.min(84, smallestYearGap * 1.08);
        const labelInfo = leadingLabel(line, number, labelCutoff, page.lines[index - 1]);
        const label = labelInfo?.text || "";
        const normalizedLabel = normalizeLabel(label);
        const value = parseSwedishNumber(number.text);
        if (
          !normalizedLabel ||
          normalizedLabel.length < 4 ||
          genericLabels.has(normalizedLabel) ||
          value === null
        ) continue;
        cells.push({
          id: `${page.page}:${number.id}:${nearest.year}`,
          year: nearest.year,
          label,
          normalizedLabel,
          valueText: number.text,
          value,
          section,
          page: page.page,
          token: number,
          relativePage: page.page / Math.max(1, pages.length - 1),
          tableIndex: header.tableIndex,
          labelRect: labelInfo!.rect,
          yearRect: nearest.token.rect,
        });
      }
    }
  }
  return cells;
}

function bestCandidate(cell: ComparableCell, candidates: ComparableCell[]) {
  const scored = candidates
    .map((candidate) => {
      const label = labelSimilarity(cell.normalizedLabel, candidate.normalizedLabel);
      const section = cell.section === candidate.section ? 0.18 : -0.08;
      const pageDistance = Math.abs(cell.relativePage - candidate.relativePage);
      const proximity = Math.max(0, 0.16 - pageDistance * 0.65);
      const table = cell.tableIndex === candidate.tableIndex ? 0.05 : 0;
      const valueDisambiguation =
        label >= 0.8 && Math.abs(cell.value - candidate.value) < 0.000001 ? 0.58 : 0;
      return {
        candidate,
        score: label + section + proximity + table + valueDisambiguation,
        labelScore: label,
        contextScore: section + proximity + table,
        equal: Math.abs(cell.value - candidate.value) < 0.000001,
      };
    })
    .filter((item) => item.labelScore >= 0.62)
    .sort((a, b) => b.score - a.score);
  const equalMatch = scored.find(
    (item) =>
      item.equal &&
      item.candidate.section === cell.section &&
      Math.abs(item.candidate.relativePage - cell.relativePage) < 0.24 &&
      item.labelScore >= 0.8,
  );
  const best = equalMatch || scored[0];
  if (!best) return undefined;
  const plausible = scored.filter(
    (item) =>
      item.labelScore >= Math.max(0.84, best.labelScore - 0.06) &&
      item.candidate.section === cell.section &&
      Math.abs(item.candidate.relativePage - cell.relativePage) < 0.2,
  );
  const exactCandidates = scored.filter((item) => item.labelScore === 1);
  const secondExact = exactCandidates.find((item) => item.candidate.id !== best.candidate.id);
  const confidentMismatch =
    best.labelScore === 1 &&
    best.candidate.section === cell.section &&
    Math.abs(best.candidate.relativePage - cell.relativePage) < 0.18 &&
    (!secondExact || best.contextScore - secondExact.contextScore >= 0.2);
  return {
    ...best,
    // An equal, semantically plausible value is safe to mark green even if the
    // same row label occurs elsewhere. Unequal duplicate rows remain gray.
    ambiguous: !equalMatch && plausible.length > 1 && !confidentMismatch,
    confidentMismatch,
  };
}

function describe(
  status: Discrepancy["status"],
  cell: ComparableCell,
  source?: ComparableCell,
  sourceValueText?: string,
  uncertain = false,
) {
  if (status === "match") {
    return `${cell.year}: ${cell.valueText} agrees with the prior report${sourceValueText ? ` (${sourceValueText})` : ""}.`;
  }
  if (status === "mismatch") {
    return `${cell.year}: ${cell.valueText} does not agree with the prior report${sourceValueText ? ` (${sourceValueText})` : ""}.`;
  }
  return uncertain && source
    ? `${cell.year}: a possible counterpart was found, but the row alignment was not reliable enough to judge.`
    : `${cell.year}: no reliable counterpart was found in the prior report.`;
}

function toModelRow(cell: ComparableCell): ModelRow {
  return {
    id: cell.id,
    label: cell.label,
    section: cell.section,
    year: cell.year,
    page: cell.page + 1,
    table: cell.tableIndex + 1,
  };
}

function buildSectionJumps(
  discrepancies: Discrepancy[],
  newerPages: number,
  olderPages: number,
): SectionJump[] {
  const groups = new Map<string, Discrepancy[]>();
  for (const discrepancy of discrepancies) {
    const list = groups.get(discrepancy.section) || [];
    list.push(discrepancy);
    groups.set(discrepancy.section, list);
  }
  return [...groups.entries()]
    .map(([title, items]) => {
      const first = items[0];
      return {
        id: normalizeLabel(title).replace(/\s/g, "-"),
        title,
        newerPage: first.newer.page,
        olderPage:
          first.older?.page ??
          Math.min(olderPages - 1, Math.round((first.newer.page / Math.max(1, newerPages - 1)) * olderPages)),
        count: items.length,
      };
    })
    .sort((a, b) => a.newerPage - b.newerPage);
}

export async function analyzePair(
  newerPdf: BrowserPdf,
  olderPdf: BrowserPdf,
  newerYear: number,
  olderYear: number,
  options?: {
    onProgress?: (progress: number, label: string) => void;
    resolveLabels?: ResolveLabels;
  },
): Promise<AnalysisResult> {
  const newerPages = await newerPdf.extractAll((progress) =>
    options?.onProgress?.(progress * 0.43, "Reading newer report"),
  );
  const olderPages = await olderPdf.extractAll((progress) =>
    options?.onProgress?.(0.43 + progress * 0.43, "Reading prior report"),
  );
  options?.onProgress?.(0.88, "Matching comparative rows");

  const allNewerCells = extractCells(newerPages);
  const newerCells = allNewerCells.filter((cell) => cell.year < newerYear);
  const olderCells = extractCells(olderPages);
  const olderByYear = new Map<number, ComparableCell[]>();
  for (const cell of olderCells) {
    const list = olderByYear.get(cell.year) || [];
    list.push(cell);
    olderByYear.set(cell.year, list);
  }

  const preliminary = newerCells.map((cell) => ({
    cell,
    match: bestCandidate(cell, olderByYear.get(cell.year) || []),
  }));
  const unresolved = preliminary.filter(
    (item) =>
      !item.match ||
      (!item.match.equal && (!item.match.confidentMismatch || item.match.ambiguous)),
  );
  const mappings = new Map<string, ModelMapping>();

  if (unresolved.length && options?.resolveLabels) {
    const newerRows = unresolved.slice(0, 80).map((item) => toModelRow(item.cell));
    const olderCandidates = new Map<string, ComparableCell>();
    for (const { cell } of unresolved.slice(0, 80)) {
      const candidates = (olderByYear.get(cell.year) || [])
        .filter(
          (candidate) =>
            candidate.section === cell.section ||
            Math.abs(candidate.relativePage - cell.relativePage) < 0.14,
        )
        .sort(
          (a, b) =>
            Number(b.section === cell.section) - Number(a.section === cell.section) ||
            Math.abs(a.relativePage - cell.relativePage) -
              Math.abs(b.relativePage - cell.relativePage),
        )
        .slice(0, 30);
      for (const candidate of candidates) olderCandidates.set(candidate.id, candidate);
    }
    const olderRows = [...olderCandidates.values()].slice(0, 160).map(toModelRow);
    if (newerRows.length && olderRows.length) {
      options.onProgress?.(0.91, "Resolving renamed rows with the selected model");
      try {
        const response = await options.resolveLabels(newerRows, olderRows);
        const newerIds = new Set(newerRows.map((row) => row.id));
        const olderIds = new Set(olderRows.map((row) => row.id));
        for (const mapping of response.mappings || []) {
          const mappedOlderIds = [...new Set((mapping.olderIds || []).map(String))];
          const validRelationship = mapping.relationship === "none"
            ? mappedOlderIds.length === 0
            : mapping.relationship === "direct"
              ? mappedOlderIds.length === 1
              : mappedOlderIds.length >= 2;
          const validTargets = mappedOlderIds.every((id) => olderIds.has(id));
          if (newerIds.has(mapping.newerId) && validRelationship && validTargets) {
            mappings.set(mapping.newerId, { ...mapping, olderIds: mappedOlderIds });
          }
        }
      } catch {
        // Deterministic results remain valid; unresolved cells stay gray.
      }
    }
  }

  let modelAssisted = 0;
  const discrepancies: Discrepancy[] = preliminary.map(({ cell, match }) => {
    let source = match?.candidate;
    let method: Discrepancy["matchMethod"] = match
      ? match.labelScore === 1
        ? "exact"
        : "similar"
      : "none";
    let aggregateValue: number | null = null;
    let sourceValueText = source?.valueText;
    let uncertain = Boolean(match?.ambiguous);
    let confidentMismatch = Boolean(match?.confidentMismatch);
    if (!source || (!match?.equal && (!match?.confidentMismatch || match?.ambiguous))) {
      const mapping = mappings.get(cell.id);
      if (mapping && mapping.relationship !== "none" && mapping.olderIds.length) {
        const selectedIds = new Set(mapping.olderIds);
        const sources = olderCells.filter(
          (candidate) => candidate.year === cell.year && selectedIds.has(candidate.id),
        );
        if (
          sources.length === mapping.olderIds.length &&
          (mapping.relationship === "aggregate" || sources.length === 1)
        ) {
          source = sources[0];
          aggregateValue = sources.reduce((sum, item) => sum + item.value, 0);
          sourceValueText = sources.map((item) => item.valueText).join(" + ");
          method = "model";
          modelAssisted += 1;
          uncertain = false;
          confidentMismatch = true;
        }
      }
    }

    const comparedValue = aggregateValue ?? source?.value ?? null;
    const equal = comparedValue !== null && Math.abs(cell.value - comparedValue) < 0.000001;
    // A source is judged only after the label match has cleared ambiguity checks.
    // Equality is deterministic; the model can supply a label relationship but
    // never gets to decide whether the numbers agree.
    const status: Discrepancy["status"] = comparedValue === null
      ? "missing"
      : equal
        ? "match"
        : confidentMismatch && !uncertain
          ? "mismatch"
          : "missing";
    return {
      id: `comparison-${cell.id}`,
      status,
      year: cell.year,
      section: cell.section,
      labelNew: cell.label,
      labelOld: source?.label,
      valueNew: cell.valueText,
      valueOld: sourceValueText,
      matchMethod: method,
      explanation: describe(status, cell, source, sourceValueText, comparedValue !== null && status === "missing"),
      newer: {
        page: cell.page,
        rect: cell.token.rect,
        tokenId: cell.token.id,
        keyRect: cell.labelRect,
        yearRect: cell.yearRect,
      },
      older: source
        ? {
            page: source.page,
            rect: source.token.rect,
            tokenId: source.token.id,
            keyRect: source.labelRect,
            yearRect: source.yearRect,
          }
        : undefined,
    };
  });

  options?.onProgress?.(1, "Analysis complete");
  return {
    discrepancies,
    numberHighlights: {
      newer: allNewerCells
        .filter((cell) => cell.year === newerYear)
        .map((cell) => ({ page: cell.page, rect: cell.token.rect, tokenId: cell.token.id })),
      older: [],
    },
    sections: buildSectionJumps(discrepancies, newerPages.length, olderPages.length),
    newerYear,
    olderYear,
    comparedCells: discrepancies.length,
    modelAssisted,
  };
}
