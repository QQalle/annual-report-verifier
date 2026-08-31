import type { BrowserPdf } from "./pdf-engine";
import { parseSwedishNumber } from "./pdf-engine";
import type {
  AnalysisResult,
  Discrepancy,
  ExtractedPage,
  PdfLine,
  PdfToken,
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
};

type ModelMapping = {
  labelNew: string;
  labelsOld: string[];
  relationship: "direct" | "aggregate" | "none";
};

type ResolveLabels = (
  labelsNew: string[],
  labelsOld: string[],
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
  const text = line.tokens
    .filter((token) => token.rect[2] <= Math.min(number.rect[0] + 1, labelCutoff) && !token.isNumber)
    .map((token) => token.text)
    .join(" ")
    .trim();
  if (text) return text;
  if (previous && !previous.tokens.some((token) => token.isNumber)) return previous.text.trim();
  return "";
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
        const label = leadingLabel(line, number, labelCutoff, page.lines[index - 1]);
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
      const section = cell.section === candidate.section ? 0.14 : 0;
      const proximity = Math.max(0, 0.08 - Math.abs(cell.relativePage - candidate.relativePage) * 0.08);
      const table = cell.tableIndex === candidate.tableIndex ? 0.24 : -Math.min(0.18, Math.abs(cell.tableIndex - candidate.tableIndex) * 0.06);
      const valueDisambiguation =
        label >= 0.8 && Math.abs(cell.value - candidate.value) < 0.000001 ? 0.5 : 0;
      return {
        candidate,
        score: label + section + proximity + table + valueDisambiguation,
        labelScore: label,
      };
    })
    .filter((item) => item.labelScore >= 0.62)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return undefined;
  const plausible = scored.filter(
    (item) =>
      item.labelScore >= Math.max(0.8, best.labelScore - 0.04) &&
      Math.abs(item.candidate.relativePage - cell.relativePage) < 0.18,
  );
  return { ...best, ambiguous: plausible.length > 1 };
}

function describe(
  status: Discrepancy["status"],
  cell: ComparableCell,
  source?: ComparableCell,
  ambiguous = false,
) {
  if (status === "match") {
    return `${cell.year}: ${cell.valueText} agrees with the prior report${source ? ` (${source.valueText})` : ""}.`;
  }
  if (status === "mismatch") {
    return `${cell.year}: ${cell.valueText} does not agree with the prior report${source ? ` (${source.valueText})` : ""}.`;
  }
  return ambiguous
    ? `${cell.year}: more than one plausible counterpart was found, so this cell was not judged.`
    : `${cell.year}: no reliable counterpart was found in the prior report.`;
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

  const newerCells = extractCells(newerPages).filter((cell) => cell.year < newerYear);
  const olderCells = extractCells(olderPages);
  const olderByYear = new Map<number, ComparableCell[]>();
  for (const cell of olderCells) {
    const list = olderByYear.get(cell.year) || [];
    list.push(cell);
    olderByYear.set(cell.year, list);
  }

  const occurrenceKey = (cell: ComparableCell) => `${cell.year}:${cell.normalizedLabel}`;
  const newerOccurrences = new Map<string, number>();
  const olderOccurrences = new Map<string, number>();
  for (const cell of newerCells) {
    const key = occurrenceKey(cell);
    newerOccurrences.set(key, (newerOccurrences.get(key) || 0) + 1);
  }
  for (const cell of olderCells) {
    const key = occurrenceKey(cell);
    olderOccurrences.set(key, (olderOccurrences.get(key) || 0) + 1);
  }

  const preliminary = newerCells.map((cell) => ({
    cell,
    match: bestCandidate(cell, olderByYear.get(cell.year) || []),
  }));
  const unresolved = preliminary.filter((item) => !item.match);
  const mappings = new Map<string, ModelMapping>();

  if (unresolved.length && options?.resolveLabels) {
    const labelsNew = [...new Set(unresolved.map((item) => item.cell.label))].slice(0, 80);
    const relevantYears = new Set(unresolved.map((item) => item.cell.year));
    const labelsOld = [
      ...new Set(olderCells.filter((cell) => relevantYears.has(cell.year)).map((cell) => cell.label)),
    ].slice(0, 120);
    if (labelsNew.length && labelsOld.length) {
      options.onProgress?.(0.91, "Resolving renamed rows with the selected model");
      try {
        const response = await options.resolveLabels(labelsNew, labelsOld);
        for (const mapping of response.mappings || []) {
          if (labelsNew.includes(mapping.labelNew)) mappings.set(mapping.labelNew, mapping);
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
    let ambiguous = Boolean(match?.ambiguous);
    let confidentMismatch = Boolean(
      match &&
        !match.ambiguous &&
        match.labelScore === 1 &&
        newerOccurrences.get(occurrenceKey(cell)) === 1 &&
        olderOccurrences.get(occurrenceKey(match.candidate)) === 1 &&
        cell.tableIndex === match.candidate.tableIndex &&
        Math.abs(cell.relativePage - match.candidate.relativePage) < 0.1,
    );

    if (!source) {
      const mapping = mappings.get(cell.label);
      if (mapping && mapping.relationship !== "none" && mapping.labelsOld.length) {
        const normalizedTargets = mapping.labelsOld.map(normalizeLabel);
        const sources = (olderByYear.get(cell.year) || []).filter((candidate) =>
          normalizedTargets.includes(candidate.normalizedLabel),
        );
        if (sources.length === normalizedTargets.length) {
          source = sources[0];
          aggregateValue = sources.reduce((sum, item) => sum + item.value, 0);
          method = "model";
          modelAssisted += 1;
          ambiguous = false;
          confidentMismatch =
            mapping.relationship === "direct" &&
            sources.length === 1 &&
            newerOccurrences.get(occurrenceKey(cell)) === 1 &&
            olderOccurrences.get(occurrenceKey(source)) === 1 &&
            Math.abs(cell.relativePage - source.relativePage) < 0.1;
        }
      }
    }

    const comparedValue = aggregateValue ?? source?.value ?? null;
    const status: Discrepancy["status"] =
      comparedValue === null || (comparedValue !== null && Math.abs(cell.value - comparedValue) >= 0.000001 && !confidentMismatch)
        ? "missing"
        : Math.abs(cell.value - comparedValue) < 0.000001
          ? "match"
          : "mismatch";
    return {
      id: `comparison-${cell.id}`,
      status,
      year: cell.year,
      section: cell.section,
      labelNew: cell.label,
      labelOld: source?.label,
      valueNew: cell.valueText,
      valueOld: source?.valueText,
      matchMethod: method,
      explanation: describe(status, cell, source, ambiguous || (!confidentMismatch && comparedValue !== null)),
      newer: { page: cell.page, rect: cell.token.rect, tokenId: cell.token.id },
      older: source
        ? { page: source.page, rect: source.token.rect, tokenId: source.token.id }
        : undefined,
    };
  });

  options?.onProgress?.(1, "Analysis complete");
  return {
    discrepancies,
    sections: buildSectionJumps(discrepancies, newerPages.length, olderPages.length),
    newerYear,
    olderYear,
    comparedCells: discrepancies.length,
    modelAssisted,
  };
}
