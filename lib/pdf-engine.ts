import type {
  ExtractedPage,
  PdfLine,
  PdfToken,
  Rect,
  RenderedPage,
  ScrambleChange,
} from "./types";

type MuPdfModule = (typeof import("mupdf"))["default"];

let mupdfPromise: Promise<MuPdfModule> | null = null;

async function getMuPdf() {
  if (!mupdfPromise) mupdfPromise = import("mupdf").then((module) => module.default);
  return mupdfPromise;
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return [...b] as Rect;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function quadRect(quad: number[]): Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function isNumberText(text: string) {
  const clean = text.trim().replace(/[−–—]/g, "-");
  if (!/[\d)%]$/.test(clean)) return false;
  return /^-?\(?\d[\d\s\u00a0\u202f.,:'’%]*\)?$/.test(clean);
}

export function parseSwedishNumber(text: string): number | null {
  let clean = text
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/[\s\u00a0\u202f']/g, "")
    .replace(/%$/, "");
  const negativeParentheses = /^\(.*\)$/.test(clean);
  clean = clean.replace(/[()]/g, "");
  if (/^-?\d{1,3}(,\d{3})+$/.test(clean)) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    clean = clean.replace(/\./g, "");
  }
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  return negativeParentheses ? -Math.abs(value) : value;
}

function mergeNumberFragments(tokens: PdfToken[]): PdfToken[] {
  const merged: PdfToken[] = [];
  for (const token of tokens) {
    const previous = merged.at(-1);
    if (previous) {
      const gap = token.rect[0] - previous.rect[2];
      const joined = `${previous.text} ${token.text}`;
      if (
        previous.isNumber &&
        isNumberText(token.text) &&
        isNumberText(joined) &&
        gap >= -0.5 &&
        gap <= Math.max(previous.fontSize, token.fontSize) * 0.85
      ) {
        previous.text = joined;
        previous.rect = unionRect(previous.rect, token.rect);
        previous.isNumber = true;
        continue;
      }
    }
    merged.push({ ...token });
  }
  return merged;
}

export function mergeTextFragments(tokens: PdfToken[]): PdfToken[] {
  const merged: PdfToken[] = [];
  for (const token of tokens) {
    const previous = merged.at(-1);
    const gap = previous ? token.rect[0] - previous.rect[2] : Infinity;
    if (
      previous &&
      !previous.isNumber &&
      !token.isNumber &&
      // Some PDFs encode kerning as whitespace between overlapping glyph runs.
      // Join only touching runs: ordinary word spacing in these reports is ~2pt.
      gap <= 0.5
    ) {
      previous.text += token.text;
      previous.rect = unionRect(previous.rect, token.rect);
      previous.fontSize = Math.max(previous.fontSize, token.fontSize);
      continue;
    }
    merged.push({ ...token });
  }
  return merged;
}

function clusterVisualRows(rawLines: PdfLine[], pageIndex: number): PdfLine[] {
  const groups: Array<{ center: number; lines: PdfLine[] }> = [];
  const sorted = [...rawLines].sort(
    (a, b) => (a.rect[1] + a.rect[3]) / 2 - (b.rect[1] + b.rect[3]) / 2 || a.rect[0] - b.rect[0],
  );
  for (const line of sorted) {
    const center = (line.rect[1] + line.rect[3]) / 2;
    const group = groups.find((candidate) => Math.abs(candidate.center - center) <= 2.6);
    if (group) {
      group.lines.push(line);
      group.center = group.lines.reduce((sum, item) => sum + (item.rect[1] + item.rect[3]) / 2, 0) / group.lines.length;
    } else {
      groups.push({ center, lines: [line] });
    }
  }
  return groups.map((group, index) => {
    const tokens = mergeTextFragments(
      group.lines.flatMap((line) => line.tokens).sort((a, b) => a.rect[0] - b.rect[0]),
    );
    const id = `p${pageIndex}-r${index}`;
    for (const token of tokens) token.lineId = id;
    return {
      id,
      page: pageIndex,
      text: tokens.map((token) => token.text).join(" "),
      rect: group.lines.reduce<Rect | null>((rect, line) => unionRect(rect, line.rect), null) as Rect,
      tokens,
    };
  });
}

export class BrowserPdf {
  readonly name: string;
  readonly sourceBytes: Uint8Array;
  readonly pageCount: number;
  readonly changes: ScrambleChange[] = [];
  private mupdf: MuPdfModule;
  private document: import("mupdf").PDFDocument;
  private pageCache = new Map<number, ExtractedPage>();

  private constructor(
    name: string,
    sourceBytes: Uint8Array,
    mupdf: MuPdfModule,
    document: import("mupdf").PDFDocument,
  ) {
    this.name = name;
    this.sourceBytes = sourceBytes;
    this.mupdf = mupdf;
    this.document = document;
    this.pageCount = document.countPages();
  }

  static async load(bytes: ArrayBuffer | Uint8Array, name: string) {
    const mupdf = await getMuPdf();
    const sourceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const document = new mupdf.PDFDocument(sourceBytes);
    return new BrowserPdf(name, sourceBytes, mupdf, document);
  }

  async extractPage(pageIndex: number): Promise<ExtractedPage> {
    const cached = this.pageCache.get(pageIndex);
    if (cached) return cached;
    const page = this.document.loadPage(pageIndex);
    const bounds = page.getBounds() as Rect;
    const structured = page.toStructuredText("preserve-whitespace,preserve-spans");
    const rawLines: PdfLine[] = [];
    let currentLine: PdfLine | null = null;
    let currentToken: PdfToken | null = null;
    let tokenCounter = 0;

    const flushToken = () => {
      if (!currentLine || !currentToken) return;
      currentToken.text = currentToken.text.trim();
      if (currentToken.text) {
        currentToken.isNumber = isNumberText(currentToken.text);
        currentLine.tokens.push(currentToken);
      }
      currentToken = null;
    };

    structured.walk({
      beginLine: (lineRect: Rect) => {
        currentLine = {
          id: `p${pageIndex}-l${rawLines.length}`,
          page: pageIndex,
          text: "",
          rect: lineRect,
          tokens: [],
        };
      },
      onChar: (character: string, _origin: number[], _font: unknown, size: number, quad: number[]) => {
        if (!currentLine) return;
        currentLine.text += character;
        if (/\s/.test(character)) {
          flushToken();
          return;
        }
        const rect = quadRect(quad);
        if (!currentToken) {
          currentToken = {
            id: `p${pageIndex}-t${tokenCounter++}`,
            page: pageIndex,
            text: character,
            rect,
            fontSize: size,
            isNumber: false,
            lineId: currentLine.id,
          };
        } else {
          currentToken.text += character;
          currentToken.rect = unionRect(currentToken.rect, rect);
          currentToken.fontSize = Math.max(currentToken.fontSize, size);
        }
      },
      endLine: () => {
        flushToken();
        if (currentLine) {
          currentLine.tokens = mergeNumberFragments(currentLine.tokens);
          if (currentLine.text.trim()) rawLines.push(currentLine);
        }
        currentLine = null;
      },
    });

    const lines = clusterVisualRows(rawLines, pageIndex);
    const tokens = lines.flatMap((line) => line.tokens);
    const extracted: ExtractedPage = {
      page: pageIndex,
      bounds,
      text: structured.asText(),
      tokens,
      lines,
    };
    structured.destroy();
    page.destroy();
    this.pageCache.set(pageIndex, extracted);
    return extracted;
  }

  async renderPage(pageIndex: number, scale = 1.55): Promise<RenderedPage> {
    const extracted = await this.extractPage(pageIndex);
    const page = this.document.loadPage(pageIndex);
    const pixmap = page.toPixmap(
      this.mupdf.Matrix.scale(scale, scale),
      this.mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const png = pixmap.asPNG();
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
    const width = Math.round((extracted.bounds[2] - extracted.bounds[0]) * scale);
    const height = Math.round((extracted.bounds[3] - extracted.bounds[1]) * scale);
    pixmap.destroy();
    page.destroy();
    return { url, width, height, bounds: extracted.bounds, tokens: extracted.tokens };
  }

  async extractAll(onProgress?: (progress: number) => void) {
    const pages: ExtractedPage[] = [];
    for (let page = 0; page < this.pageCount; page += 1) {
      pages.push(await this.extractPage(page));
      onProgress?.((page + 1) / this.pageCount);
      if (page % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return pages;
  }

  async applyChange(change: ScrambleChange) {
    const existingIndex = this.changes.findIndex((item) => item.id === change.id);
    if (existingIndex >= 0) this.changes[existingIndex] = change;
    else this.changes.push(change);
    await this.rebuild();
  }

  async removeChange(id: string) {
    const index = this.changes.findIndex((change) => change.id === id);
    if (index >= 0) this.changes.splice(index, 1);
    await this.rebuild();
  }

  async resetChanges() {
    this.changes.splice(0, this.changes.length);
    await this.rebuild();
  }

  private async rebuild() {
    this.document.destroy();
    this.document = new this.mupdf.PDFDocument(this.sourceBytes);
    this.pageCache.clear();

    for (const change of this.changes) {
      const page = this.document.loadPage(change.page);
      const redaction = page.createAnnotation("Redact");
      redaction.setRect([
        change.rect[0] - 0.6,
        change.rect[1] - 0.3,
        change.rect[2] + 0.6,
        change.rect[3] + 0.3,
      ]);
      page.applyRedactions(
        false,
        this.mupdf.PDFPage.REDACT_IMAGE_NONE,
        this.mupdf.PDFPage.REDACT_LINE_ART_NONE,
        this.mupdf.PDFPage.REDACT_TEXT_REMOVE,
      );

      const annotation = page.createAnnotation("FreeText");
      const height = Math.max(change.rect[3] - change.rect[1], change.fontSize * 1.2);
      annotation.setRect([
        change.rect[0] - 0.5,
        change.rect[1] - 0.5,
        change.rect[2] + Math.max(2, change.fontSize * 0.35),
        change.rect[1] + height + 1,
      ]);
      annotation.setContents(change.replacement);
      annotation.setDefaultAppearance("Helv", Math.max(4, change.fontSize * 0.9), [0, 0, 0]);
      annotation.setBorderWidth(0);
      annotation.setQuadding(change.align === "right" ? 2 : 0);
      annotation.setFlags(this.mupdf.PDFAnnotation.IS_PRINT);
      annotation.update();
      page.update();
      page.destroy();
    }
  }

  exportBytes() {
    const exportDocument = new this.mupdf.PDFDocument(this.document);
    exportDocument.bake(true, false);
    const buffer = exportDocument.saveToBuffer("garbage=4,compress=yes,compress-images=yes");
    const output = new Uint8Array(buffer.asUint8Array());
    buffer.destroy();
    exportDocument.destroy();
    return output;
  }

  downloadBytes() {
    // Preserve the exact input bytes until the user has intentionally made a
    // change. Re-serializing an untouched PDF is not an "original" download.
    return this.changes.length ? this.exportBytes() : new Uint8Array(this.sourceBytes);
  }

  destroy() {
    this.document.destroy();
    this.pageCache.clear();
  }
}

export async function fetchCataloguePdf(url: string, filename: string) {
  const response = await fetch(`/api/pdf?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not load ${filename}`);
  }
  return BrowserPdf.load(await response.arrayBuffer(), filename);
}

export async function detectReportYear(pdf: BrowserPdf) {
  const fromName = pdf.name.match(/(?:19|20)\d{2}/g)?.map(Number) || [];
  const counts = new Map<number, number>();
  for (const year of fromName) counts.set(year, (counts.get(year) || 0) + 6);
  const pages = Math.min(pdf.pageCount, 8);
  for (let page = 0; page < pages; page += 1) {
    const text = (await pdf.extractPage(page)).text;
    for (const value of text.match(/(?:19|20)\d{2}/g) || []) {
      const year = Number(value);
      counts.set(year, (counts.get(year) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || null;
}

export function alterNumber(value: string) {
  const parsed = parseSwedishNumber(value);
  if (parsed === null) return value;
  const magnitude = Math.max(Math.abs(parsed) * 0.0125, Number.isInteger(parsed) ? 1 : 0.01);
  const direction = Math.abs(Math.round(parsed)) % 2 === 0 ? 1 : -1;
  const changed = parsed + direction * magnitude;
  const hasComma = value.includes(",");
  const decimals = hasComma ? value.split(",")[1]?.replace(/\D/g, "").length || 0 : 0;
  const formatted = changed.toLocaleString("sv-SE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: /[\s\u00a0\u202f]/.test(value),
  });
  if (/^\(.*\)$/.test(value) && changed < 0) return `(${formatted.replace("−", "")})`;
  return formatted;
}
