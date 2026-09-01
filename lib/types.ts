export type Rect = [number, number, number, number];

export type PdfToken = {
  id: string;
  page: number;
  text: string;
  rect: Rect;
  fontSize: number;
  isNumber: boolean;
  lineId: string;
};

export type PdfLine = {
  id: string;
  page: number;
  text: string;
  rect: Rect;
  tokens: PdfToken[];
};

export type ExtractedPage = {
  page: number;
  bounds: Rect;
  text: string;
  tokens: PdfToken[];
  lines: PdfLine[];
};

export type RenderedPage = {
  url: string;
  width: number;
  height: number;
  bounds: Rect;
  tokens: PdfToken[];
};

export type ScrambleChange = {
  id: string;
  page: number;
  rect: Rect;
  original: string;
  replacement: string;
  fontSize: number;
  align: "left" | "right";
};

export type ReportFile = {
  year: number;
  language: "sv" | "en";
  url: string;
  filename: string;
};

export type ReportPair = {
  id: string;
  company: string;
  ticker: string;
  market: string;
  accent: string;
  latest: ReportFile;
  previous: ReportFile;
  sourceUrl: string;
};

export type DiscrepancyStatus = "match" | "mismatch" | "missing";

export type Discrepancy = {
  id: string;
  status: DiscrepancyStatus;
  year: number;
  section: string;
  labelNew: string;
  labelOld?: string;
  valueNew: string;
  valueOld?: string;
  matchMethod: "exact" | "similar" | "model" | "none";
  explanation: string;
  newer: { page: number; rect: Rect; tokenId: string; keyRect?: Rect; yearRect?: Rect };
  older?: { page: number; rect: Rect; tokenId: string; keyRect?: Rect; yearRect?: Rect };
};

export type NumberHighlight = { page: number; rect: Rect; tokenId: string };

export type SectionJump = {
  id: string;
  title: string;
  newerPage: number;
  olderPage: number;
  count: number;
};

export type AnalysisResult = {
  discrepancies: Discrepancy[];
  numberHighlights: { newer: NumberHighlight[]; older: NumberHighlight[] };
  sections: SectionJump[];
  newerYear: number;
  olderYear: number;
  comparedCells: number;
  modelAssisted: number;
};

export type ModelProvider = "openai" | "anthropic";

export type ModelUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type ModelCall = {
  id: string;
  provider: ModelProvider;
  model: string;
  purpose: "connection" | "synonym" | "match-labels";
  createdAt: string;
  status: "pending" | "success" | "error";
  request: unknown;
  response?: unknown;
  parsed?: unknown;
  usage?: ModelUsage;
  latencyMs?: number;
  error?: string;
};
