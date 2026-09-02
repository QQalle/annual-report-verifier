import type { BrowserPdf } from "./pdf-engine";
import { parseSwedishNumber } from "./pdf-engine";
import type {
  AnalysisResult,
  Discrepancy,
  EvidenceTarget,
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
  tableTitle: string;
  nearbyRows: string[];
};

type ModelRow = {
  id: string;
  label: string;
  section: string;
  year: number;
  page: number;
  table: number;
  tableTitle: string;
  nearbyRows: string[];
};

type ModelMapping = {
  newerIds: string[];
  olderIds: string[];
  relationship: "direct" | "aggregate" | "none";
  reason?: string;
};

type ArithmeticProposal = {
  newerIds: string[];
  olderIds: string[];
  relationship: "aggregate";
};

type ResolveLabels = (
  newerRows: ModelRow[],
  olderRows: ModelRow[],
  proposedGroups: ArithmeticProposal[],
  batch: { index: number; count: number },
) => Promise<{ mappings: ModelMapping[] }>;

const sectionRules: Array<[RegExp, string]> = [
  [/flerårsöversikt|multi[- ]year overview|five[- ]year overview/i, "Multi-year overview"],
  [/resultaträkning|income statement|statement of profit/i, "Income statement"],
  [/balansräkning|balance sheet|statement of financial position/i, "Balance sheet"],
  [/disponering av\s+föregående års|föregående års\s+disponering av/i, "Changes in equity"],
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

function characterSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + Number(a[row - 1] !== b[column - 1]),
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function labelSimilarity(a: string, b: string, allowDamagedText = false) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" "));
  const right = new Set(b.split(" "));
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  const wordSimilarity = union ? intersection / union : 0;
  // Preserve the conservative policy: character-level fuzziness is only for a
  // visibly damaged text layer (for example, a missing glyph rendered as �).
  return allowDamagedText ? Math.max(wordSimilarity, characterSimilarity(a, b)) : wordSimilarity;
}

function canonicalDamagedLabel(label: string) {
  return label
    .toLocaleLowerCase("sv-SE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9åäöé�]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function damagedLabelEquivalent(a: string, b: string) {
  const aDamaged = a.includes("�");
  const bDamaged = b.includes("�");
  if (aDamaged === bDamaged) return false;
  const damaged = canonicalDamagedLabel(aDamaged ? a : b);
  const intact = canonicalDamagedLabel(aDamaged ? b : a);
  const pattern = damaged
    .split("�")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[a-zåäöé]{1,3}");
  return Boolean(pattern) && new RegExp(`^${pattern}$`, "i").test(intact);
}

function isStableTableTitle(title: string) {
  const normalized = normalizeLabel(title);
  return Boolean(normalized) &&
    normalized !== "financial table" &&
    !/^summa(?:\s|$)/.test(normalized);
}

function sameTableContext(a: ComparableCell, b: ComparableCell) {
  return isStableTableTitle(a.tableTitle) &&
    isStableTableTitle(b.tableTitle) &&
    a.section === b.section &&
    normalizeLabel(a.tableTitle) === normalizeLabel(b.tableTitle);
}

function arithmeticContextCompatible(a: ComparableCell, b: ComparableCell) {
  return sameTableContext(a, b) || (
    Math.abs(a.page - b.page) <= 1 &&
    a.tableIndex === b.tableIndex
  );
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
  const match = token.text.match(/(?:19|20)\d{2}/);
  const year = match ? Number(match[0]) : NaN;
  return Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : null;
}

type HeaderBand = {
  rect: Rect;
  years: Array<{ token: PdfToken; year: number }>;
  tableIndex: number;
  title: string;
};

function rectUnion(rects: Rect[]): Rect {
  return rects.reduce<Rect>(
    (box, rect) => [
      Math.min(box[0], rect[0]),
      Math.min(box[1], rect[1]),
      Math.max(box[2], rect[2]),
      Math.max(box[3], rect[3]),
    ],
    [...rects[0]] as Rect,
  );
}

function tableTitle(lines: PdfLine[], headerTop: number) {
  const candidates = lines
    .filter((line) => line.rect[3] <= headerTop + 3 && headerTop - line.rect[3] < 150)
    .filter((line) => {
      if (/^\s*\d{6}-?\d{4}\s*$/.test(line.text) || /årsredovisning|annual report/i.test(line.text)) {
        return false;
      }
      const words = line.tokens.filter((token) => yearFromToken(token) === null && !token.isNumber);
      const text = words.map((token) => token.text).join(" ");
      return /[a-zåäö]/i.test(text) && normalizeLabel(text).length >= 3;
    })
    .sort((a, b) => {
      const aHeading = Number(/[A-ZÅÄÖ]{3}/.test(a.text) || /^\s*(NOT|NOTE)\s+\d+/i.test(a.text));
      const bHeading = Number(/[A-ZÅÄÖ]{3}/.test(b.text) || /^\s*(NOT|NOTE)\s+\d+/i.test(b.text));
      return bHeading - aHeading || b.rect[3] - a.rect[3];
    });
  return candidates[0]?.text.trim().slice(0, 220) || "Financial table";
}

function extractHeaderBands(page: ExtractedPage): HeaderBand[] {
  const allowedHeaderWords = new Set([
    "as", "at", "per", "den", "jan", "january", "feb", "february", "mar", "march",
    "apr", "april", "maj", "may", "jun", "june", "jul", "july", "aug", "august",
    "sep", "september", "okt", "oct", "october", "nov", "november", "dec", "december",
    "sek", "tsek", "ksek", "msek", "kr",
  ]);
  const yearLines = page.lines
    .map((line) => ({
      line,
      years: line.tokens
        .map((token) => ({ token, year: yearFromToken(token) }))
        .filter((item): item is { token: PdfToken; year: number } => item.year !== null),
    }))
    .filter(({ line, years }) => {
      if (!years.length) return false;
      const textTokens = line.tokens.filter((token) => yearFromToken(token) === null && !token.isNumber);
      const nonDateWords = textTokens
        .flatMap((token) => normalizeLabel(token.text).split(" "))
        .filter((word) => word && !allowedHeaderWords.has(word));
      if (nonDateWords.length === 0) return true;
      const headingText = textTokens.map((token) => token.text).join(" ").trim();
      const normalizedHeading = normalizeLabel(headingText);
      const yearFontSize = Math.max(...years.map((item) => item.token.fontSize));
      const textFontSize = Math.max(...textTokens.map((token) => token.fontSize));
      const looksLikeNoteHeading = /^\s*(NOT|NOTE)\s*\d+/i.test(headingText);
      const looksLikeColumnHeading = /^(nyckeltal|key figures?|key metrics?)$/i.test(normalizedHeading);
      const uppercaseWords = headingText.match(/[A-ZÅÄÖ]{3,}/g)?.length || 0;
      return looksLikeNoteHeading || looksLikeColumnHeading || uppercaseWords >= 2 ||
        textFontSize > yearFontSize * 1.08;
    });
  const candidates: Array<{ lines: PdfLine[]; years: Array<{ token: PdfToken; year: number }> }> = [];

  for (const seed of yearLines) {
    const center = (seed.line.rect[1] + seed.line.rect[3]) / 2;
    const nearby = yearLines.filter(({ line }) => {
      const otherCenter = (line.rect[1] + line.rect[3]) / 2;
      return Math.abs(otherCenter - center) <= 30;
    });
    const years = nearby.flatMap((item) => item.years);
    const distinct = [...new Set(years.map((item) => item.year))];
    const orderedYears = [...distinct].sort((a, b) => a - b);
    const hasImplausibleYearGap = orderedYears
      .slice(1)
      .some((year, index) => year - orderedYears[index] > 1);
    const xCenters = years.map((item) => tokenCenter(item.token));
    if (
      distinct.length < 2 ||
      hasImplausibleYearGap ||
      Math.max(...xCenters) - Math.min(...xCenters) < 32
    ) continue;
    candidates.push({ lines: nearby.map((item) => item.line), years });
  }

  const unique = new Map<string, { lines: PdfLine[]; years: Array<{ token: PdfToken; year: number }> }>();
  for (const candidate of candidates) {
    const years = [...new Map(candidate.years.map((item) => [`${item.token.id}:${item.year}`, item])).values()];
    const key = years.map((item) => item.token.id).sort().join(":");
    unique.set(key, { ...candidate, years });
  }

  return [...unique.values()]
    .sort((a, b) => Math.min(...a.lines.map((line) => line.rect[1])) - Math.min(...b.lines.map((line) => line.rect[1])))
    .map((candidate, tableIndex) => {
      const rect = rectUnion(candidate.lines.map((line) => line.rect));
      const inlineTitle = candidate.lines
        .flatMap((line) => line.tokens)
        .filter((token) => yearFromToken(token) === null && !token.isNumber)
        .map((token) => token.text)
        .join(" ")
        .trim();
      const normalizedInlineTitle = normalizeLabel(inlineTitle);
      const isColumnHeading = /^(nyckeltal|key figures?|key metrics?)$/i.test(normalizedInlineTitle);
      const keyFiguresTitle = /^nyckeltal$/i.test(normalizedInlineTitle)
        ? "Flerårsöversikt"
        : "Multi-year overview";
      return {
        rect,
        years: candidate.years,
        tableIndex,
        title: isColumnHeading
          ? keyFiguresTitle
          : normalizedInlineTitle.length >= 3
            ? inlineTitle.slice(0, 220)
            : tableTitle(page.lines, rect[1]),
      };
    });
}

function leadingLabel(line: PdfLine, number: PdfToken, labelCutoff: number, previous?: PdfLine) {
  let tokens = line.tokens
    .filter((token) => token.rect[2] <= Math.min(number.rect[0] + 1, labelCutoff) && !token.isNumber);
  const previousIsWrapped = previous &&
    !previous.tokens.some((token) => token.isNumber) &&
    line.rect[1] - previous.rect[3] < 16 &&
    Math.abs(previous.rect[0] - line.rect[0]) < 18 &&
    previous.rect[2] <= labelCutoff + 3;
  if (tokens.length && previousIsWrapped) tokens = [...previous!.tokens, ...tokens];
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

function nearbyRowLabels(page: ExtractedPage, lineIndex: number, labelCutoff: number) {
  return page.lines
    .slice(Math.max(0, lineIndex - 2), lineIndex + 3)
    .map((line) => line.tokens
      .filter((token) => !token.isNumber && token.rect[2] <= labelCutoff)
      .map((token) => token.text)
      .join(" ")
      .trim())
    .filter((label) => normalizeLabel(label).length >= 2)
    .slice(0, 5);
}

function extractCells(pages: ExtractedPage[]) {
  const cells: ComparableCell[] = [];
  for (const page of pages) {
    const pageLevelSection = pageSection(page);
    const headerBands = extractHeaderBands(page);
    const headerTokenIds = new Set(headerBands.flatMap((header) => header.years.map((item) => item.token.id)));

    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const numbers = line.tokens.filter(
        (token) => token.isNumber && !headerTokenIds.has(token.id) && parseSwedishNumber(token.text) !== null,
      );
      if (numbers.length < 2) continue;
      const y = line.rect[1];
      const nearbyHeaders = headerBands.filter(
        (candidate) => Math.abs(y - (candidate.rect[1] + candidate.rect[3]) / 2) < 420,
      );
      const precedingHeaders = nearbyHeaders
        .filter((candidate) => (candidate.rect[1] + candidate.rect[3]) / 2 <= y + 3)
        .sort((a, b) => b.rect[3] - a.rect[3]);
      const header = precedingHeaders[0] || nearbyHeaders.sort((a, b) =>
        Math.abs(y - (a.rect[1] + a.rect[3]) / 2) - Math.abs(y - (b.rect[1] + b.rect[3]) / 2),
      )[0];
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
          normalizedLabel.length < 2 ||
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
          section: pageLevelSection === "Financial tables" ? header.title : pageLevelSection,
          page: page.page,
          token: number,
          relativePage: page.page / Math.max(1, pages.length - 1),
          tableIndex: header.tableIndex,
          labelRect: labelInfo!.rect,
          yearRect: nearest.token.rect,
          tableTitle: header.title,
          nearbyRows: nearbyRowLabels(page, index, labelCutoff),
        });
      }
    }
  }
  return cells;
}

function bestCandidate(cell: ComparableCell, candidates: ComparableCell[]) {
  const scored = candidates
    .map((candidate) => {
      const damagedExact = damagedLabelEquivalent(cell.label, candidate.label);
      const label = damagedExact ? 1 : labelSimilarity(
        cell.normalizedLabel,
        candidate.normalizedLabel,
        cell.label.includes("�") || candidate.label.includes("�"),
      );
      const section = cell.section === candidate.section ? 0.18 : -0.08;
      const titleSimilarity = labelSimilarity(
        normalizeLabel(cell.tableTitle),
        normalizeLabel(candidate.tableTitle),
      );
      const title = titleSimilarity >= 0.75 ? 0.24 : titleSimilarity === 0 ? -0.1 : 0;
      const pageDistance = Math.abs(cell.relativePage - candidate.relativePage);
      const proximity = Math.max(0, 0.16 - pageDistance * 0.65);
      const table = cell.tableIndex === candidate.tableIndex ? 0.05 : 0;
      const valueDisambiguation =
        label >= 0.8 && Math.abs(cell.value - candidate.value) < 0.000001 ? 0.58 : 0;
      return {
        candidate,
        score: label + section + title + proximity + table + valueDisambiguation,
        labelScore: label,
        contextScore: section + title + proximity + table,
        titleScore: titleSimilarity,
        equal: Math.abs(cell.value - candidate.value) < 0.000001,
        exactLabel: cell.normalizedLabel === candidate.normalizedLabel || damagedExact,
        damagedExact,
      };
    })
    .filter((item) => item.labelScore >= 0.62)
    .sort((a, b) => b.score - a.score);
  const equalMatch = scored.find(
    (item) =>
      item.equal &&
      item.candidate.section === cell.section &&
      item.titleScore >= 0.72 &&
      Math.abs(item.candidate.relativePage - cell.relativePage) < 0.24 &&
      item.labelScore >= 0.8,
  );
  const best = equalMatch || scored[0];
  if (!best) return undefined;
  const plausible = scored.filter(
    (item) =>
      item.labelScore >= Math.max(0.84, best.labelScore - 0.06) &&
      item.candidate.section === cell.section &&
      item.titleScore >= 0.68 &&
      Math.abs(item.candidate.relativePage - cell.relativePage) < 0.2,
  );
  const exactCandidates = scored.filter((item) => item.exactLabel);
  const sameTable = (candidate: ComparableCell) => sameTableContext(cell, candidate);
  const exactSameContext = exactCandidates.filter((item) => sameTable(item.candidate));
  const confidentMismatch =
    best.exactLabel &&
    sameTable(best.candidate) &&
    Math.abs(best.candidate.relativePage - cell.relativePage) < 0.18 &&
    exactSameContext.length === 1;
  return {
    ...best,
    // Equal, contextually plausible values are safe to mark green even when a
    // label repeats. Unequal duplicates remain unresolved unless one alignment
    // is uniquely stronger than the alternatives.
    ambiguous: !equalMatch && plausible.length > 1 && !confidentMismatch,
    confidentMismatch,
    candidateCount: plausible.length || scored.length,
    sameTableContext: sameTable(best.candidate),
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
    tableTitle: cell.tableTitle,
    nearbyRows: cell.nearbyRows,
  };
}

function arithmeticEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.000001;
}

function subsetsOfSize<T>(items: T[], size: number, limit: number) {
  const results: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (results.length >= limit) return;
    if (selected.length === size) {
      results.push(selected);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      visit(index + 1, [...selected, items[index]]);
      if (results.length >= limit) return;
    }
  };
  visit(0, []);
  return results;
}

function buildArithmeticProposals(
  unresolved: Array<{ cell: ComparableCell; match: ReturnType<typeof bestCandidate> }>,
  olderCandidates: ComparableCell[],
  protectedOlderIds: Set<string>,
) {
  const proposals: ArithmeticProposal[] = [];
  const seen = new Set<string>();
  const maxForwardProposals = unresolved.length * 3;
  const maxTotalProposals = 80;

  for (const { cell, match } of unresolved) {
    const title = normalizeLabel(cell.tableTitle);
    const pool = olderCandidates
      .filter((candidate) =>
        candidate.year === cell.year &&
        !protectedOlderIds.has(candidate.id) &&
        candidate.value !== 0 &&
        (labelSimilarity(title, normalizeLabel(candidate.tableTitle)) >= 0.65 ||
          arithmeticContextCompatible(cell, candidate)) &&
        Math.abs(candidate.relativePage - cell.relativePage) < 0.2,
      )
      .sort((a, b) =>
        Number(b.id === match?.candidate.id) - Number(a.id === match?.candidate.id) ||
        labelSimilarity(cell.normalizedLabel, b.normalizedLabel) -
          labelSimilarity(cell.normalizedLabel, a.normalizedLabel) ||
        Math.abs(a.relativePage - cell.relativePage) - Math.abs(b.relativePage - cell.relativePage),
      )
      .slice(0, 14);
    const anchor = match?.candidate && pool.find((candidate) => candidate.id === match.candidate.id);
    const extras = anchor ? pool.filter((candidate) => candidate.id !== anchor.id) : pool;
    let proposalsForCell = 0;

    for (let size = anchor ? 1 : 2; size <= (anchor ? 3 : 4); size += 1) {
      for (const selected of subsetsOfSize(extras, size, 1500)) {
        const group = anchor ? [anchor, ...selected] : selected;
        const total = group.reduce((sum, candidate) => sum + candidate.value, 0);
        if (!arithmeticEqual(cell.value, total)) continue;
        const olderIds = [...group]
          .sort((a, b) => a.page - b.page || a.token.rect[1] - b.token.rect[1])
          .map((candidate) => candidate.id);
        const signature = mappingSignature([cell.id], olderIds);
        if (seen.has(signature)) continue;
        seen.add(signature);
        proposals.push({ newerIds: [cell.id], olderIds, relationship: "aggregate" });
        proposalsForCell += 1;
        if (proposalsForCell >= 3) break;
      }
      if (proposalsForCell >= 3) break;
    }
  }

  // With batches of at most 20 rows, three proposals per row leaves every row
  // a fair chance before the request-level cap is used for inverse groups.
  if (proposals.length > maxForwardProposals) proposals.splice(maxForwardProposals);

  // Search the inverse direction as well: several rows in the newer report may
  // have replaced one combined row in the older report. These groups are still
  // bounded and proven numerically before the model sees their IDs.
  const inverseCoveredNewerIds = new Set<string>();
  for (const older of olderCandidates) {
    if (proposals.length >= maxTotalProposals) break;
    if (protectedOlderIds.has(older.id) || older.value === 0) continue;
    const pool = unresolved
      .map(({ cell }) => cell)
      .filter((cell) =>
        cell.year === older.year &&
        cell.value !== 0 &&
        (labelSimilarity(normalizeLabel(cell.tableTitle), normalizeLabel(older.tableTitle)) >= 0.65 ||
          arithmeticContextCompatible(cell, older)) &&
        Math.abs(cell.relativePage - older.relativePage) < 0.2,
      )
      .sort((a, b) =>
        labelSimilarity(b.normalizedLabel, older.normalizedLabel) -
          labelSimilarity(a.normalizedLabel, older.normalizedLabel) ||
        Math.abs(a.relativePage - older.relativePage) - Math.abs(b.relativePage - older.relativePage),
      )
      .slice(0, 14);
    let proposalsForCell = 0;

    for (let size = 2; size <= 4; size += 1) {
      for (const selected of subsetsOfSize(pool, size, 1500)) {
        const total = selected.reduce((sum, candidate) => sum + candidate.value, 0);
        if (!arithmeticEqual(total, older.value)) continue;
        if (selected.every((candidate) => inverseCoveredNewerIds.has(candidate.id))) continue;
        const newerIds = [...selected]
          .sort((a, b) => a.page - b.page || a.token.rect[1] - b.token.rect[1])
          .map((candidate) => candidate.id);
        const signature = mappingSignature(newerIds, [older.id]);
        if (seen.has(signature)) continue;
        seen.add(signature);
        proposals.push({ newerIds, olderIds: [older.id], relationship: "aggregate" });
        newerIds.forEach((id) => inverseCoveredNewerIds.add(id));
        proposalsForCell += 1;
        if (proposalsForCell >= 1 || proposals.length >= maxTotalProposals) break;
      }
      if (proposalsForCell >= 1 || proposals.length >= maxTotalProposals) break;
    }
  }
  return proposals;
}

function mappingSignature(newerIds: string[], olderIds: string[]) {
  return `${[...newerIds].sort().join(":")}=>${[...olderIds].sort().join(":")}`;
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
    .map(([title, items], index) => {
      const first = items[0];
      return {
        id: `${normalizeLabel(title).replace(/\s/g, "-")}-${first.newer.page}-${index}`,
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
  const counterpartClaims = new Map<string, Array<(typeof preliminary)[number]>>();
  for (const item of preliminary) {
    if (item.match && !item.match.ambiguous) {
      const claims = counterpartClaims.get(item.match.candidate.id) || [];
      claims.push(item);
      counterpartClaims.set(item.match.candidate.id, claims);
    }
  }
  const collidingNewerIds = new Set<string>();
  for (const claims of counterpartClaims.values()) {
    if (claims.length < 2) continue;
    const exactSameTableClaims = claims.filter((item) =>
      item.match?.exactLabel && item.match.sameTableContext,
    );
    const collisions = exactSameTableClaims.length === 1
      ? claims.filter((item) => item !== exactSameTableClaims[0])
      : claims;
    collisions.forEach((item) => collidingNewerIds.add(item.cell.id));
  }
  const hasCounterpartCollision = (item: (typeof preliminary)[number]) =>
    collidingNewerIds.has(item.cell.id);
  const unresolved = preliminary.filter(
    (item) => !item.match || !item.match.equal || item.match.ambiguous || hasCounterpartCollision(item),
  );
  const protectedOlderIds = new Set(
    preliminary
      .filter((item) => item.match?.equal && !item.match.ambiguous && !hasCounterpartCollision(item))
      .map((item) => item.match!.candidate.id),
  );
  const deterministicMismatchTargets = new Map(
    preliminary
      .filter((item) => item.match?.confidentMismatch && !hasCounterpartCollision(item))
      .map((item) => [item.cell.id, item.match!.candidate.id]),
  );
  const mappings: ModelMapping[] = [];
  let batchesAttempted = 0;
  let batchesFailed = 0;
  let mappingsRejected = 0;

  if (unresolved.length && options?.resolveLabels) {
    const batchSize = 20;
    const batches = Array.from(
      { length: Math.ceil(unresolved.length / batchSize) },
      (_, index) => unresolved.slice(index * batchSize, (index + 1) * batchSize),
    );
    const newerById = new Map(newerCells.map((cell) => [cell.id, cell]));
    const olderById = new Map(olderCells.map((cell) => [cell.id, cell]));
    const usedNewer = new Set<string>();
    const usedOlder = new Set<string>(protectedOlderIds);

    for (const [batchIndex, batch] of batches.entries()) {
      const newerRows = batch.map((item) => toModelRow(item.cell));
      const olderCandidates = new Map<string, ComparableCell>();
      const candidateLists: ComparableCell[][] = [];
      for (const { cell } of batch) {
        const candidates = (olderByYear.get(cell.year) || [])
          .filter(
            (candidate) =>
              candidate.section === cell.section ||
              labelSimilarity(normalizeLabel(candidate.tableTitle), normalizeLabel(cell.tableTitle)) >= 0.45 ||
              Math.abs(candidate.relativePage - cell.relativePage) < 0.14,
          )
          .sort(
            (a, b) =>
              Number(b.section === cell.section) - Number(a.section === cell.section) ||
              labelSimilarity(normalizeLabel(b.tableTitle), normalizeLabel(cell.tableTitle)) -
                labelSimilarity(normalizeLabel(a.tableTitle), normalizeLabel(cell.tableTitle)) ||
              Math.abs(a.relativePage - cell.relativePage) -
                Math.abs(b.relativePage - cell.relativePage),
          )
          .slice(0, 40);
        candidateLists.push(candidates);
        for (const candidate of candidates) olderCandidates.set(candidate.id, candidate);
      }
      const contextualOlderCells = [...olderCandidates.values()];
      const discoveredGroups = buildArithmeticProposals(batch, contextualOlderCells, protectedOlderIds);
      const selectedOlderIds = new Set<string>();
      const candidateLimit = 160;

      // Always retain the deterministic anchor for each unresolved row. Then
      // reserve every member of as many exact arithmetic proposals as fit. The
      // remaining prompt budget is filled round-robin across rows so later
      // pages in a batch cannot be starved by earlier candidate lists.
      for (const item of batch) {
        if (item.match?.candidate.id && selectedOlderIds.size < candidateLimit) {
          selectedOlderIds.add(item.match.candidate.id);
        }
      }
      const proposedGroups: ArithmeticProposal[] = [];
      for (const group of discoveredGroups) {
        const additionalIds = group.olderIds.filter((id) => !selectedOlderIds.has(id));
        if (selectedOlderIds.size + additionalIds.length > candidateLimit) continue;
        additionalIds.forEach((id) => selectedOlderIds.add(id));
        proposedGroups.push(group);
      }
      for (let rank = 0; rank < 40 && selectedOlderIds.size < candidateLimit; rank += 1) {
        for (const candidates of candidateLists) {
          const candidate = candidates[rank];
          if (candidate) selectedOlderIds.add(candidate.id);
          if (selectedOlderIds.size >= candidateLimit) break;
        }
      }
      const olderCandidateCells = [...selectedOlderIds]
        .map((id) => olderCandidates.get(id))
        .filter(Boolean) as ComparableCell[];
      const olderRows = olderCandidateCells.map(toModelRow);
      if (!newerRows.length || !olderRows.length) continue;
      batchesAttempted += 1;

      const batchLabel = batches.length > 1 ? ` (batch ${batchIndex + 1}/${batches.length})` : "";
      options.onProgress?.(
        0.9 + ((batchIndex + 1) / batches.length) * 0.07,
        (proposedGroups.length
          ? "Validating arithmetic row groups with the selected model"
          : "Resolving renamed rows with the selected model") + batchLabel,
      );
      try {
        const response = await options.resolveLabels(newerRows, olderRows, proposedGroups, {
          index: batchIndex + 1,
          count: batches.length,
        });
        const validNewerIds = new Set(newerRows.map((row) => row.id));
        const validOlderIds = new Set(olderRows.map((row) => row.id));
        const proposedSignatures = new Set(
          proposedGroups.map((group) => mappingSignature(group.newerIds, group.olderIds)),
        );
        // A model can occasionally return both the supplied aggregate and a
        // competing one-to-one mapping for its anchor row. Apply the aggregate
        // first so the exact, deterministically verified regrouping is not
        // discarded merely because of response ordering.
        const orderedMappings = [...(response.mappings || [])].sort(
          (left, right) => Number(right.relationship === "aggregate") - Number(left.relationship === "aggregate"),
        );
        for (const mapping of orderedMappings) {
          const mappedNewerIds = [...new Set((mapping.newerIds || []).map(String))];
          const mappedOlderIds = [...new Set((mapping.olderIds || []).map(String))];
          if (mapping.relationship === "none") continue;
          const validRelationship = mapping.relationship === "direct"
            ? mappedNewerIds.length === 1 && mappedOlderIds.length === 1
            : mappedNewerIds.length >= 1 && mappedOlderIds.length >= 1 &&
              (mappedNewerIds.length > 1 || mappedOlderIds.length > 1);
          const validTargets = mappedNewerIds.every((id) => validNewerIds.has(id)) &&
            mappedOlderIds.every((id) => validOlderIds.has(id));
          const unusedTargets = mappedNewerIds.every((id) => !usedNewer.has(id)) &&
            mappedOlderIds.every((id) => !usedOlder.has(id));
          const groupYears = new Set([
            ...mappedNewerIds.map((id) => newerById.get(id)?.year),
            ...mappedOlderIds.map((id) => olderById.get(id)?.year),
          ]);
          const isApprovedProposal = mapping.relationship !== "aggregate" || proposedSignatures.has(
            mappingSignature(mappedNewerIds, mappedOlderIds),
          );
          const arithmeticAgrees = mapping.relationship !== "aggregate" || arithmeticEqual(
            mappedNewerIds.reduce((sum, id) => sum + (newerById.get(id)?.value || 0), 0),
            mappedOlderIds.reduce((sum, id) => sum + (olderById.get(id)?.value || 0), 0),
          );
          const preservesDeterministicMismatch = mapping.relationship !== "direct" || mappedNewerIds.every((id) => {
            const deterministicTarget = deterministicMismatchTargets.get(id);
            return !deterministicTarget || deterministicTarget === mappedOlderIds[0];
          });
          if (
            !validRelationship ||
            !validTargets ||
            !unusedTargets ||
            groupYears.size !== 1 ||
            !isApprovedProposal ||
            !arithmeticAgrees ||
            !preservesDeterministicMismatch
          ) {
            mappingsRejected += 1;
            continue;
          }
          mappedNewerIds.forEach((id) => usedNewer.add(id));
          mappedOlderIds.forEach((id) => usedOlder.add(id));
          mappings.push({ ...mapping, newerIds: mappedNewerIds, olderIds: mappedOlderIds });
        }
      } catch {
        batchesFailed += 1;
        // Continue through later batches; deterministic results remain valid and unresolved cells stay gray.
      }
    }
  }

  const evidence = (cell: ComparableCell): EvidenceTarget => ({
    page: cell.page,
    rect: cell.token.rect,
    tokenId: cell.token.id,
    keyRect: cell.labelRect,
    yearRect: cell.yearRect,
  });
  const newerById = new Map(newerCells.map((cell) => [cell.id, cell]));
  const olderById = new Map(olderCells.map((cell) => [cell.id, cell]));
  const mappingByNewerId = new Map<string, ModelMapping>();
  mappings.forEach((mapping) => mapping.newerIds.forEach((id) => mappingByNewerId.set(id, mapping)));
  const consumedNewerIds = new Set<string>();
  let modelAssisted = 0;
  const discrepancies: Discrepancy[] = [];

  for (const { cell, match } of preliminary) {
    if (consumedNewerIds.has(cell.id)) continue;
    const mapping = mappingByNewerId.get(cell.id);
    if (mapping) {
      const newerGroup = mapping.newerIds.map((id) => newerById.get(id)).filter(Boolean) as ComparableCell[];
      const olderGroup = mapping.olderIds.map((id) => olderById.get(id)).filter(Boolean) as ComparableCell[];
      if (newerGroup.length === mapping.newerIds.length && olderGroup.length === mapping.olderIds.length) {
        mapping.newerIds.forEach((id) => consumedNewerIds.add(id));
        modelAssisted += 1;
        const newerTotal = newerGroup.reduce((sum, item) => sum + item.value, 0);
        const olderTotal = olderGroup.reduce((sum, item) => sum + item.value, 0);
        const equal = Math.abs(newerTotal - olderTotal) < 0.000001;
        const newerExpression = newerGroup.map((item) => item.valueText).join(" + ");
        const olderExpression = olderGroup.map((item) => item.valueText).join(" + ");
        const isArithmetic = mapping.relationship === "aggregate";
        const exactAlignedDirect = mapping.relationship === "direct" &&
          newerGroup.length === 1 &&
          olderGroup.length === 1 &&
          match?.candidate.id === olderGroup[0].id &&
          match.exactLabel &&
          match.confidentMismatch &&
          !match.ambiguous;
        const operator = equal ? "=" : "≠";
        discrepancies.push({
          id: `comparison-model-${mapping.newerIds.join("-")}`,
          status: equal ? "match" : exactAlignedDirect ? "mismatch" : "missing",
          year: newerGroup[0].year,
          section: newerGroup[0].section,
          labelNew: newerGroup.map((item) => item.label).join(" + "),
          labelOld: olderGroup.map((item) => item.label).join(" + "),
          valueNew: newerExpression,
          valueOld: olderExpression,
          matchMethod: "model",
          explanation: isArithmetic
            ? `${newerGroup[0].year}: ${newerExpression} ${operator} ${olderExpression}. The model identified a semantically coherent split/merge; the totals were checked deterministically.`
            : equal
              ? describe("match", newerGroup[0], olderGroup[0], olderExpression)
              : exactAlignedDirect
                ? describe("mismatch", newerGroup[0], olderGroup[0], olderExpression)
                : `${newerGroup[0].year}: the model found a possible renamed counterpart, but unequal values require a unique exact-label deterministic alignment before a discrepancy can be flagged.`,
          newer: evidence(newerGroup[0]),
          older: evidence(olderGroup[0]),
          newerRelated: newerGroup.slice(1).map(evidence),
          olderRelated: olderGroup.slice(1).map(evidence),
          arithmetic: isArithmetic
            ? {
                expression: `${newerExpression} ${operator} ${olderExpression}`,
                newerTerms: newerGroup.map((item) => ({ label: item.label, value: item.valueText })),
                olderTerms: olderGroup.map((item) => ({ label: item.label, value: item.valueText })),
              }
            : undefined,
          evidence: {
            reason: isArithmetic
              ? "aggregate-equal"
              : equal
                ? "model-equal"
                : exactAlignedDirect
                  ? "exact-unequal"
                  : "model-unequal",
            verdict: equal ? "verified" : exactAlignedDirect ? "discrepancy" : "review",
            labelAlignment: isArithmetic
              ? "semantic"
              : exactAlignedDirect
                ? match?.damagedExact ? "damaged-text" : "exact"
                : mapping.relationship === "direct" ? "semantic" : "weak",
            contextAlignment: match?.sameTableContext ? "same-table" : "compatible",
            uniqueCounterpart: mapping.newerIds.length === 1 && mapping.olderIds.length === 1,
            candidateCount: match?.candidateCount || olderGroup.length,
            deterministic: true,
            normalizedNewer: newerTotal,
            normalizedOlder: olderTotal,
            modelRole: isArithmetic ? "arithmetic-coherence" : "rename",
            modelReason: mapping.reason?.slice(0, 500),
          },
        });
        continue;
      }
    }

    const source = match?.candidate;
    const method: Discrepancy["matchMethod"] = match
      ? match.exactLabel && !match.damagedExact ? "exact" : "similar"
      : "none";
    const comparedValue = source?.value ?? null;
    const equal = comparedValue !== null && Math.abs(cell.value - comparedValue) < 0.000001;
    const uncertain = Boolean(match?.ambiguous);
    const counterpartReused = hasCounterpartCollision({ cell, match });
    const status: Discrepancy["status"] = comparedValue === null
      ? "missing"
      : counterpartReused
        ? "missing"
      : equal
        ? "match"
        : match?.confidentMismatch && !uncertain
          ? "mismatch"
          : "missing";
    discrepancies.push({
      id: `comparison-${cell.id}`,
      status,
      year: cell.year,
      section: cell.section,
      labelNew: cell.label,
      labelOld: source?.label,
      valueNew: cell.valueText,
      valueOld: source?.valueText,
      matchMethod: method,
      explanation: counterpartReused
        ? `${cell.year}: this prior-report occurrence was claimed by more than one newer row, so the alignment was not judged.`
        : describe(status, cell, source, source?.valueText, comparedValue !== null && status === "missing"),
      newer: evidence(cell),
      older: source ? evidence(source) : undefined,
      evidence: {
        reason: status === "mismatch"
          ? "exact-unequal"
          : counterpartReused
            ? "counterpart-reused"
            : status === "match"
              ? cell.label.includes("�") || source?.label.includes("�")
                ? "damaged-text-equal"
                : "exact-equal"
              : uncertain
                ? "ambiguous-counterpart"
                : source
                  ? "weak-counterpart"
                  : "no-counterpart",
        verdict: status === "match" ? "verified" : status === "mismatch" ? "discrepancy" : "review",
        labelAlignment: match?.exactLabel && !match.damagedExact
          ? "exact"
          : cell.label.includes("�") || source?.label.includes("�")
            ? "damaged-text"
            : match
              ? "weak"
              : "none",
        contextAlignment: match?.sameTableContext
          ? "same-table"
          : match
            ? "compatible"
            : "none",
        uniqueCounterpart: Boolean(match && !match.ambiguous && !counterpartReused),
        candidateCount: match?.candidateCount || 0,
        deterministic: true,
        normalizedNewer: cell.value,
        normalizedOlder: source?.value,
        modelRole: "none",
      },
    });
  }

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
    coverage: {
      newerExtractedCells: allNewerCells.length,
      olderExtractedCells: olderCells.length,
      overlappingYearCells: newerCells.length,
      verifiedCells: discrepancies.filter((item) => item.status === "match").length,
      reviewCells: discrepancies.filter((item) => item.status === "missing").length,
      discrepancyCells: discrepancies.filter((item) => item.status === "mismatch").length,
    },
    modelReview: {
      enabled: Boolean(options?.resolveLabels),
      batchesAttempted,
      batchesFailed,
      mappingsAccepted: mappings.length,
      mappingsRejected,
    },
  };
}
