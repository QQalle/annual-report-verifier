"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Link2,
  LoaderCircle,
  ScanSearch,
  UploadCloud,
  Unlink2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModel } from "@/lib/model-context";
import { analyzePair } from "@/lib/compare";
import { BrowserPdf, detectReportYear } from "@/lib/pdf-engine";
import type { AnalysisResult, Discrepancy, EvidenceTarget } from "@/lib/types";
import { PdfViewer } from "./PdfViewer";

type Side = "newer" | "older";

function DropCard({
  side,
  busy,
  onFile,
}: {
  side: Side;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file?: File) => {
    if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) onFile(file);
  };

  return (
    <button
      className={`drop-card ${dragging ? "dragging" : ""}`}
      type="button"
      onClick={() => input.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files[0]);
      }}
      disabled={busy}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => accept(event.target.files?.[0])}
      />
      <span className="drop-icon">
        {busy ? <LoaderCircle size={22} className="spin" /> : <UploadCloud size={22} />}
      </span>
      <strong>{busy ? "Reading PDF…" : `Drop the ${side === "newer" ? "newer" : "prior"} report`}</strong>
      <span>or click to choose a PDF</span>
      <small>Text-layer PDFs · processed locally</small>
    </button>
  );
}

function YearControl({ year, onChange }: { year: number | null; onChange: (year: number) => void }) {
  return (
    <label className="year-control">
      <span>Report year</span>
      <input
        type="number"
        min="1990"
        max="2100"
        value={year || ""}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Report year"
      />
    </label>
  );
}

export function AnalyzeWorkspace() {
  const [newerPdf, setNewerPdf] = useState<BrowserPdf | null>(null);
  const [olderPdf, setOlderPdf] = useState<BrowserPdf | null>(null);
  const [newerYear, setNewerYear] = useState<number | null>(null);
  const [olderYear, setOlderYear] = useState<number | null>(null);
  const [newerPage, setNewerPage] = useState(0);
  const [olderPage, setOlderPage] = useState(0);
  const [loadingSide, setLoadingSide] = useState<Side | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hoveredHighlight, setHoveredHighlight] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueMode, setIssueMode] = useState<"mismatch" | "all">("mismatch");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncRequest, setSyncRequest] = useState<{
    id: number;
    targetSide: Side;
    progress: number;
  } | null>(null);
  const [focusRequests, setFocusRequests] = useState<Record<Side, { id: number; target: EvidenceTarget } | null>>({
    newer: null,
    older: null,
  });
  const { isConfigured, callModel, provider } = useModel();
  const newerRef = useRef<BrowserPdf | null>(null);
  const olderRef = useRef<BrowserPdf | null>(null);
  const interactionId = useRef(0);

  useEffect(() => () => {
    newerRef.current?.destroy();
    olderRef.current?.destroy();
  }, []);

  const loadFile = async (side: Side, file: File) => {
    setLoadingSide(side);
    setError(null);
    setAnalysis(null);
    try {
      const pdf = await BrowserPdf.load(await file.arrayBuffer(), file.name);
      const year = await detectReportYear(pdf);
      if (side === "newer") {
        newerRef.current?.destroy();
        newerRef.current = pdf;
        setNewerPdf(pdf);
        setNewerYear(year);
        setNewerPage(0);
      } else {
        olderRef.current?.destroy();
        olderRef.current = pdf;
        setOlderPdf(pdf);
        setOlderYear(year);
        setOlderPage(0);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the PDF");
    } finally {
      setLoadingSide(null);
    }
  };

  const clearSide = (side: Side) => {
    if (side === "newer") {
      newerRef.current?.destroy();
      newerRef.current = null;
      setNewerPdf(null);
      setNewerYear(null);
    } else {
      olderRef.current?.destroy();
      olderRef.current = null;
      setOlderPdf(null);
      setOlderYear(null);
    }
    setAnalysis(null);
  };

  const yearError =
    newerYear && olderYear && newerYear - olderYear !== 1
      ? "Reports must cover adjacent years, with the newer report on the left."
      : null;

  const focusDiscrepancy = (
    item: Discrepancy,
    clicked?: { side: Side; target: EvidenceTarget },
  ) => {
    setSelectedIssueId(item.id);
    setSyncEnabled(true);
    const newerTarget = clicked?.side === "newer" ? clicked.target : item.newer;
    const olderTarget = clicked?.side === "older" ? clicked.target : item.older;
    setNewerPage(newerTarget.page);
    if (olderTarget) setOlderPage(olderTarget.page);
    const id = ++interactionId.current;
    setFocusRequests({
      newer: { id, target: newerTarget },
      older: olderTarget ? { id, target: olderTarget } : null,
    });
  };

  const syncViewport = (source: Side, position: { progress: number }) => {
    if (!syncEnabled) return;
    setSyncRequest({
      id: ++interactionId.current,
      targetSide: source === "newer" ? "older" : "newer",
      progress: position.progress,
    });
  };

  const runAnalysis = async () => {
    if (!newerPdf || !olderPdf || !newerYear || !olderYear || yearError) return;
    setAnalyzing(true);
    setProgress(0);
    setError(null);
    setAnalysis(null);
    try {
      const result = await analyzePair(newerPdf, olderPdf, newerYear, olderYear, {
        onProgress: (value, label) => {
          setProgress(value);
          setProgressLabel(label);
        },
        resolveLabels: isConfigured
          ? (newerRows, olderRows, proposedGroups) =>
              callModel("match-labels", { newerRows, olderRows, proposedGroups }) as Promise<{
                mappings: Array<{
                  newerIds: string[];
                  olderIds: string[];
                  relationship: "direct" | "aggregate" | "none";
                }>;
              }>
          : undefined,
      });
      setAnalysis(result);
      const firstIssue = result.discrepancies.find((item) => item.status === "mismatch") || result.discrepancies[0];
      if (firstIssue) {
        setIssueMode(result.discrepancies.some((item) => item.status === "mismatch") ? "mismatch" : "all");
        focusDiscrepancy(firstIssue);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const counts = analysis
    ? analysis.discrepancies.reduce(
        (sum, item) => ({ ...sum, [item.status]: sum[item.status] + 1 }),
        { match: 0, mismatch: 0, missing: 0 },
      )
    : { match: 0, mismatch: 0, missing: 0 };

  const issueList = useMemo(
    () =>
      analysis?.discrepancies.filter((item) =>
        issueMode === "mismatch" ? item.status === "mismatch" : item.status !== "match",
      ) || [],
    [analysis, issueMode],
  );
  const selectedIssueIndex = Math.max(0, issueList.findIndex((item) => item.id === selectedIssueId));
  const selectedIssue = issueList[selectedIssueIndex];
  const activeHighlight = hoveredHighlight || selectedIssueId;

  const stepIssue = (offset: number) => {
    if (!issueList.length) return;
    const next = (selectedIssueIndex + offset + issueList.length) % issueList.length;
    focusDiscrepancy(issueList[next]);
  };

  return (
    <div className="analyze-page">
      <header className="analyze-heading">
        <div>
          <span className="eyebrow">Adjacent-year verification</span>
          <h1>Analyze annual reports</h1>
          <p>Compare prior-year figures against what the previous report actually stated.</p>
        </div>
        <div className="analyze-actions">
          <button
            className={`button secondary sync-toggle ${syncEnabled ? "active" : ""}`}
            type="button"
            onClick={() => setSyncEnabled((enabled) => !enabled)}
            disabled={!newerPdf || !olderPdf}
            aria-pressed={syncEnabled}
            title={syncEnabled ? "Stop synchronizing PDF scrolling" : "Synchronize PDF scrolling"}
          >
            {syncEnabled ? <Link2 size={14} /> : <Unlink2 size={14} />}
            {syncEnabled ? "Synced" : "Sync"}
          </button>
          <button
            className="button primary analyze-button"
            type="button"
            onClick={runAnalysis}
            disabled={!newerPdf || !olderPdf || !newerYear || !olderYear || Boolean(yearError) || analyzing}
          >
            {analyzing ? <LoaderCircle size={15} className="spin" /> : <ScanSearch size={15} />}
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </header>

      {(yearError || error) && (
        <div className="analysis-alert">
          <AlertTriangle size={15} />
          <span>{yearError || error}</span>
        </div>
      )}

      {analyzing && (
        <div className="analysis-progress">
          <div className="progress-copy"><span>{progressLabel}</span><strong>{Math.round(progress * 100)}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}

      {analysis && (
        <div className="analysis-summary">
          <div className="result-counts">
            <span className="result-stat match"><CheckCircle2 size={14} /><strong>{counts.match}</strong> match</span>
            <span className="result-stat mismatch"><AlertTriangle size={14} /><strong>{counts.mismatch}</strong> discrepancies</span>
            <span className="result-stat missing"><CircleDashed size={14} /><strong>{counts.missing}</strong> no counterpart</span>
          </div>
          <div className="discrepancy-navigator">
            <button
              className={`issue-mode ${issueMode === "mismatch" ? "active" : ""}`}
              type="button"
              onClick={() => setIssueMode("mismatch")}
              disabled={!counts.mismatch}
            >
              Red only
            </button>
            <button
              className={`issue-mode ${issueMode === "all" ? "active" : ""}`}
              type="button"
              onClick={() => setIssueMode("all")}
            >
              Red + gray
            </button>
            <button className="icon-button" type="button" onClick={() => stepIssue(-1)} disabled={!issueList.length} aria-label="Previous discrepancy">
              <ChevronLeft size={14} />
            </button>
            <button
              className="issue-position"
              type="button"
              onClick={() => selectedIssue && focusDiscrepancy(selectedIssue)}
              disabled={!selectedIssue}
              title={selectedIssue?.labelNew}
            >
              {issueList.length ? `${selectedIssueIndex + 1} / ${issueList.length}` : "0 / 0"}
            </button>
            <button className="icon-button" type="button" onClick={() => stepIssue(1)} disabled={!issueList.length} aria-label="Next discrepancy">
              <ChevronRight size={14} />
            </button>
          </div>
          <span className="analysis-method">
            {analysis.comparedCells} cells · {analysis.modelAssisted} model-assisted
          </span>
        </div>
      )}

      {analysis?.sections.length ? (
        <nav className="section-jumps" aria-label="Comparable report sections">
          <span>Jump to</span>
          {analysis.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                setNewerPage(section.newerPage);
                setOlderPage(section.olderPage);
              }}
            >
              {section.title}
              <small>{section.count}</small>
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
      ) : null}

      <div className="analysis-viewers">
        <div className="analysis-slot">
          {!newerPdf ? (
            <DropCard side="newer" busy={loadingSide === "newer"} onFile={(file) => loadFile("newer", file)} />
          ) : (
            <>
              <div className="slot-meta">
                <YearControl year={newerYear} onChange={setNewerYear} />
                <button className="quiet-button" type="button" onClick={() => clearSide("newer")}><X size={13} /> Replace</button>
              </div>
              <PdfViewer
                pdf={newerPdf}
                title="Newer report"
                subtitle={newerPdf.name}
                page={newerPage}
                onPageChange={setNewerPage}
                highlights={analysis?.discrepancies}
                numberHighlights={analysis?.numberHighlights.newer}
                highlightSide="newer"
                activeHighlight={activeHighlight}
                onHighlight={setHoveredHighlight}
                onHighlightActivate={(item, target) => focusDiscrepancy(item, { side: "newer", target })}
                focusRequest={focusRequests.newer}
                syncRequest={syncRequest?.targetSide === "newer" ? syncRequest : null}
                onViewportChange={(position) => syncViewport("newer", position)}
              />
            </>
          )}
        </div>
        <div className="analysis-slot">
          {!olderPdf ? (
            <DropCard side="older" busy={loadingSide === "older"} onFile={(file) => loadFile("older", file)} />
          ) : (
            <>
              <div className="slot-meta">
                <YearControl year={olderYear} onChange={setOlderYear} />
                <button className="quiet-button" type="button" onClick={() => clearSide("older")}><X size={13} /> Replace</button>
              </div>
              <PdfViewer
                pdf={olderPdf}
                title="Prior report"
                subtitle={olderPdf.name}
                page={olderPage}
                onPageChange={setOlderPage}
                highlights={analysis?.discrepancies}
                numberHighlights={analysis?.numberHighlights.older}
                highlightSide="older"
                activeHighlight={activeHighlight}
                onHighlight={setHoveredHighlight}
                onHighlightActivate={(item, target) => focusDiscrepancy(item, { side: "older", target })}
                focusRequest={focusRequests.older}
                syncRequest={syncRequest?.targetSide === "older" ? syncRequest : null}
                onViewportChange={(position) => syncViewport("older", position)}
              />
            </>
          )}
        </div>
      </div>

      {!isConfigured && newerPdf && olderPdf && !analysis && (
        <p className="claude-hint">
          Deterministic analysis is ready. Add an {provider === "openai" ? "OpenAI" : "Anthropic"} key to resolve renamed note rows.
        </p>
      )}
    </div>
  );
}
