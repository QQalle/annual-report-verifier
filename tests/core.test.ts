import assert from "node:assert/strict";
import test from "node:test";
import { analyzePair } from "../lib/compare.ts";
import type { BrowserPdf } from "../lib/pdf-engine.ts";
import { alterNumber, isNumberText, parseSwedishNumber } from "../lib/pdf-engine.ts";
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
  years: [number, number],
  rows: Array<{ label: string; values: [number, number] }> = [],
): ExtractedPage {
  const headerId = `p${page}-header`;
  const headerTokens = [
    token(`${headerId}-y0`, page, String(years[0]), [300, 50, 320, 62], true, headerId),
    token(`${headerId}-y1`, page, String(years[1]), [400, 50, 420, 62], true, headerId),
  ];
  const lines: PdfLine[] = [
    { id: headerId, page, text: `${years[0]} ${years[1]}`, rect: [300, 50, 420, 62], tokens: headerTokens },
  ];
  rows.forEach((row, index) => {
    const lineId = `p${page}-row${index}`;
    const y = 100 + index * 24;
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

function mockPdf(pages: ExtractedPage[]) {
  return {
    extractAll: async (onProgress?: (progress: number) => void) => {
      onProgress?.(1);
      return pages;
    },
  } as unknown as BrowserPdf;
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

test("recognizes complete numeric tokens only", () => {
  assert.equal(isNumberText("6 104"), true);
  assert.equal(isNumberText("2,28"), true);
  assert.equal(isNumberText("123,"), false);
  assert.equal(isNumberText("2024 report"), false);
});

test("scrambled numbers stay numeric and change", () => {
  const replacement = alterNumber("6 104");
  assert.notEqual(replacement, "6 104");
  assert.notEqual(parseSwedishNumber(replacement), null);
});

test("equal repeated rows are matched green instead of aligning to a nearer unequal row", async () => {
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

test("a unique exact row with unequal values is a discrepancy", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 101] }])];
  const older = [reportPage(0, [2024, 2023], [{ label: "Nettoomsättning", values: [100, 80] }])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024);
  assert.equal(result.discrepancies[0].status, "mismatch");
});

test("model-assisted renamed rows use occurrence IDs and structural context", async () => {
  const newer = [reportPage(0, [2025, 2024], [{ label: "Nettoomsättning", values: [130, 100] }])];
  const older = [reportPage(0, [2024, 2023], [{ label: "Rörelsens intäkter", values: [100, 80] }])];
  const result = await analyzePair(mockPdf(newer), mockPdf(older), 2025, 2024, {
    resolveLabels: async (newerRows, olderRows) => {
      assert.equal(newerRows[0].year, 2024);
      assert.equal(newerRows[0].section, "Financial tables");
      assert.equal(olderRows[0].page, 1);
      return {
        mappings: [
          {
            newerId: newerRows[0].id,
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
