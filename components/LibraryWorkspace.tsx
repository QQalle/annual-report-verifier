"use client";

import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  FilePenLine,
  LoaderCircle,
  RotateCcw,
  Search,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { reportPairs } from "@/lib/catalog";
import { useModel } from "@/lib/model-context";
import { alterNumber, BrowserPdf, fetchCataloguePdf } from "@/lib/pdf-engine";
import type { PdfToken, ReportPair, ScrambleChange } from "@/lib/types";
import { PdfViewer } from "./PdfViewer";

type LoadedPair = { latest: BrowserPdf | null; previous: BrowserPdf | null };
type SelectedToken = { side: "latest" | "previous"; token: PdfToken };
type Side = SelectedToken["side"];
type SideState<T> = Record<Side, T>;

function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DownloadButton({ pdf, label }: { pdf: BrowserPdf | null; label: string }) {
  return (
    <button
      className="quiet-button"
      type="button"
      disabled={!pdf}
      onClick={() => pdf && download(pdf.exportBytes(), pdf.changes.length ? pdf.name.replace(/\.pdf$/i, "-scrambled.pdf") : pdf.name)}
      title={`Download ${label}`}
    >
      <ArrowDownToLine size={14} />
      Download
    </button>
  );
}

function PdfPicker({
  side,
  busy,
  compact = false,
  error,
  onFile,
}: {
  side: Side;
  busy: boolean;
  compact?: boolean;
  error?: string | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const label = side === "latest" ? "newer" : "prior";

  const accept = (file?: File) => {
    if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) onFile(file);
  };

  if (compact) {
    return (
      <button className="quiet-button" type="button" onClick={() => input.current?.click()} disabled={busy}>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => accept(event.target.files?.[0])}
        />
        {busy ? <LoaderCircle size={14} className="spin" /> : <UploadCloud size={14} />}
        Replace
      </button>
    );
  }

  return (
    <button
      className={`drop-card library-drop-card ${dragging ? "dragging" : ""}`}
      data-testid={`local-${side}-upload`}
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
      <strong>{busy ? "Opening PDF…" : `Drop the ${label} report`}</strong>
      <span>or click to choose a PDF</span>
      <small className={error ? "picker-error" : undefined}>
        {error || "Kept in this browser · not uploaded"}
      </small>
    </button>
  );
}

export function LibraryWorkspace() {
  const [query, setQuery] = useState("");
  const [selectedPair, setSelectedPair] = useState<ReportPair | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [documents, setDocuments] = useState<LoadedPair>({ latest: null, previous: null });
  const [loading, setLoading] = useState<SideState<boolean>>({ latest: false, previous: false });
  const [loadErrors, setLoadErrors] = useState<SideState<string | null>>({ latest: null, previous: null });
  const [latestPage, setLatestPage] = useState(0);
  const [previousPage, setPreviousPage] = useState(0);
  const [scrambleMode, setScrambleMode] = useState(false);
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);
  const [replacement, setReplacement] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [latestRevision, setLatestRevision] = useState(0);
  const [previousRevision, setPreviousRevision] = useState(0);
  const { isConfigured, callModel, provider } = useModel();
  const documentsRef = useRef<LoadedPair>({ latest: null, previous: null });

  useEffect(() => () => {
    documentsRef.current.latest?.destroy();
    documentsRef.current.previous?.destroy();
  }, []);

  const filteredPairs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("sv-SE");
    if (!normalized) return reportPairs;
    return reportPairs.filter((pair) =>
      `${pair.company} ${pair.ticker} ${pair.latest.year} ${pair.previous.year}`
        .toLocaleLowerCase("sv-SE")
        .includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    if (!selectedPair || customMode) return;
    let cancelled = false;
    // Pair selection starts a new external PDF loading lifecycle.
    setLoading({ latest: true, previous: true });
    setLoadErrors({ latest: null, previous: null });
    setDocuments((current) => {
      current.latest?.destroy();
      current.previous?.destroy();
      documentsRef.current = { latest: null, previous: null };
      return { latest: null, previous: null };
    });
    setLatestPage(0);
    setPreviousPage(0);
    setSelectedToken(null);
    setLatestRevision(0);
    setPreviousRevision(0);

    const loadSide = async (side: Side) => {
      const report = selectedPair[side];
      try {
        const loaded = await fetchCataloguePdf(report.url, report.filename);
        if (cancelled) {
          loaded.destroy();
          return;
        }
        documentsRef.current[side] = loaded;
        setDocuments((current) => ({ ...current, [side]: loaded }));
      } catch (error) {
        if (!cancelled) {
          setLoadErrors((current) => ({
            ...current,
            [side]: error instanceof Error ? error.message : `Could not load ${report.filename}`,
          }));
        }
      } finally {
        if (!cancelled) setLoading((current) => ({ ...current, [side]: false }));
      }
    };

    // Load sequentially to avoid two large downloads and MuPDF initializations
    // competing for browser memory. A failure on one side no longer blocks the other.
    void (async () => {
      await loadSide("latest");
      if (!cancelled) await loadSide("previous");
    })();

    return () => {
      cancelled = true;
    };
  }, [customMode, selectedPair]);

  const openCustomPair = () => {
    setSelectedPair(null);
    setCustomMode(true);
    setDocuments((current) => {
      current.latest?.destroy();
      current.previous?.destroy();
      documentsRef.current = { latest: null, previous: null };
      return { latest: null, previous: null };
    });
    setLoading({ latest: false, previous: false });
    setLoadErrors({ latest: null, previous: null });
    setLatestPage(0);
    setPreviousPage(0);
    setLatestRevision(0);
    setPreviousRevision(0);
    setScrambleMode(false);
    setSelectedToken(null);
  };

  const loadLocalFile = async (side: Side, file: File) => {
    setLoading((current) => ({ ...current, [side]: true }));
    setLoadErrors((current) => ({ ...current, [side]: null }));
    setSelectedToken(null);
    try {
      const loaded = await BrowserPdf.load(await file.arrayBuffer(), file.name);
      documentsRef.current[side]?.destroy();
      documentsRef.current[side] = loaded;
      setDocuments((current) => ({ ...current, [side]: loaded }));
      if (side === "latest") {
        setLatestPage(0);
        setLatestRevision((value) => value + 1);
      } else {
        setPreviousPage(0);
        setPreviousRevision((value) => value + 1);
      }
    } catch (error) {
      setLoadErrors((current) => ({
        ...current,
        [side]: error instanceof Error ? error.message : `Could not open ${file.name}`,
      }));
    } finally {
      setLoading((current) => ({ ...current, [side]: false }));
    }
  };

  const selectToken = (side: SelectedToken["side"], token: PdfToken) => {
    setSelectedToken({ side, token });
    setReplacement(token.isNumber ? alterNumber(token.text) : "");
    setEditorError(null);
  };

  const suggestSynonym = async () => {
    if (!selectedToken || selectedToken.token.isNumber) return;
    if (!isConfigured) {
      setEditorError(`Add an ${provider === "openai" ? "OpenAI" : "Anthropic"} key in the model sidebar to suggest a synonym.`);
      return;
    }
    const pdf = documents[selectedToken.side];
    if (!pdf) return;
    setSuggesting(true);
    setEditorError(null);
    try {
      const page = await pdf.extractPage(selectedToken.token.page);
      const context = page.lines.find((line) => line.id === selectedToken.token.lineId)?.text || "";
      const result = await callModel<{ synonym: string; reason: string }>("synonym", {
        word: selectedToken.token.text,
        context,
      });
      setReplacement(result.synonym);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Could not suggest a synonym");
    } finally {
      setSuggesting(false);
    }
  };

  const applyReplacement = async () => {
    if (!selectedToken || !replacement.trim()) return;
    const pdf = documents[selectedToken.side];
    if (!pdf) return;
    if (replacement.trim().length > Math.max(18, selectedToken.token.text.length * 2.2)) {
      setEditorError("That replacement is too long for the selected space.");
      return;
    }
    const change: ScrambleChange = {
      id: selectedToken.token.id,
      page: selectedToken.token.page,
      rect: selectedToken.token.rect,
      original: selectedToken.token.text,
      replacement: replacement.trim(),
      fontSize: selectedToken.token.fontSize,
      align: selectedToken.token.isNumber ? "right" : "left",
    };
    await pdf.applyChange(change);
    if (selectedToken.side === "latest") setLatestRevision((value) => value + 1);
    else setPreviousRevision((value) => value + 1);
    setSelectedToken(null);
  };

  const resetChanges = async () => {
    await Promise.all([documents.latest?.resetChanges(), documents.previous?.resetChanges()]);
    setLatestRevision((value) => value + 1);
    setPreviousRevision((value) => value + 1);
    setSelectedToken(null);
  };

  const totalChanges = (documents.latest?.changes.length || 0) + (documents.previous?.changes.length || 0);

  return (
    <div className="library-page">
      <aside className="catalogue-panel">
        <div className="catalogue-heading">
          <span className="eyebrow">Annual reports</span>
          <h1>Report library</h1>
          <p>Adjacent-year pairs from Swedish listed companies.</p>
        </div>
        <button
          className={`upload-pair-button ${customMode ? "selected" : ""}`}
          type="button"
          onClick={openCustomPair}
        >
          <span><UploadCloud size={15} /></span>
          <span>
            <strong>Upload your own pair</strong>
            <small>View and scramble locally</small>
          </span>
          {customMode && <Check size={14} />}
        </button>
        <label className="search-field">
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, ticker or year"
            aria-label="Search annual reports"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button>
          )}
        </label>
        <div className="catalogue-meta">
          <span>{filteredPairs.length} report pairs</span>
          <span>Annual only</span>
        </div>
        <div className="pair-list">
          {filteredPairs.map((pair) => (
            <button
              key={pair.id}
              type="button"
              className={`pair-row ${selectedPair?.id === pair.id ? "selected" : ""}`}
              onClick={() => {
                setCustomMode(false);
                setSelectedPair(pair);
              }}
            >
              <span className="company-monogram" style={{ "--company-accent": pair.accent } as CSSProperties}>
                {pair.company.slice(0, 2).toUpperCase()}
              </span>
              <span className="pair-copy">
                <strong>{pair.company}</strong>
                <small>{pair.ticker} · {pair.market}</small>
              </span>
              <span className="year-pair">
                <strong>{pair.latest.year}</strong>
                <span>/</span>
                <strong>{pair.previous.year}</strong>
              </span>
              {selectedPair?.id === pair.id && <Check size={14} className="selected-check" />}
            </button>
          ))}
          {!filteredPairs.length && (
            <div className="no-results"><p>No report pairs found.</p><small>Try a company name or year.</small></div>
          )}
        </div>
        {selectedPair && (
          <a className="source-link" href={selectedPair.sourceUrl} target="_blank" rel="noreferrer">
            Publisher source <ArrowUpRight size={13} />
          </a>
        )}
        {!selectedPair && (
          <p className="catalogue-storage-note">
            Catalogue files stream from each publisher. Your files stay in this browser.
          </p>
        )}
      </aside>

      <section className="library-workspace">
        {selectedPair || customMode ? (
          <>
            <header className="workspace-heading">
              <div>
                <span className="eyebrow">
                  {selectedPair
                    ? `${selectedPair.ticker} · ${selectedPair.latest.year}/${selectedPair.previous.year}`
                    : "Local files · session only"}
                </span>
                <h2>{selectedPair?.company || "Your report pair"}</h2>
              </div>
              <div className="workspace-actions">
                {totalChanges > 0 && (
                  <button className="button secondary" type="button" onClick={resetChanges}>
                    <RotateCcw size={14} /> Reset {totalChanges}
                  </button>
                )}
                <button
                  className={`button ${scrambleMode ? "primary" : "secondary"}`}
                  type="button"
                  onClick={() => {
                    setScrambleMode((value) => !value);
                    setSelectedToken(null);
                  }}
                  disabled={!documents.latest || !documents.previous}
                >
                  <FilePenLine size={14} />
                  {scrambleMode ? "Scramble on" : "Scramble report"}
                </button>
              </div>
            </header>
            {scrambleMode && (
              <div className="mode-banner">
                <Sparkles size={14} />
                Click any word or number in either report to replace it. Changes remain local until download.
              </div>
            )}
            <div className="viewer-grid">
              {customMode && !documents.latest ? (
                <PdfPicker side="latest" busy={loading.latest} error={loadErrors.latest} onFile={(file) => loadLocalFile("latest", file)} />
              ) : (
                <PdfViewer
                  pdf={documents.latest}
                  title={selectedPair ? `${selectedPair.latest.year} annual report` : "Newer annual report"}
                  subtitle={documents.latest?.name || selectedPair?.latest.filename}
                  page={latestPage}
                  onPageChange={setLatestPage}
                  revision={latestRevision}
                  loadingLabel={loading.latest ? (customMode ? "Opening local PDF…" : "Loading report from publisher…") : undefined}
                  error={loadErrors.latest}
                  interactive={scrambleMode}
                  onTokenSelect={(token) => selectToken("latest", token)}
                  actions={
                    <>
                      {customMode && <PdfPicker side="latest" busy={loading.latest} compact onFile={(file) => loadLocalFile("latest", file)} />}
                      <DownloadButton pdf={documents.latest} label={selectedPair ? `${selectedPair.latest.year} PDF` : "newer PDF"} />
                    </>
                  }
                />
              )}
              {customMode && !documents.previous ? (
                <PdfPicker side="previous" busy={loading.previous} error={loadErrors.previous} onFile={(file) => loadLocalFile("previous", file)} />
              ) : (
                <PdfViewer
                  pdf={documents.previous}
                  title={selectedPair ? `${selectedPair.previous.year} annual report` : "Prior annual report"}
                  subtitle={documents.previous?.name || selectedPair?.previous.filename}
                  page={previousPage}
                  onPageChange={setPreviousPage}
                  revision={previousRevision}
                  loadingLabel={loading.previous ? (customMode ? "Opening local PDF…" : "Loading report from publisher…") : undefined}
                  error={loadErrors.previous}
                  interactive={scrambleMode}
                  onTokenSelect={(token) => selectToken("previous", token)}
                  actions={
                    <>
                      {customMode && <PdfPicker side="previous" busy={loading.previous} compact onFile={(file) => loadLocalFile("previous", file)} />}
                      <DownloadButton pdf={documents.previous} label={selectedPair ? `${selectedPair.previous.year} PDF` : "prior PDF"} />
                    </>
                  }
                />
              )}
            </div>
          </>
        ) : (
          <div className="library-selection-empty">
            <span><FilePenLine size={20} /></span>
            <h2>Select a report pair</h2>
            <p>Choose adjacent annual reports from the list to open both PDFs side by side.</p>
          </div>
        )}
      </section>

      {selectedToken && (
        <div className="token-editor" role="dialog" aria-label={`Replace ${selectedToken.token.text}`}>
          <div className="token-editor-heading">
            <span className={`token-kind ${selectedToken.token.isNumber ? "number" : "word"}`}>
              {selectedToken.token.isNumber ? "Number" : "Word"}
            </span>
            <span className="replacement-flow">
              <del>{selectedToken.token.text}</del>
              <span>→</span>
            </span>
            <button className="icon-button" type="button" onClick={() => setSelectedToken(null)} aria-label="Close replacement editor">
              <X size={15} />
            </button>
          </div>
          <div className="replacement-row">
            <input
              value={replacement}
              onChange={(event) => {
                setReplacement(event.target.value);
                setEditorError(null);
              }}
              placeholder={selectedToken.token.isNumber ? "Altered number" : "Replacement word"}
              autoFocus
            />
            {!selectedToken.token.isNumber && (
              <button className="button secondary" type="button" onClick={suggestSynonym} disabled={suggesting}>
                {suggesting ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                Suggest
              </button>
            )}
            <button className="button primary" type="button" onClick={applyReplacement} disabled={!replacement.trim()}>
              Apply
            </button>
          </div>
          {editorError && <p className="inline-error">{editorError}</p>}
        </div>
      )}
    </div>
  );
}
