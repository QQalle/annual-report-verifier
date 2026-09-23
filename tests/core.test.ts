import assert from "node:assert/strict";
import test from "node:test";
import { buildTypeSafeRequest, mappingsFromTypeSafe } from "../app/api/model/route.ts";
import { analyzePair, extractCells, extractHeaderBands } from "../lib/compare.ts";
import { DEFAULT_MODEL, isModel } from "../lib/model-config.ts";
import type { BrowserPdf } from "../lib/pdf-engine.ts";
import { alterNumber, isNumberText, mergeTextFragments, parseSwedishNumber } from "../lib/pdf-engine.ts";
import type { ExtractedPage, PdfLine, PdfToken, Rect } from "../lib/types.ts";

function token(
  id: string,
  page: number,
  text: string,
  rect: Rect,
  isNumber: boolean,
  lineId: string,
): PdfToken {
  return { id, page, text, rect, fontSize: 10, isNumber, lineId };
}

function reportPage(
  page: number,
  years: [number | string, number | string],
  rows: Array<{ label: string; values: [number, number] }> = [],
  options: { title?: string; inlineTitle?: boolean; headerY?: number; rowStart?: number } = {},
): ExtractedPage {
  const headerId = `p${page}-header`;
  const headerY = options.headerY ?? 50;
  const headerTokens = [
    token(`${headerId}-y0`, page, String(years[0]), [280, headerY, 340, headerY + 12], true, headerId),
    token(`${headerId}-y1`, page, String(years[1]), [380, headerY, 440, headerY + 12], true, headerId),
  ];
  const lines: PdfLine[] = [];
  if (options.title && options.inlineTitle) {
    headerTokens.unshift(token(`${headerId}-title`, page, options.title, [30, headerY, 260, headerY + 12], false, headerId));
  } else if (options.title) {
    const titleId = `p${page}-title`;
    lines.push({
      id: titleId,
      page,
      text: options.title,
      rect: [30, headerY - 28, 260, headerY - 14],
      tokens: [token(`${titleId}-text`, page, options.title, [30, headerY - 28, 260, headerY - 14], false, titleId)],
    });
  }
  lines.push({
    id: headerId,
    page,
    text: `${options.inlineTitle ? `${options.title} ` : ""}${years[0]} ${years[1]}`,
    rect: [options.inlineTitle ? 30 : 280, headerY, 440, headerY + 12],
    tokens: headerTokens,
  });
  rows.forEach((row, index) => {
    const lineId = `p${page}-row${index}`;
    const y = (options.rowStart ?? 100) + index * 24;
    const tokens = [
      token(`${lineId}-label`, page, row.label, [30, y, 180, y + 12], false, lineId),
      token(`${lineId}-v0`, page, String(row.values[0]), [300, y, 320, y + 12], true, lineId),
      token(`${lineId}-v1`, page, String(row.values[1]), [400, y, 420, y + 12], true, lineId),
    ];
    lines.push({
      id: lineId,
      page,
      text: `${row.label} ${row.values[0]} ${row.values[1]}`,
      rect: [30, y, 420, y + 12],
      tokens,
    });
  });
  return {
    page,
    bounds: [0, 0, 600, 800],
    text: lines.map((line) => line.text).join("\n"),
    tokens: lines.flatMap((line) => line.tokens),
    lines,
  };
}

function keyFiguresPage(
  page: number,
  years: number[],
  rows: Array<{ label: string; values: number[] }>,
): ExtractedPage {
  const titleId = `p${page}-key-title`;
  const headerId = `p${page}-key-header`;
  const yearXs = years.map((_, index) => 330 + index * 72);
  const lines: PdfLine[] = [
    {
      id: titleId,
      page,
      text: "Flerårsöversikt",
      rect: [30, 22, 210, 36],
      tokens: [token(`${titleId}-text`, page, "Flerårsöversikt", [30, 22, 210, 36], false, titleId)],
    },
    {
      id: headerId,
      page,
      text: `NYCKELTAL ${years.join(" ")}`,
      rect: [30, 50, yearXs.at(-1)! + 48, 62],
      tokens: [
        token(`${headerId}-label`, page, "NYCKELTAL", [30, 50, 180, 62], false, headerId),
        ...years.map((year, index) =>
          token(`${headerId}-y${index}`, page, String(year), [yearXs[index], 50, yearXs[index] + 48, 62], true, headerId)),
      ],
    },
  ];
  rows.forEach((row, rowIndex) => {
    const lineId = `p${page}-key-row${rowIndex}`;
    const y = 82 + rowIndex * 22;
    const rowTokens = [
      token(`${lineId}-label`, page, row.label, [30, y, 245, y + 12], false, lineId),
      ...row.values.map((value, index) =>
        token(`${lineId}-v${index}`, page, String(value), [yearXs[index], y, yearXs[index] + 48, y + 12], true, lineId)),
    ];
    lines.push({
      id: lineId,
      page,
      text: `${row.label} ${row.values.join(" ")}`,
      rect: [30, y, yearXs.at(-1)! + 48, y + 12],
      tokens: rowTokens,
    });
  });
  return {
    page,
    bounds: [0, 0, 600, 800],
    text: lines.map((line) => line.text).join("\n"),
    tokens: lines.flatMap((line) => line.tokens),
    lines,
  };
}

function sideBySideKeyFiguresPage(
  page: number,
  years: [number, number],
  left: { label: string; values: [number, number] },
  right: { label: string; values: [number, number] },
): ExtractedPage {
  const titleId = `p${page}-side-title`;
  const headerId = `p${page}-side-header`;
  const rowId = `p${page}-side-row`;
  const lines: PdfLine[] = [
    {
      id: titleId,
      page,
      text: "Five-year overview",
      rect: [30, 20, 210, 34],
      tokens: [token(`${titleId}-text`, page, "Five-year overview", [30, 20, 210, 34], false, titleId)],
    },
    {
      id: headerId,
      page,
      text: `${years[0]} ${years[1]} ${years[0]} ${years[1]}`,
      rect: [280, 50, 920, 62],
      tokens: [
        token(`${headerId}-left-0`, page, String(years[0]), [280, 50, 320, 62], true, headerId),
        token(`${headerId}-left-1`, page, String(years[1]), [380, 50, 420, 62], true, headerId),
        token(`${headerId}-right-0`, page, String(years[0]), [780, 50, 820, 62], true, headerId),
        token(`${headerId}-right-1`, page, String(years[1]), [880, 50, 920, 62], true, headerId),
      ],
    },
    {
      id: rowId,
      page,
      text: `${left.label} ${left.values.join(" ")} ${right.label} ${right.values.join(" ")}`,
      rect: [30, 90, 910, 102],
      tokens: [
        token(`${rowId}-left-label`, page, left.label, [30, 90, 200, 102], false, rowId),
        token(`${rowId}-left-0`, page, String(left.values[0]), [290, 90, 315, 102], true, rowId),
        token(`${rowId}-left-1`, page, String(left.values[1]), [390, 90, 415, 102], true, rowId),
        token(`${rowId}-right-label`, page, right.label, [530, 90, 700, 102], false, rowId),
        token(`${rowId}-right-0`, page, String(right.values[0]), [790, 90, 815, 102], true, rowId),
        token(`${rowId}-right-1`, page, String(right.values[1]), [890, 90, 915, 102], true, rowId),
      ],
    },
  ];
  return {
    page,
    bounds: [0, 0, 1000, 800],
    text: lines.map((line) => line.text).join("\n"),
    tokens: lines.flatMap((line) => line.tokens),
    lines,
  };
}

function mockPdf(pages: ExtractedPage[]) {
  return {
    extractAll: async (onProgress?: (progress: number) => void) => {
      onProgress?.(1);
      return pages;
    },
  } as unknown as BrowserPdf;
}

function withUnlabeledRuledTotal(page: ExtractedPage, values: [number, number], y = 126) {
  const lineId = `p${page.page}-unlabeled-total`;
  const totalLine: PdfLine = {
    id: lineId,
    page: page.page,
    text: values.join(" "),
    rect: [300, y, 420, y + 12],
    tokens: [
      token(`${lineId}-v0`, page.page, String(values[0]), [300, y, 320, y + 12], true, lineId),
      token(`${lineId}-v1`, page.page, String(values[1]), [400, y, 420, y + 12], true, lineId),
    ],
  };
  page.lines.push(totalLine);
  page.tokens.push(...totalLine.tokens);
  page.text += `\n${totalLine.text}`;
  page.horizontalRules = [[30, y - 3, 440, y - 2]];
  return page;
}

test("parses annual-report number formats", () => {
  assert.equal(parseSwedishNumber("1\u202f234"), 1234);
  assert.equal(parseSwedishNumber("1,186"), 1186);
  assert.equal(parseSwedishNumber("2,28"), 2.28);
  assert.equal(parseSwedishNumber("(1 917)"), -1917);
  assert.equal(parseSwedishNumber("−42"), -42);
  assert.equal(parseSwedishNumber("94,1%"), 94.1);
  assert.equal(parseSwedishNumber("not a number"), null);
});

test("pins the audited Jev model by default", () => {
  assert.equal(DEFAULT_MODEL, "jev-1.13.0");
  assert.equal(isModel("jev-latest"), true);
  assert.equal(isModel("gpt-5.6"), false);
});

test("recognizes complete numeric tokens only", () => {
  assert.equal(isNumberText("6 104"), true);
  assert.equal(isNumberText("2,28"), true);
  assert.equal(isNumberText("123,"), false);
  assert.equal(isNumberText("2024 report"), false);
});

test("joins overlapping text fragments emitted for kerned PDF words", () => {
  const fragments = [
    token("a", 0, "NY", [10, 10, 20, 20], false, "line"),
    token("b", 0, "CKEL", [19.7, 10, 39, 20], false, "line"),
    token("c", 0, "T", [38.6, 10, 43, 20], false, "line"),
    token("d", 0, "AL", [42.8, 10, 52, 20], false, "line"),
    token("e", 0, "2024", [180, 10, 205, 20], true, "line"),
  ];
  assert.deepEqual(mergeTextFragments(fragments).map((item) => item.text), ["NYCKELTAL", "2024"]);
});

test("recognizes date-formatted and below-row year headers", async () => {
  const newer = [reportPage(0, ["2025-12-31", "2024-Dec"], [{ label: "VA", values: [130, 100] }], { headerY: 160, rowStart: 90 })];
  const older = [reportPage(0, ["31/12/2024", "2023-12-31"], [{ label: "VA", values: [100, 80] }], { headerY: 160, rowStart: 90 })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].status, "match");
});

test("does not treat unrelated prose years as a comparative table header", async () => {
  const prose = reportPage(0, [2013, 2043], [{ label: "Relining av avloppsstammar", values: [251, 253] }]);
  const result = await analyzePair(mockPdf([prose]), mockPdf([prose]), 2025, 2024);
  assert.equal(result.discrepancies.length, 0);
});

test("recognizes a multi-year NYCKELTAL header and compares the whole page", async () => {
  const newer = [keyFiguresPage(0, [2024, 2023, 2022, 2021], [
    { label: "Nettoomsättning", values: [5945570, 5939907, 5468380, 5466580] },
    { label: "Soliditet (%)", values: [13, 15, 14, 13] },
    { label: "Yttre fond", values: [555269, 707361, 286953, 2210348] },
  ])];
  const older = [keyFiguresPage(0, [2023, 2022, 2021, 2020], [
    { label: "Nettoomsättning", values: [5939907, 5468380, 5466580, 5468639] },
    { label: "Soliditet (%)", values: [15, 14, 13, 15] },
    { label: "Yttre fond", values: [707361, 286953, 2210348, 3959645] },
  ])];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  assert.equal(result.discrepancies.length, 9);
  assert.ok(result.discrepancies.every((item) => item.status === "match"));
  assert.deepEqual([...new Set(result.discrepancies.map((item) => item.section))], ["Multi-year overview"]);
});

test("keeps side-by-side key-figure tables in separate horizontal contexts", async () => {
  const newer = sideBySideKeyFiguresPage(
    0,
    [2025, 2024],
    { label: "Net sales growth, %", values: [4.5, -9.9] },
    { label: "Earnings per share, SEK", values: [10.59, 10.45] },
  );
  const older = sideBySideKeyFiguresPage(
    0,
    [2024, 2023],
    { label: "Net sales growth, %", values: [-9.9, -2.4] },
    { label: "Earnings per share, SEK", values: [10.45, 12.19] },
  );
  assert.equal(extractHeaderBands(newer).length, 2);
  assert.deepEqual(
    extractCells([newer]).map((cell) => [cell.label, cell.year, cell.valueText]),
    [
      ["Net sales growth, %", 2025, "4.5"],
      ["Net sales growth, %", 2024, "-9.9"],
      ["Earnings per share, SEK", 2025, "10.59"],
      ["Earnings per share, SEK", 2024, "10.45"],
    ],
  );
  const result = await analyzePair(mockPdf([newer]), mockPdf([older]), 2025, 2024);
  assert.deepEqual(
    result.discrepancies.map((item) => [item.labelNew, item.valueNew, item.status]),
    [
      ["Net sales growth, %", "-9.9", "match"],
      ["Earnings per share, SEK", "10.45", "match"],
    ],
  );
});

test("a preceding year header remains associated with the end of a long table", async () => {
  const newer = [reportPage(0, [2024, 2023], [
    { label: "SUMMA TILLGÅNGAR", values: [64000000, 59876526] },
  ], { title: "BALANSRÄKNING", headerY: 50, rowStart: 550 })];
  const older = [reportPage(0, [2023, 2022], [
    { label: "SUMMA TILLGÅNGAR", values: [59876526, 51000000] },
  ], { title: "BALANSRÄKNING", headerY: 50, rowStart: 550 })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  const total = result.discrepancies.find((item) => item.labelNew === "SUMMA TILLGÅNGAR");
  assert.equal(total?.status, "match");
  assert.equal(total?.valueOld, "59876526");
});

test("a vector rule turns an otherwise unlabeled numeric row into a verifiable total", async () => {
  const newer = [withUnlabeledRuledTotal(reportPage(0, [2024, 2023], [
    { label: "Årets avskrivningar", values: [300, 200] },
  ], { title: "KASSAFLÖDESANALYS" }), [500, 250])];
  const older = [withUnlabeledRuledTotal(reportPage(0, [2023, 2022], [
    { label: "Årets avskrivningar", values: [200, 100] },
  ], { title: "KASSAFLÖDESANALYS" }), [250, 125])];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  const total = result.discrepancies.find((item) => item.labelNew.startsWith("Unlabeled total after"));
  assert.equal(total?.status, "match");
  assert.equal(total?.evidence.reason, "structural-equal");
  assert.equal(total?.evidence.labelAlignment, "structural");
});

test("an unequal unlabeled ruled total stays gray", async () => {
  const newer = [withUnlabeledRuledTotal(reportPage(0, [2024, 2023], [
    { label: "Årets avskrivningar", values: [300, 250] },
  ], { title: "KASSAFLÖDESANALYS" }), [500, 250])];
  const older = [withUnlabeledRuledTotal(reportPage(0, [2023, 2022], [
    { label: "Årets avskrivningar", values: [200, 100] },
  ], { title: "KASSAFLÖDESANALYS" }), [249, 125])];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  const total = result.discrepancies.find((item) => item.labelNew.startsWith("Unlabeled total after"));
  assert.equal(total?.status, "missing");
  assert.notEqual(total?.evidence.verdict, "discrepancy");
});

test("a unique damaged-glyph label can still prove an exact deterministic discrepancy", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Årsavgift per kvm upplåten bostadsrätt, kr", values: [700, 693] },
  ], { title: "FLERÅRSÖVERSIKT" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Årsavgi� per kvm upplåten bostadsrä�, kr", values: [692, 680] },
  ], { title: "FLERÅRSÖVERSIKT" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].evidence.reason, "exact-unequal");
  assert.equal(result.discrepancies[0].evidence.labelAlignment, "damaged-text");
});

test("model confirmation cannot downgrade a damaged-glyph deterministic discrepancy", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Årsavgift per kvm upplåten bostadsrätt, kr", values: [700, 693] },
  ], { title: "FLERÅRSÖVERSIKT" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Årsavgi� per kvm upplåten bostadsrä�, kr", values: [692, 680] },
  ], { title: "FLERÅRSÖVERSIKT" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows[0].id],
        olderIds: [olderRows[0].id],
        relationship: "direct",
      }],
    }),
  });
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].evidence.reason, "exact-unequal");
  assert.equal(result.discrepancies[0].evidence.labelAlignment, "damaged-text");
});

test("compares and labels every opening balance in changes in equity", async () => {
  const newer = [reportPage(0, ["2023-12-31", "2024-12-31"], [
    { label: "Insatser", values: [72134, 72134] },
    { label: "Upplåtelseavgifter", values: [679332, 679332] },
    { label: "Fond, yttre underhåll", values: [707361, 555269] },
    { label: "Balanserat resultat", values: [7039982, 7591102] },
    { label: "Årets resultat", values: [399028, -1551827] },
    { label: "Eget kapital", values: [8897837, 7346010] },
  ], { title: "DISPONERING AV FÖREGÅENDE ÅRS RESULTAT" })];
  const older = [reportPage(0, ["2022-12-31", "2023-12-31"], [
    { label: "Insatser", values: [72134, 72134] },
    { label: "Upplåtelseavgifter", values: [679332, 679332] },
    { label: "Fond, yttre underhåll", values: [286953, 707361] },
    { label: "Balanserat resultat", values: [6640963, 7039982] },
    { label: "Årets resultat", values: [819427, 399028] },
    { label: "Eget kapital", values: [8498809, 8897837] },
  ], { title: "DISPONERING AV FÖREGÅENDE ÅRS RESULTAT" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  assert.equal(result.discrepancies.length, 6);
  assert.ok(result.discrepancies.every((item) => item.status === "match"));
  assert.ok(result.discrepancies.every((item) => item.section === "Changes in equity"));
});

test("keeps short accounting labels such as VA and El", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "VA", values: [20, 14] },
    { label: "El", values: [18, 12] },
  ])];
  const older = [reportPage(0, [2024, 2023], [
    { label: "VA", values: [14, 10] },
    { label: "El", values: [12, 9] },
  ])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.deepEqual(result.discrepancies.map((item) => item.status), ["match", "match"]);
});

test("matches an equal row when the prior PDF text layer has a damaged glyph", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 100] }])];
  const damagedOlderPage = reportPage(0, [2024, 2023], [{ label: "Net�oomsättning", values: [100, 80] }]);
  damagedOlderPage.lines[1].tokens[0].text = "Net�oomsättning";
  damagedOlderPage.lines[1].text = "Net�oomsättning 100 80";
  damagedOlderPage.text = damagedOlderPage.lines.map((line) => line.text).join("\n");

  const result = await analyzePair(mockPdf(newer), mockPdf([damagedOlderPage]), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "match");
});

test("a unique unequal row remains red when the prior PDF text layer has damaged glyphs", async () => {
  const newer = [reportPage(0, [2024, 2023], [{
    label: "Årsavgift per kvm upplåten bostadsrätt, kr",
    values: [800, 693],
  }], { title: "FLERÅRSÖVERSIKT" })];
  const older = [reportPage(0, [2023, 2022], [{
    label: "Årsavgi� per kvm upplåten bostadsrä�, kr",
    values: [692, 600],
  }], { title: "FLERÅRSÖVERSIKT" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].valueNew, "693");
  assert.equal(result.discrepancies[0].valueOld, "692");
  assert.equal(result.discrepancies[0].judgment.basis, "deterministic");
});

test("a row above the next note header stays owned by its preceding table", () => {
  const first = reportPage(0, [2024, 2023], [{
    label: "Bankkostnader",
    values: [6798, 6348],
  }], {
    title: "NOT 8, ÖVRIGA EXTERNA KOSTNADER",
    inlineTitle: true,
    headerY: 50,
    rowStart: 145,
  });
  const second = reportPage(1, [2024, 2023], [], {
    title: "NOT 9, PERSONALKOSTNADER",
    inlineTitle: true,
    headerY: 170,
  });
  const combined: ExtractedPage = {
    ...first,
    lines: [...first.lines, ...second.lines],
    tokens: [...first.tokens, ...second.tokens],
    text: [...first.lines, ...second.lines].map((line) => line.text).join("\n"),
  };

  const bankCells = extractCells([combined]).filter((cell) => cell.label === "Bankkostnader");
  assert.equal(bankCells.length, 2);
  assert.ok(bankCells.every((cell) => cell.tableTitle === "NOT 8, ÖVRIGA EXTERNA KOSTNADER"));
});

test("a completed table title is not inherited by a later untitled table", () => {
  const first = reportPage(0, [2024, 2023], [{ label: "Taxeringsvärde", values: [500, 480] }], {
    title: "Taxeringsvärde",
    headerY: 50,
    rowStart: 80,
  });
  const second = reportPage(1, [2024, 2023], [{ label: "Ingående anskaffningsvärde", values: [272414, 250000] }], {
    headerY: 180,
    rowStart: 210,
  });
  const combined: ExtractedPage = {
    ...first,
    lines: [...first.lines, ...second.lines],
    tokens: [...first.tokens, ...second.tokens],
    text: [...first.lines, ...second.lines].map((line) => line.text).join("\n"),
  };

  const bands = extractHeaderBands(combined);
  assert.equal(bands.length, 2);
  assert.equal(bands[0].title, "Taxeringsvärde");
  assert.equal(bands[1].title, "Financial table 2");
});

test("keeps values that happen to look like calendar years", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Driftskostnad", values: [3000, 2024] }])];
  const older = [reportPage(0, [2024, 2023], [{ label: "Driftskostnad", values: [2024, 1900] }])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].valueNew, "2024");
});

test("scrambled numbers stay numeric and change", () => {
  const replacement = alterNumber("6 104");
  assert.notEqual(replacement, "6 104");
  assert.notEqual(parseSwedishNumber(replacement), null);
});

test("untouched downloads preserve source bytes and scrambled exports remove live source text", async () => {
  const mupdf = (await import("mupdf")).default;
  const fixture = new mupdf.PDFDocument();
  const pageObject = fixture.addPage(
    [0, 0, 300, 200],
    0,
    { Font: { F1: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" } } },
    new TextEncoder().encode("BT /F1 12 Tf 40 100 Td (Secret 123) Tj ET"),
  );
  fixture.insertPage(-1, pageObject);
  const buffer = fixture.saveToBuffer("garbage=4");
  const source = new Uint8Array(buffer.asUint8Array());
  buffer.destroy();
  fixture.destroy();

  const pdf = await (await import("../lib/pdf-engine.ts")).BrowserPdf.load(source, "fixture.pdf");
  assert.deepEqual(pdf.downloadBytes(), source, "the untouched download is byte-for-byte original");
  const rendered = await pdf.renderPage(0, 1);
  const png = new Uint8Array(await (await fetch(rendered.url)).arrayBuffer());
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(rendered.width, 300);
  URL.revokeObjectURL(rendered.url);
  const extracted = await pdf.extractPage(0);
  const secret = extracted.tokens.find((item) => item.text === "Secret");
  assert.ok(secret);
  await pdf.applyChange({
    id: secret.id,
    page: secret.page,
    rect: secret.rect,
    original: secret.text,
    replacement: "Public",
    fontSize: secret.fontSize,
    align: "left",
  });
  const exported = pdf.downloadBytes();
  assert.notDeepEqual(exported, source);
  const reopened = await (await import("../lib/pdf-engine.ts")).BrowserPdf.load(exported, "fixture-scrambled.pdf");
  const exportedText = (await reopened.extractPage(0)).text;
  assert.doesNotMatch(exportedText, /Secret/);
  assert.match(exportedText, /Public/);
  reopened.destroy();
  pdf.destroy();
});

test("a local text-layer PDF pair produces coordinate-linked red evidence", async () => {
  const mupdf = (await import("mupdf")).default;
  const makePdf = (years: [number, number], values: [number, number]) => {
    const document = new mupdf.PDFDocument();
    const content = [
      "BT /F1 12 Tf 30 750 Td (INCOME STATEMENT) Tj ET",
      `BT /F1 10 Tf 280 700 Td (${years[0]}) Tj ET`,
      `BT /F1 10 Tf 380 700 Td (${years[1]}) Tj ET`,
      "BT /F1 10 Tf 30 650 Td (Nettoomsattning) Tj ET",
      `BT /F1 10 Tf 290 650 Td (${values[0]}) Tj ET`,
      `BT /F1 10 Tf 390 650 Td (${values[1]}) Tj ET`,
    ].join("\n");
    const page = document.addPage(
      [0, 0, 600, 800],
      0,
      { Font: { F1: { Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" } } },
      new TextEncoder().encode(content),
    );
    document.insertPage(-1, page);
    const saved = document.saveToBuffer("garbage=4");
    const bytes = new Uint8Array(saved.asUint8Array());
    saved.destroy();
    document.destroy();
    return bytes;
  };
  const { BrowserPdf: Pdf } = await import("../lib/pdf-engine.ts");
  const newer = await Pdf.load(makePdf([2025, 2024], [130, 101]), "newer-2025.pdf");
  const older = await Pdf.load(makePdf([2024, 2023], [100, 80]), "older-2024.pdf");
  const result = await analyzePair(newer, older, 2025, 2024);
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].newer.page, 0);
  assert.equal(result.discrepancies[0].older?.page, 0);
  assert.ok(result.discrepancies[0].newer.rect[2] > result.discrepancies[0].newer.rect[0]);
  assert.ok(result.discrepancies[0].older!.keyRect);
  newer.destroy();
  older.destroy();
});

test("equal repeated rows use the agreeing context instead of an unequal duplicate", async () => {
  const newerPages = Array.from({ length: 6 }, (_, page) =>
    reportPage(page, [2025, 2024], page === 2 ? [{ label: "Nettoomsättning", values: [130, 100] }] : []),
  );
  const olderPages = Array.from({ length: 6 }, (_, page) =>
    reportPage(
      page,
      [2024, 2023],
      page === 2
        ? [{ label: "Nettoomsättning", values: [99, 80] }]
        : page === 3
          ? [{ label: "Nettoomsättning", values: [100, 81] }]
          : [],
    ),
  );

  const result = await analyzePair(mockPdf(newerPages), mockPdf(olderPages), 2025, 2024);
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].valueOld, "100");
  assert.equal(result.numberHighlights.newer.length, 1, "only the newer report's current-year column is yellow");
  assert.equal(result.numberHighlights.older.length, 0, "the prior report has no permanent yellow figures");
});

test("unequal duplicate rows stay gray when their alignment is uncertain", async () => {
  const newerPages = Array.from({ length: 6 }, (_, page) =>
    reportPage(page, [2025, 2024], page === 2 ? [{ label: "Nettoomsättning", values: [130, 101] }] : []),
  );
  const olderPages = Array.from({ length: 6 }, (_, page) =>
    reportPage(
      page,
      [2024, 2023],
      page === 2
        ? [{ label: "Nettoomsättning", values: [99, 80] }]
        : page === 3
          ? [{ label: "Nettoomsättning", values: [100, 81] }]
          : [],
    ),
  );

  const result = await analyzePair(mockPdf(newerPages), mockPdf(olderPages), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "missing");
});

test("equal trivial-value rows with unrelated labels are not offered as semantic matches", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Tak", values: [0, 0] },
    { label: "Öres- och kronutjämning", values: [-1, -1] },
  ], {
    title: "NOT 5, UNDERHÅLL",
  })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Balkonger", values: [0, 0] },
    { label: "Övriga rörelseintäkter", values: [-1, -1] },
  ], {
    title: "NOT 5, UNDERHÅLL",
  })];
  let directPairCount = -1;
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (_newerRows, _olderRows, _groups, directPairs) => {
      directPairCount = directPairs.length;
      return { mappings: [] };
    },
  });

  assert.ok(directPairCount <= 0);
  assert.ok(result.discrepancies.every((item) => item.status === "missing"));
  assert.equal(result.modelAssisted, 0);
});

test("a unique exact row with unequal values is a discrepancy", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 101] }], { title: "NOT 2, INTÄKTER" })];
  const older = [reportPage(0, [2024, 2023], [{ label: "Nettoomsättning", values: [100, 80] }], { title: "NOT 2, INTÄKTER" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].evidence.reason, "exact-unequal");
  assert.equal(result.discrepancies[0].evidence.contextAlignment, "same-table");
});

test("an exact label in a different table context cannot become red", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 101] }], { title: "NOT 2, INTÄKTER" })];
  const older = [reportPage(0, [2024, 2023], [{ label: "Nettoomsättning", values: [100, 80] }], { title: "NOT 8, SEGMENTSINFORMATION" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.discrepancies[0].evidence.verdict, "review");
});

test("a uniquely equal exact occurrence can follow a note that moved by one page", async () => {
  const newer = [
    reportPage(0, [2025, 2024]),
    reportPage(1, [2025, 2024], [
      { label: "Ackumulerat anskaffningsvärde Ingående", values: [150, 100] },
    ]),
  ];
  const older = [
    reportPage(0, [2024, 2023], [
      { label: "Ackumulerat anskaffningsvärde Ingående", values: [100, 80] },
    ]),
    reportPage(1, [2024, 2023], [
      { label: "Ackumulerat anskaffningsvärde Ingående", values: [59, 40] },
    ]),
  ];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].older?.page, 0);
  assert.equal(result.discrepancies[0].valueOld, "100");
});

test("a generic fallback table title is insufficient context for red", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Ingående anskaffningsvärde", values: [300, 272] },
  ])];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Ingående anskaffningsvärde", values: [59, 0] },
  ])];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.discrepancies[0].evidence.contextAlignment, "compatible");
});

test("one prior occurrence cannot verify two newer rows", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Serviceavtal", values: [140, 100] },
    { label: "Serviceavtal", values: [150, 100] },
  ], { title: "NOT 5, REPARATIONER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Serviceavtal", values: [100, 80] },
  ], { title: "NOT 5, REPARATIONER" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.deepEqual(result.discrepancies.map((item) => item.status), ["missing", "missing"]);
  assert.ok(result.discrepancies.every((item) => item.evidence.reason === "counterpart-reused"));
});

test("an exact label in a different statement context stays gray", async () => {
  const newer = [reportPage(0, [2024, 2023], [{ label: "Taxes", values: [-8, -9] }], {
    title: "Parent Company income statement",
  })];
  const older = [reportPage(0, [2023, 2022], [{ label: "Taxes", values: [-321, -373] }], {
    title: "Consolidated income statement",
  })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);
  assert.equal(result.discrepancies[0].status, "missing");
});

test("model-assisted renamed rows use occurrence IDs and structural context", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 100] }], { title: "NOT 2, NETTOOMSÄTTNING", inlineTitle: true })];
  const older = [reportPage(0, [2024, 2023], [{ label: "Rörelsens intäkter", values: [100, 80] }], { title: "NOT 2, NETTOOMSÄTTNING", inlineTitle: true })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => {
      assert.equal(newerRows[0].year, 2024);
      assert.equal(newerRows[0].tableTitle, "NOT 2, NETTOOMSÄTTNING");
      assert.equal(olderRows[0].page, 1);
      return {
        mappings: [
          {
            newerIds: [newerRows[0].id],
            olderIds: [olderRows[0].id],
            relationship: "direct",
          },
        ],
      };
    },
  });
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].matchMethod, "model");
});

test("Jev receives deterministic evidence for the expected Note 5 and salary renames", async () => {
  const newer = [reportPage(0, [2024, 2023], [
    { label: "Reparationer", values: [70000, 68061] },
    { label: "Försäkringsärende/vattenskada", values: [28000, 25383] },
    { label: "Löner, arbetare", values: [55000, 53250] },
    { label: "Sociala avgifter", values: [18000, 17000] },
  ], { title: "NOT 5, FASTIGHETSKOSTNADER", inlineTitle: true })];
  const older = [reportPage(0, [2023, 2022], [
    { label: "Övriga repara�oner", values: [68061, 64000] },
    { label: "Försäkringsskador", values: [25383, 23000] },
    { label: "Löner", values: [53250, 51000] },
    { label: "Sociala avgifter", values: [17000, 16000] },
  ], { title: "NOT 5, FASTIGHETSKOSTNADER", inlineTitle: true })];
  const expected = new Map([
    ["Reparationer", "Övriga repara�oner"],
    ["Försäkringsärende/vattenskada", "Försäkringsskador"],
    ["Löner, arbetare", "Löner"],
  ]);
  const capturedEvidence = new Map<string, { deterministicEqual: boolean; sameReportedYear: boolean; samePdfPage: boolean; sameTableOrdinal: boolean; sharedNearbyRows: string[] }>();

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023, {
    resolveLabels: async (newerRows, olderRows, _groups, directPairs) => {
      const mappings = [...expected].flatMap(([newerLabel, olderLabel]) => {
        const newerRow = newerRows.find((row) => row.label === newerLabel);
        const olderRow = olderRows.find((row) => row.label === olderLabel);
        if (!newerRow || !olderRow) return [];
        const pair = directPairs.find(
          (candidate) => candidate.newerId === newerRow.id && candidate.olderId === olderRow.id,
        );
        if (!pair) return [];
        capturedEvidence.set(newerLabel, pair.evidence);
        return [{
          newerIds: [newerRow.id],
          olderIds: [olderRow.id],
          relationship: "direct" as const,
          judgment: {
            basis: "jev" as const,
            decision: "aligned" as const,
            confidence: 0.98,
            outcomeProbability: 0.99,
          },
        }];
      });
      return { mappings };
    },
  });

  for (const [newerLabel, olderLabel] of expected) {
    const evidence = capturedEvidence.get(newerLabel);
    assert.ok(evidence, `${newerLabel} candidate is sent to Jev`);
    assert.equal(evidence.deterministicEqual, true);
    assert.equal(evidence.sameReportedYear, true);
    assert.equal(evidence.samePdfPage, true);
    assert.equal(evidence.sameTableOrdinal, true);
    const control = result.discrepancies.find((item) => item.labelNew === newerLabel);
    assert.ok(control, JSON.stringify(result.discrepancies.map((item) => item.labelNew)));
    assert.equal(control?.status, "match", JSON.stringify({ modelAssisted: result.modelAssisted, discrepancies: result.discrepancies }));
    assert.equal(control?.labelOld, olderLabel);
    assert.equal(control?.matchMethod, "model");
    assert.equal(control?.judgment.outcomeProbability, 0.99);
  }
});

test("an equal machinery opening balance aligns across a shifted page and stale table title", async () => {
  const newer = Array.from({ length: 10 }, (_, page) => reportPage(page, [2024, 2023]));
  const older = Array.from({ length: 10 }, (_, page) => reportPage(page, [2023, 2022]));
  newer[8] = reportPage(8, [2024, 2023], [
    { label: "Ackumulerat anskaffningsvärde — Ingående", values: [300000, 272414] },
    { label: "Utgående ackumulerat anskaffningsvärde", values: [320000, 290000] },
    { label: "Ackumulerade avskrivningar", values: [-120000, -110000] },
  ], { title: "Maskiner och inventarier" });
  older[7] = reportPage(7, [2023, 2022], [
    { label: "Ackumulerat anskaffningsvärde — Ingående", values: [272414, 250000] },
    { label: "Utgående ackumulerat anskaffningsvärde", values: [290000, 270000] },
    { label: "Ackumulerade avskrivningar", values: [-110000, -100000] },
  ], { title: "Taxeringsvärde" });
  older[8] = reportPage(8, [2023, 2022], [
    { label: "Ackumulerat anskaffningsvärde — Ingående", values: [58963, 50000] },
    { label: "Ackumulerat anskaffningsvärde — Ingående", values: [58964, 50001] },
  ], { title: "Maskiner och inventarier" });

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023);

  const target = result.discrepancies.find((item) =>
    item.labelNew === "Ackumulerat anskaffningsvärde — Ingående" && item.newer.page === 8);
  assert.ok(target, JSON.stringify(result.discrepancies.map((item) => [item.labelNew, item.newer.page])));
  assert.equal(target?.status, "match", JSON.stringify({ modelAssisted: result.modelAssisted, discrepancies: result.discrepancies }));
  assert.equal(target?.valueOld, "272414");
  assert.equal(target?.older?.page, 7);
  assert.equal(target?.judgment.basis, "deterministic");
});

test("a rejected Jev candidate remains gray with Jev review provenance", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Servicekostnad", values: [120, 100] }])];
  const older = [reportPage(0, [2024, 2023], [{ label: "Administrationskostnad", values: [90, 80] }])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [],
      reviews: [{
        newerId: newerRows[0].id,
        olderId: olderRows[0].id,
        decision: "unlinked",
        judgment: {
          basis: "jev",
          decision: "unlinked",
          confidence: 0.91,
          outcomeProbability: 0.04,
          probabilities: { 0: 0.93, 1: 0.03, 2: 0.04 },
        },
      }],
    }),
  });
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.discrepancies[0].judgment.basis, "jev");
  assert.equal(result.discrepancies[0].judgment.decision, "unlinked");
  assert.match(result.discrepancies[0].explanation, /Jev reviewed possible counterparts/);
});

test("residual Övrigt labels can map to a specific renamed key using note context", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Övrigt", values: [130, 100] },
    { label: "Revisionsarvoden", values: [90, 80] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Bank- och administrationskostnader", values: [100, 70] },
    { label: "Revisionsarvoden", values: [80, 75] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows, _proposedGroups, directPairs) => {
      const residual = newerRows.find((row) => row.label === "Övrigt");
      const renamed = olderRows.find((row) => row.label === "Bank- och administrationskostnader");
      assert.equal(residual?.tableTitle, "NOT 9, ÖVRIGA EXTERNA KOSTNADER");
      assert.ok(residual?.nearbyRows.includes("Revisionsarvoden"));
      assert.ok(residual && renamed);
      assert.ok(directPairs.some((proposal) =>
        proposal.newerId === residual.id &&
        proposal.olderId === renamed.id));
      return {
        mappings: [{ newerIds: [residual.id], olderIds: [renamed.id], relationship: "direct" }],
      };
    },
  });

  const residual = result.discrepancies.find((item) => item.labelNew === "Övrigt");
  assert.equal(residual?.status, "match");
  assert.equal(residual?.labelOld, "Bank- och administrationskostnader");
  assert.equal(residual?.matchMethod, "model");
});

test("an unequal residual label cannot become red and does not hide an equal renamed row", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Övrigt", values: [130, 100] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Övrigt", values: [99, 70] },
    { label: "Klottersanering", values: [100, 60] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => {
      const residual = newerRows.find((row) => row.label === "Övrigt");
      const renamed = olderRows.find((row) => row.label === "Klottersanering");
      assert.ok(residual && renamed);
      return { mappings: [{
        newerIds: [residual.id],
        olderIds: [renamed.id],
        relationship: "direct",
      }] };
    },
  });

  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].labelOld, "Klottersanering");
  assert.equal(result.discrepancies[0].matchMethod, "model");
});

test("Jev questions isolate semantic judgments and keep values out of state", () => {
  const newerRows = [{
    id: "new-1", label: "Övrigt", section: "Notes", year: 2024, page: 9, table: 1,
    tableTitle: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", nearbyRows: ["Revisionsarvoden"],
  }];
  const olderRows = [{
    id: "old-1", label: "Bankkostnader", section: "Notes", year: 2024, page: 8, table: 1,
    tableTitle: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", nearbyRows: ["Revisionsarvoden"], value: 42,
  }];
  const definition = buildTypeSafeRequest({
    newerRows,
    olderRows,
    directPairs: [{
      newerId: "new-1",
      olderId: "old-1",
      evidence: {
        deterministicEqual: true,
        sameReportedYear: true,
        samePdfPage: false,
        pageDelta: 1,
        sameTableOrdinal: true,
        sameSection: true,
        tableTitleSimilarity: 1,
        rowDistancePoints: null,
        sameRowPosition: false,
        damagedGlyph: false,
        sharedNearbyRows: ["Revisionsarvoden"],
      },
    }],
    proposedGroups: [],
  });
  const serialized = JSON.stringify(definition.request);
  assert.match(serialized, /Residual labels such as Övrigt/);
  assert.match(serialized, /safest reconciliation action/);
  assert.match(serialized, /"deterministicEqual":true/);
  assert.match(serialized, /"sharedNearbyRows":\["Revisionsarvoden"\]/);
  assert.doesNotMatch(serialized, /"value":42/);
  assert.equal(Object.keys(definition.request.questions).length, 1);
});

test("Jev mappings reject ambiguous direct pairs and retain aggregate confidence", () => {
  const scoreAnswer = (value: number) => ({
    type: "score" as const,
    score: value,
    confidence: 0.8,
    probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 },
    legend: { 0: "different", 1: "uncertain", 2: "same" },
  });
  const result = mappingsFromTypeSafe(
    [
      { newerId: "new-1", olderId: "old-1" },
      { newerId: "new-1", olderId: "old-2" },
      { newerId: "new-2", olderId: "old-3" },
    ],
    [{ newerIds: ["new-3"], olderIds: ["old-4", "old-5"], relationship: "aggregate" }],
    {
      direct_0: scoreAnswer(1.8),
      direct_1: scoreAnswer(1.7),
      direct_2: scoreAnswer(1.6),
      aggregate_concept_0: scoreAnswer(1.9),
      aggregate_structure_0: scoreAnswer(1.8),
    },
  );
  assert.deepEqual(result.mappings.map(({ newerIds, olderIds, relationship }) => ({
    newerIds,
    olderIds,
    relationship,
  })), [
    { newerIds: ["new-3"], olderIds: ["old-4", "old-5"], relationship: "aggregate" },
    { newerIds: ["new-2"], olderIds: ["old-3"], relationship: "direct" },
  ]);
  assert.equal(result.mappings[0].judgment?.basis, "jev");
  assert.equal(result.mappings[0].judgment?.confidence, 0.8);
  assert.equal(result.mappings[0].judgment?.components?.length, 2);
  assert.equal(result.reviews.length, 3);
  assert.equal(result.reviews[0].judgment.decision, "aligned");
});

test("a low-confidence aggregate is approved only when coherent is the dominant outcome", () => {
  const answer = (
    scoreValue: number,
    confidence: number,
    distribution: Record<string, number>,
  ) => ({
    type: "score" as const,
    score: scoreValue,
    confidence,
    probabilities: distribution,
    legend: { 0: "incoherent", 1: "uncertain", 2: "coherent" },
  });
  const result = mappingsFromTypeSafe(
    [],
    [{
      newerIds: ["new-1"],
      olderIds: ["old-1", "old-2"],
      relationship: "aggregate",
      termQuestionIds: ["aggregate_term_0_older_1"],
    }],
    {
      aggregate_concept_0: answer(1, 0, { 0: 0.2, 1: 0.6, 2: 0.2 }),
      aggregate_structure_0: answer(1.3, 0.2, { 0: 0.2, 1: 0.3, 2: 0.5 }),
      aggregate_term_0_older_1: answer(1.2, 0, { 0: 0.25, 1: 0.3, 2: 0.45 }),
    },
  );

  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].judgment?.confidence, 0);
  assert.equal(result.mappings[0].judgment?.outcomeProbability, 0.435);
  assert.equal(result.mappings[0].judgment?.probabilities?.["2"], 0.435);
  assert.equal("termQuestionIds" in result.mappings[0], false);
});

test("a direct alignment needs majority probability, not only a plurality", () => {
  const result = mappingsFromTypeSafe(
    [{ newerId: "new-1", olderId: "old-1" }],
    [],
    {
      direct_0: {
        type: "score",
        score: 1.18,
        confidence: 0,
        probabilities: { 0: 0.3, 1: 0.22, 2: 0.48 },
        legend: { 0: "unlinked", 1: "review", 2: "aligned" },
      },
    },
  );

  assert.equal(result.mappings.length, 0);
  assert.equal(result.reviews[0].decision, "review");
  assert.equal(result.reviews[0].judgment.outcomeProbability, 0.48);
});

test("an omitted equal residual proposal gets one focused semantic retry", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Övrigt", values: [130, 100] },
    { label: "Revisionsarvoden", values: [90, 80] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Klottersanering", values: [100, 70] },
    { label: "Revisionsarvoden", values: [80, 75] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER", inlineTitle: true })];
  let calls = 0;

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows, _groups, directPairs) => {
      calls += 1;
      const pair = directPairs.find((item) => item.evidence.deterministicEqual);
      assert.ok(pair);
      if (calls === 1) return { mappings: [] };
      assert.equal(newerRows.length, 1);
      assert.equal(olderRows.length, 1);
      return { mappings: [{
        newerIds: [pair.newerId],
        olderIds: [pair.olderId],
        relationship: "direct",
        judgment: { basis: "jev", decision: "aligned", outcomeProbability: 0.9, confidence: 0.8 },
      }] };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.discrepancies.find((item) => item.labelNew === "Övrigt")?.status, "match");
  assert.equal(result.modelReview.batchesAttempted, 2);
});

test("model-assisted split rows are checked arithmetically and grouped", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Serviceavtal", values: [55, 40] },
    { label: "Akuta reparationer", values: [70, 60] },
  ], { title: "NOT 5, REPARATIONER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Reparationer totalt", values: [100, 90] },
  ], { title: "NOT 5, REPARATIONER" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows, proposedGroups) => {
      const proposal = proposedGroups.find((group) =>
        group.newerIds.length === newerRows.length && group.olderIds.length === 1,
      );
      assert.ok(proposal, "the deterministic split proposal is supplied to the model");
      assert.equal(proposal.olderIds[0], olderRows[0].id);
      return { mappings: [proposal] };
    },
  });
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].arithmetic?.expression, "40 + 60 = 100");
  assert.equal(result.discrepancies[0].newerRelated?.length, 1);
  assert.equal(result.modelAssisted, 1);
});

test("model-assisted merged rows also sum multiple prior-report keys", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Reparationer totalt", values: [125, 100] },
  ], { title: "NOT 5, REPARATIONER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Serviceavtal", values: [40, 35] },
    { label: "Akuta reparationer", values: [60, 55] },
  ], { title: "NOT 5, REPARATIONER" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows[0].id],
        olderIds: olderRows.map((row) => row.id),
        relationship: "aggregate",
      }],
    }),
  });
  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].arithmetic?.expression, "100 = 40 + 60");
  assert.equal(result.discrepancies[0].olderRelated?.length, 1);
});

test("model cannot invent an aggregate that was not deterministically proposed", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Samlad kostnad", values: [125, 100] },
  ], { title: "NOT 5, KOSTNADER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Tjänster", values: [60, 55] },
    { label: "Material", values: [30, 25] },
  ], { title: "NOT 5, KOSTNADER" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows, proposedGroups) => {
      assert.equal(proposedGroups.length, 0);
      return {
        mappings: [{
          newerIds: [newerRows[0].id],
          olderIds: olderRows.map((row) => row.id),
          relationship: "aggregate",
        }],
      };
    },
  });

  assert.equal(result.modelAssisted, 0);
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.discrepancies[0].arithmetic, undefined);
});

test("model mappings cannot reuse a row already protected by an exact equal match", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Serviceavtal", values: [130, 100] },
    { label: "Utökad support", values: [80, 60] },
  ], { title: "NOT 5, REPARATIONER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Serviceavtal", values: [100, 90] },
  ], { title: "NOT 5, REPARATIONER" })];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows.find((row) => row.label === "Utökad support")!.id],
        olderIds: [olderRows[0].id],
        relationship: "direct",
      }],
    }),
  });
  assert.equal(result.discrepancies.find((item) => item.labelNew === "Serviceavtal")?.status, "match");
  assert.equal(result.discrepancies.find((item) => item.labelNew === "Utökad support")?.status, "missing");
  assert.equal(result.modelReview.mappingsAccepted, 0);
  assert.equal(result.modelReview.mappingsRejected, 1);
});

test("an unequal model-assisted rename remains gray", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Leverantörstjänster", values: [140, 120] },
  ], { title: "NOT 5, EXTERNA KOSTNADER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Konsultarvoden", values: [100, 90] },
  ], { title: "NOT 5, EXTERNA KOSTNADER" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows[0].id],
        olderIds: [olderRows[0].id],
        relationship: "direct",
      }],
    }),
  });

  assert.equal(result.modelAssisted, 1);
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.discrepancies[0].matchMethod, "model");
  assert.match(result.discrepancies[0].explanation, /unique exact-label deterministic alignment/);
});

test("a model-confirmed exact-label unequal value remains red", async () => {
  const newer = [
    reportPage(0, [2025, 2024], [
      { label: "Summa administrationskostnader", values: [700, 633] },
    ], { title: "NOT 5, ADMINISTRATION" }),
    reportPage(1, [2025, 2024]),
  ];
  const older = [
    reportPage(0, [2024, 2023], [
      { label: "Summa administrationskostnader", values: [632, 590] },
    ], { title: "NOT 5, ADMINISTRATION" }),
    reportPage(1, [2024, 2023]),
  ];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows[0].id],
        olderIds: [olderRows[0].id],
        relationship: "direct",
      }],
    }),
  });

  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].valueNew, "633");
  assert.equal(result.discrepancies[0].valueOld, "632");
});

test("a model rename cannot override a unique exact-label discrepancy", async () => {
  const newer = [reportPage(0, [2025, 2024], [
    { label: "Revisionsarvoden", values: [140, 120] },
  ], { title: "NOT 5, EXTERNA KOSTNADER" })];
  const older = [reportPage(0, [2024, 2023], [
    { label: "Revisionsarvoden", values: [100, 90] },
    { label: "Revisionstjänster", values: [120, 100] },
  ], { title: "NOT 5, EXTERNA KOSTNADER" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => ({
      mappings: [{
        newerIds: [newerRows[0].id],
        olderIds: [olderRows.find((row) => row.label === "Revisionstjänster")!.id],
        relationship: "direct",
      }],
    }),
  });

  assert.equal(result.modelAssisted, 0);
  assert.equal(result.discrepancies[0].status, "mismatch");
  assert.equal(result.discrepancies[0].labelOld, "Revisionsarvoden");
  assert.equal(result.discrepancies[0].matchMethod, "exact");
});

test("deterministic proposals surface a broader key plus folded-in prior rows", async () => {
  const newer = [reportPage(0, [2024, 2023], [
    { label: "Förbrukningsmaterial", values: [18950, 64232] },
    { label: "Personbilskostnader", values: [599, 0] },
    { label: "Övriga förvaltningskostnader", values: [68611, 68908] },
    { label: "Kontorsmaterial", values: [920, 0] },
    { label: "Revisionsarvoden", values: [22500, 33375] },
    { label: "Ekonomisk förvaltning", values: [101652, 97856] },
    { label: "Summa", values: [213232, 264371] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER" })];
  const older = [reportPage(0, [2023, 2022], [
    { label: "Förbrukningsmaterial", values: [64232, 8999] },
    { label: "Övriga förvaltningskostnader", values: [59645, 50099] },
    { label: "Revisionsarvoden", values: [33375, 31000] },
    { label: "Trivselåtgärder", values: [2465, 4200] },
    { label: "Ekonomisk förvaltning", values: [97856, 92624] },
    { label: "Bankkostnader", values: [6798, 6348] },
    { label: "Summa", values: [264371, 193270] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023, {
    resolveLabels: async (_newerRows, olderRows, proposedGroups) => {
      const proposal = proposedGroups.find((group) => group.olderIds.length === 3);
      assert.ok(proposal, "the exact arithmetic group is proposed to the model");
      const labels = proposal.olderIds.map((id) => olderRows.find((row) => row.id === id)?.label);
      assert.deepEqual(labels, [
        "Övriga förvaltningskostnader",
        "Trivselåtgärder",
        "Bankkostnader",
      ]);
      return { mappings: [proposal] };
    },
  });

  const grouped = result.discrepancies.find((item) => item.labelNew === "Övriga förvaltningskostnader");
  assert.equal(grouped?.status, "match");
  assert.equal(grouped?.arithmetic?.expression, "68908 = 59645 + 2465 + 6798");
  assert.equal(grouped?.olderRelated?.length, 2);
});

test("arithmetic proposals reserve their rows beyond the global model-candidate cap", async () => {
  const newer = Array.from({ length: 10 }, (_, page) =>
    reportPage(page, [2024, 2023], page === 9
      ? [{ label: "Övriga förvaltningskostnader", values: [70000, 68908] }]
      : [{ label: `Ny rad ${page}`, values: [90000 + page, 80000 + page] }],
    { title: `NOT ${page + 1}, KOSTNADER` }));
  const older = Array.from({ length: 10 }, (_, page) =>
    reportPage(page, [2023, 2022], page === 9
      ? [
          { label: "Övriga förvaltningskostnader", values: [59645, 50099] },
          { label: "Trivselåtgärder", values: [2465, 4200] },
          { label: "Bankkostnader", values: [6798, 6348] },
        ]
      : Array.from({ length: 18 }, (__, row) => ({
          label: `Äldre rad ${page}-${row}`,
          values: [30000 + page * 100 + row, 20000 + row] as [number, number],
        })),
    { title: `NOT ${page + 1}, KOSTNADER` }));

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023, {
    resolveLabels: async (_newerRows, olderRows, proposedGroups) => {
      const proposal = proposedGroups.find((group) => group.olderIds.length === 3);
      assert.ok(proposal, "the late-page exact arithmetic proposal survives prompt bounding");
      assert.ok(proposal.olderIds.every((id) => olderRows.some((row) => row.id === id)));
      return { mappings: [proposal] };
    },
  });

  const grouped = result.discrepancies.find((item) => item.labelNew === "Övriga förvaltningskostnader");
  assert.equal(grouped?.status, "match");
  assert.equal(grouped?.arithmetic?.expression, "68908 = 59645 + 2465 + 6798");
});

test("an approved aggregate takes precedence over a competing direct anchor mapping", async () => {
  const newer = [reportPage(0, [2024, 2023], [
    { label: "Övriga förvaltningskostnader", values: [68611, 68908] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER" })];
  const older = [reportPage(0, [2023, 2022], [
    { label: "Övriga förvaltningskostnader", values: [59645, 50099] },
    { label: "Trivselåtgärder", values: [2465, 4200] },
    { label: "Bankkostnader", values: [6798, 6348] },
  ], { title: "NOT 9, ÖVRIGA EXTERNA KOSTNADER" })];

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2024, 2023, {
    resolveLabels: async (newerRows, olderRows, proposedGroups) => {
      const proposal = proposedGroups.find((group) => group.olderIds.length === 3);
      assert.ok(proposal);
      return {
        mappings: [
          {
            newerIds: [newerRows[0].id],
            olderIds: [olderRows.find((row) => row.label === "Övriga förvaltningskostnader")!.id],
            relationship: "direct",
          },
          proposal,
        ],
      };
    },
  });

  assert.equal(result.discrepancies[0].status, "match");
  assert.equal(result.discrepancies[0].arithmetic?.expression, "68908 = 59645 + 2465 + 6798");
});

test("semantic and arithmetic review continues beyond the first model batch", async () => {
  const newer = Array.from({ length: 45 }, (_, page) =>
    reportPage(page, [2025, 2024], [{
      label: `Rad ${page}`,
      values: [12000 + page, page === 44 ? 100 : 10000 + page],
    }], { title: `NOT ${page + 1}, KOSTNADER` }));
  const older = Array.from({ length: 45 }, (_, page) =>
    reportPage(page, [2024, 2023], page === 44
      ? [
          { label: "Rad 44", values: [40, 30] },
          { label: "Tillkommande avgift", values: [20, 10] },
          { label: "Bankkostnader", values: [40, 20] },
        ]
      : [{ label: `Rad ${page}`, values: [30000 + page, 20000 + page] }],
    { title: `NOT ${page + 1}, KOSTNADER` }));
  let calls = 0;

  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (_newerRows, _olderRows, proposedGroups) => {
      calls += 1;
      const lastPageGroup = proposedGroups.find((group) => group.olderIds.length === 3);
      return { mappings: lastPageGroup ? [lastPageGroup] : [] };
    },
  });

  assert.equal(calls, 4);
  const grouped = result.discrepancies.find((item) => item.labelNew === "Rad 44");
  assert.equal(grouped?.status, "match");
  assert.equal(grouped?.arithmetic?.expression, "100 = 40 + 20 + 40");
  assert.equal(result.modelReview.batchesAttempted, 4);
  assert.equal(result.modelReview.batchesFailed, 0);
});

test("a failed semantic batch is observable and leaves deterministic analysis usable", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nytt namn", values: [130, 100] }])];
  const older = [reportPage(0, [2024, 2023], [{ label: "Gammalt namn", values: [100, 80] }])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(result.discrepancies[0].status, "missing");
  assert.equal(result.modelReview.batchesAttempted, 1);
  assert.equal(result.modelReview.batchesFailed, 1);
});
