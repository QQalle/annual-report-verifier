"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BrowserPdf } from "@/lib/pdf-engine";
import type {
  Discrepancy,
  EvidenceTarget,
  NumberHighlight,
  PdfToken,
  Rect,
  RenderedPage,
} from "@/lib/types";

function position(rect: Rect, bounds: Rect) {
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  return {
    left: `${((rect[0] - bounds[0]) / width) * 100}%`,
    top: `${((rect[1] - bounds[1]) / height) * 100}%`,
    width: `${((rect[2] - rect[0]) / width) * 100}%`,
    height: `${((rect[3] - rect[1]) / height) * 100}%`,
  };
}

function targetsFor(highlight: Discrepancy, side: "newer" | "older") {
  const primary = side === "newer" ? highlight.newer : highlight.older;
  const related = side === "newer" ? highlight.newerRelated : highlight.olderRelated;
  return primary ? [primary, ...(related || [])] : [];
}

type ContinuousPageProps = {
  pdf: BrowserPdf;
  pageIndex: number;
  title: string;
  zoom: number;
  revision: number;
  scrollRoot: HTMLDivElement | null;
  interactive?: boolean;
  onTokenSelect?: (token: PdfToken) => void;
  highlights: Discrepancy[];
  numberHighlights: NumberHighlight[];
  highlightSide: "newer" | "older";
  activeHighlight?: string | null;
  onHighlight?: (id: string | null) => void;
  onHighlightActivate?: (highlight: Discrepancy, target: EvidenceTarget) => void;
  registerPage: (page: number, node: HTMLDivElement | null) => void;
  onError: (message: string | null) => void;
};

function ContinuousPage({
  pdf,
  pageIndex,
  title,
  zoom,
  revision,
  scrollRoot,
  interactive,
  onTokenSelect,
  highlights,
  numberHighlights,
  highlightSide,
  activeHighlight,
  onHighlight,
  onHighlightActivate,
  registerPage,
  onError,
}: ContinuousPageProps) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(pageIndex < 2);
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [rendering, setRendering] = useState(false);

  const pageRef = useCallback((element: HTMLDivElement | null) => {
    setNode(element);
    registerPage(pageIndex, element);
  }, [pageIndex, registerPage]);

  useEffect(() => {
    if (!node || !scrollRoot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { root: scrollRoot, rootMargin: "1200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, scrollRoot]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    // Rendering starts an asynchronous external MuPDF lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRendering(true);
    onError(null);
    pdf.renderPage(pageIndex)
      .then((result) => {
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        objectUrl = result.url;
        setRendered(result);
      })
      .catch((reason) => onError(reason instanceof Error ? reason.message : "Could not render page"))
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, pageIndex, revision, visible, onError]);

  const pageHighlights = useMemo(
    () => highlights.flatMap((highlight) =>
      targetsFor(highlight, highlightSide)
        .filter((target) => target.page === pageIndex)
        .map((target) => ({ highlight, target })),
    ),
    [highlights, highlightSide, pageIndex],
  );
  const pageNumberHighlights = numberHighlights.filter((highlight) => highlight.page === pageIndex);

  return (
    <div className="continuous-page" data-page={pageIndex} ref={pageRef}>
      <div className={`page-sheet ${rendered ? "is-rendered" : "is-placeholder"}`} style={{ width: `${zoom}%` }}>
        {rendered ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={rendered.url}
              width={rendered.width}
              height={rendered.height}
              alt={`${title}, page ${pageIndex + 1}`}
              draggable={false}
            />
            {interactive && (
              <div className="token-layer" aria-label={`Selectable PDF text on page ${pageIndex + 1}`}>
                {rendered.tokens.map((token) => (
                  <button
                    key={token.id}
                    type="button"
                    className={`token-hit ${token.isNumber ? "number" : "word"}`}
                    style={position(token.rect, rendered.bounds)}
                    onClick={() => onTokenSelect?.(token)}
                    aria-label={`Replace ${token.text}`}
                    title={token.text}
                  />
                ))}
              </div>
            )}
            <div className="number-highlight-layer">
              {pageNumberHighlights.map((highlight) => (
                <span key={`number-${highlight.tokenId}`} className="number-highlight" style={position(highlight.rect, rendered.bounds)} />
              ))}
            </div>
            <div className="highlight-layer">
              {pageHighlights.map(({ highlight, target }) => {
                const isActive = activeHighlight === highlight.id;
                return (
                  <Fragment key={`${highlightSide}-${highlight.id}-${target.tokenId}`}>
                    {target.keyRect && (
                      <span
                        className={`pdf-context-highlight key ${highlight.status} ${isActive ? "active" : ""}`}
                        style={position(target.keyRect, rendered.bounds)}
                        aria-hidden="true"
                      />
                    )}
                    {target.yearRect && (
                      <span
                        className={`pdf-context-highlight year ${highlight.status} ${isActive ? "active" : ""}`}
                        style={position(target.yearRect, rendered.bounds)}
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      className={`pdf-highlight number ${highlight.status} ${highlight.arithmetic ? "arithmetic" : ""} ${isActive ? "active" : ""}`}
                      style={position(target.rect, rendered.bounds)}
                      onMouseEnter={() => onHighlight?.(highlight.id)}
                      onMouseLeave={() => onHighlight?.(null)}
                      onFocus={() => onHighlight?.(highlight.id)}
                      onBlur={() => onHighlight?.(null)}
                      onClick={() => onHighlightActivate?.(highlight, target)}
                      aria-label={highlight.explanation}
                    >
                      <span className="highlight-tooltip">
                        <strong>{highlight.labelNew}</strong>
                        <span>{highlight.explanation}</span>
                        {highlight.arithmetic && <code>{highlight.arithmetic.expression}</code>}
                        <small>
                          {highlight.matchMethod === "model"
                            ? highlight.arithmetic ? "Model-validated grouping · deterministic math" : "Model-assisted label match"
                            : `${highlight.matchMethod} label match`}
                        </small>
                      </span>
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </>
        ) : (
          <div className="page-placeholder">
            <LoaderCircle size={18} className="spin" />
            <span>Page {pageIndex + 1}</span>
          </div>
        )}
        {rendering && rendered && <div className="page-refresh"><LoaderCircle size={18} className="spin" /></div>}
      </div>
    </div>
  );
}

type PdfViewerProps = {
  pdf: BrowserPdf | null;
  title: string;
  subtitle?: string;
  page: number;
  onPageChange: (page: number) => void;
  revision?: number;
  loadingLabel?: string;
  error?: string | null;
  emptyLabel?: string;
  actions?: ReactNode;
  interactive?: boolean;
  onTokenSelect?: (token: PdfToken) => void;
  highlights?: Discrepancy[];
  numberHighlights?: NumberHighlight[];
  highlightSide?: "newer" | "older";
  activeHighlight?: string | null;
  onHighlight?: (id: string | null) => void;
  onHighlightActivate?: (highlight: Discrepancy, target: EvidenceTarget) => void;
  focusRequest?: { id: number; target: EvidenceTarget } | null;
  syncRequest?: { id: number; progress: number } | null;
  onViewportChange?: (position: { page: number; progress: number }) => void;
};

export function PdfViewer({
  pdf,
  title,
  subtitle,
  page,
  onPageChange,
  revision = 0,
  loadingLabel,
  error,
  emptyLabel = "Choose a report to begin",
  actions,
  interactive,
  onTokenSelect,
  highlights = [],
  numberHighlights = [],
  highlightSide = "newer",
  activeHighlight,
  onHighlight,
  onHighlightActivate,
  focusRequest,
  syncRequest,
  onViewportChange,
}: PdfViewerProps) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const pageNodes = useRef(new Map<number, HTMLDivElement>());
  const lastVisiblePage = useRef(page);
  const lastUserInput = useRef(0);
  const animationFrame = useRef<number | null>(null);

  const registerPage = useCallback((pageIndex: number, node: HTMLDivElement | null) => {
    if (node) pageNodes.current.set(pageIndex, node);
    else pageNodes.current.delete(pageIndex);
  }, []);
  const handleRenderError = useCallback((message: string | null) => setRenderError(message), []);

  const markUserInput = () => {
    lastUserInput.current = Date.now();
  };

  const scrollToPage = useCallback((pageIndex: number, behavior: ScrollBehavior = "smooth") => {
    if (!scrollRoot) return;
    const node = pageNodes.current.get(Math.min(Math.max(pageIndex, 0), Math.max(0, (pdf?.pageCount || 1) - 1)));
    if (node) scrollRoot.scrollTo({ top: Math.max(0, node.offsetTop - 16), behavior });
  }, [pdf?.pageCount, scrollRoot]);

  useEffect(() => {
    if (!pdf || page === lastVisiblePage.current) return;
    lastVisiblePage.current = page;
    scrollToPage(page);
  }, [page, pdf, scrollToPage]);

  useEffect(() => {
    if (!scrollRoot || !syncRequest) return;
    const available = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
    scrollRoot.scrollTo({ top: syncRequest.progress * available, behavior: "auto" });
  }, [scrollRoot, syncRequest]);

  useEffect(() => {
    if (!scrollRoot || !pdf || !focusRequest) return;
    let cancelled = false;
    pdf.extractPage(focusRequest.target.page).then((extracted) => {
      if (cancelled) return;
      const node = pageNodes.current.get(focusRequest.target.page);
      if (!node) return;
      const center = (focusRequest.target.rect[1] + focusRequest.target.rect[3]) / 2;
      const ratio = (center - extracted.bounds[1]) / Math.max(1, extracted.bounds[3] - extracted.bounds[1]);
      const top = node.offsetTop + ratio * node.offsetHeight - scrollRoot.clientHeight * 0.45;
      scrollRoot.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => { cancelled = true; };
  }, [focusRequest, pdf, scrollRoot]);

  const handleScroll = () => {
    if (!scrollRoot || !pdf) return;
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = requestAnimationFrame(() => {
      const anchor = scrollRoot.scrollTop + scrollRoot.clientHeight * 0.34;
      let current = 0;
      let distance = Number.POSITIVE_INFINITY;
      for (const [pageIndex, node] of pageNodes.current) {
        const candidate = Math.abs(node.offsetTop + node.offsetHeight * 0.25 - anchor);
        if (candidate < distance) {
          current = pageIndex;
          distance = candidate;
        }
      }
      if (current !== lastVisiblePage.current) {
        lastVisiblePage.current = current;
        onPageChange(current);
      }
      if (Date.now() - lastUserInput.current < 350) {
        const available = Math.max(1, scrollRoot.scrollHeight - scrollRoot.clientHeight);
        onViewportChange?.({ page: current, progress: scrollRoot.scrollTop / available });
      }
    });
  };

  const findingMarkers = useMemo(
    () => highlights.flatMap((highlight) => {
      if (highlight.status !== "mismatch" && !highlight.arithmetic) return [];
      const target = targetsFor(highlight, highlightSide)[0];
      return target ? [{ highlight, target }] : [];
    }),
    [highlights, highlightSide],
  );

  return (
    <section className="pdf-viewer">
      <header className="viewer-header">
        <div className="viewer-identity">
          <span className="document-icon"><FileText size={15} /></span>
          <span>
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </span>
        </div>
        <div className="viewer-actions">{actions}</div>
      </header>
      <div className="viewer-stage">
        {!pdf && !loadingLabel && (
          <div className="viewer-empty">
            <span><FileText size={22} /></span>
            <p>{emptyLabel}</p>
          </div>
        )}
        {loadingLabel && (
          <div className="viewer-empty">
            <LoaderCircle size={22} className="spin" />
            <p>{loadingLabel}</p>
          </div>
        )}
        {(error || renderError) && !loadingLabel && (
          <div className="viewer-empty error-state">
            <span>!</span>
            <p>{error || renderError}</p>
          </div>
        )}
        {pdf && !error && (
          <div
            className="page-scroll continuous"
            ref={setScrollRoot}
            onScroll={handleScroll}
            onWheel={markUserInput}
            onPointerDown={markUserInput}
            onTouchStart={markUserInput}
            onKeyDown={markUserInput}
            tabIndex={0}
            aria-label={`${title}, continuously scrollable PDF`}
          >
            {Array.from({ length: pdf.pageCount }, (_, pageIndex) => (
              <ContinuousPage
                key={`${pdf.name}-${pageIndex}`}
                pdf={pdf}
                pageIndex={pageIndex}
                title={title}
                zoom={zoom}
                revision={revision}
                scrollRoot={scrollRoot}
                interactive={interactive}
                onTokenSelect={onTokenSelect}
                highlights={highlights}
                numberHighlights={numberHighlights}
                highlightSide={highlightSide}
                activeHighlight={activeHighlight}
                onHighlight={onHighlight}
                onHighlightActivate={onHighlightActivate}
                registerPage={registerPage}
                onError={handleRenderError}
              />
            ))}
          </div>
        )}
        {pdf && findingMarkers.length > 0 && (
          <div className="scroll-markers" aria-label="Discrepancy and regrouping positions">
            {findingMarkers.map(({ highlight, target }) => (
              <button
                key={`marker-${highlight.id}`}
                type="button"
                className={`scroll-marker ${highlight.arithmetic ? "arithmetic" : "mismatch"}`}
                style={{ top: `${((target.page + 0.5) / pdf.pageCount) * 100}%` }}
                onClick={() => onHighlightActivate?.(highlight, target)}
                aria-label={`Go to ${highlight.arithmetic ? "regrouping" : "discrepancy"}: ${highlight.labelNew}`}
                title={highlight.labelNew}
              />
            ))}
          </div>
        )}
      </div>
      <footer className="viewer-toolbar">
        <div className="page-controls">
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              markUserInput();
              onPageChange(Math.max(0, page - 1));
            }}
            disabled={!pdf || page <= 0}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="page-counter">
            <strong>{pdf ? page + 1 : "—"}</strong>
            <span>/</span>
            <span>{pdf?.pageCount || "—"}</span>
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              markUserInput();
              onPageChange(Math.min((pdf?.pageCount || 1) - 1, page + 1));
            }}
            disabled={!pdf || page >= pdf.pageCount - 1}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="zoom-controls">
          <button className="icon-button" type="button" onClick={() => setZoom(Math.max(65, zoom - 10))} disabled={!pdf} aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <button className="zoom-value" type="button" onClick={() => setZoom(100)} disabled={!pdf}>
            {zoom === 100 ? "Fit width" : `${zoom}%`}
          </button>
          <button className="icon-button" type="button" onClick={() => setZoom(Math.min(180, zoom + 10))} disabled={!pdf} aria-label="Zoom in">
            <Plus size={14} />
          </button>
          {zoom !== 100 && (
            <button className="icon-button" type="button" onClick={() => setZoom(100)} aria-label="Reset zoom">
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
