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
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BrowserPdf } from "@/lib/pdf-engine";
import type { Discrepancy, NumberHighlight, PdfToken, Rect, RenderedPage } from "@/lib/types";

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
  onHighlightActivate?: (highlight: Discrepancy) => void;
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
}: PdfViewerProps) {
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!pdf) return;
    // Rendering is an asynchronous external MuPDF lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRendering(true);
    setRenderError(null);
    pdf
      .renderPage(Math.min(Math.max(page, 0), pdf.pageCount - 1))
      .then((result) => {
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        objectUrl = result.url;
        setRendered(result);
      })
      .catch((reason) => setRenderError(reason instanceof Error ? reason.message : "Could not render page"))
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, page, revision]);

  const pageHighlights = useMemo(
    () =>
      highlights.filter((highlight) => {
        const target = highlightSide === "newer" ? highlight.newer : highlight.older;
        return target?.page === page;
      }),
    [highlights, highlightSide, page],
  );
  const pageNumberHighlights = numberHighlights.filter((highlight) => highlight.page === page);

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
        {pdf && rendered && !error && (
          <div className="page-scroll">
            <div className="page-sheet" style={{ width: `${zoom}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={rendered.url}
                width={rendered.width}
                height={rendered.height}
                alt={`${title}, page ${page + 1}`}
                draggable={false}
              />
              {interactive && (
                <div className="token-layer" aria-label="Selectable PDF text">
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
                {pageHighlights.map((highlight) => {
                  const target = highlightSide === "newer" ? highlight.newer : highlight.older;
                  if (!target) return null;
                  const isActive = activeHighlight === highlight.id;
                  return (
                    <Fragment key={`${highlightSide}-${highlight.id}`}>
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
                        className={`pdf-highlight number ${highlight.status} ${isActive ? "active" : ""}`}
                        style={position(target.rect, rendered.bounds)}
                        onMouseEnter={() => onHighlight?.(highlight.id)}
                        onMouseLeave={() => onHighlight?.(null)}
                        onFocus={() => onHighlight?.(highlight.id)}
                        onBlur={() => onHighlight?.(null)}
                        onClick={() => onHighlightActivate?.(highlight)}
                        aria-label={highlight.explanation}
                      >
                        <span className="highlight-tooltip">
                          <strong>{highlight.labelNew}</strong>
                          <span>{highlight.explanation}</span>
                          <small>
                            {highlight.matchMethod === "model"
                              ? "Model-assisted label match"
                              : `${highlight.matchMethod} label match`}
                          </small>
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
              {rendering && <div className="page-refresh"><LoaderCircle size={18} className="spin" /></div>}
            </div>
          </div>
        )}
      </div>
      <footer className="viewer-toolbar">
        <div className="page-controls">
          <button
            className="icon-button"
            type="button"
            onClick={() => onPageChange(Math.max(0, page - 1))}
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
            onClick={() => onPageChange(Math.min((pdf?.pageCount || 1) - 1, page + 1))}
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
