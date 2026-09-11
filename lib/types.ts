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
  /** Thin horizontal vector rules from the same PDF page content stream. */
  horizontalRules?: Rect[];
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

export type ReviewReason =
  | "exact-equal"
  | "damaged-text-equal"
  | "structural-equal"
  | "model-equal"
  | "aggregate-equal"
  | "exact-unequal"
  | "ambiguous-counterpart"
  | "counterpart-reused"
  | "weak-counterpart"
  | "model-unequal"
  | "no-counterpart";

export type ComparisonEvidence = {
  reason: ReviewReason;
  verdict: "verified" | "discrepancy" | "review";
  labelAlignment: "exact" | "damaged-text" | "structural" | "semantic" | "weak" | "none";
  contextAlignment: "same-table" | "compatible" | "weak" | "none";
  uniqueCounterpart: boolean;
  candidateCount: number;
  deterministic: true;
  normalizedNewer: number;
  normalizedOlder?: number;
  modelRole: "none" | "rename" | "arithmetic-coherence";
  modelReason?: string;
};

export type EvidenceTarget = {
  page: number;
  rect: Rect;
  tokenId: string;
  keyRect?: Rect;
  yearRect?: Rect;
};

export type ArithmeticCheck = {
  expression: string;
  newerTerms: Array<{ label: string; value: string }>;
  olderTerms: Array<{ label: string; value: string }>;
};

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
  newer: EvidenceTarget;
  older?: EvidenceTarget;
  newerRelated?: EvidenceTarget[];
  olderRelated?: EvidenceTarget[];
  arithmetic?: ArithmeticCheck;
  evidence: ComparisonEvidence;
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
  coverage: {
    newerExtractedCells: number;
    olderExtractedCells: number;
    overlappingYearCells: number;
    verifiedCells: number;
    reviewCells: number;
    discrepancyCells: number;
  };
  modelReview: {
    enabled: boolean;
    batchesAttempted: number;
    batchesFailed: number;
    mappingsAccepted: number;
    mappingsRejected: number;
  };
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
