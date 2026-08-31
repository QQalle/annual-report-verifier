"use client";

import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  KeyRound,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useModel } from "@/lib/model-context";
import type { ModelCall, ModelProvider } from "@/lib/types";
import { MODEL_OPTIONS } from "@/lib/model-config";

function number(value?: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function CallRow({ call }: { call: ModelCall }) {
  const usage = (call.usage?.input_tokens || 0) + (call.usage?.output_tokens || 0);
  return (
    <details className="call-row">
      <summary>
        <span className={`call-status ${call.status}`}>
          {call.status === "pending" ? (
            <LoaderCircle size={13} className="spin" />
          ) : call.status === "success" ? (
            <CircleCheck size={13} />
          ) : (
            <CircleAlert size={13} />
          )}
        </span>
        <span className="call-copy">
          <strong>{call.purpose === "match-labels" ? "Semantic row match" : call.purpose}</strong>
          <small>
            {call.provider === "openai" ? "OpenAI" : "Anthropic"} ·{" "}
            {call.model} ·{" "}
            {new Date(call.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {call.latencyMs ? ` · ${call.latencyMs} ms` : ""}
          </small>
        </span>
        <span className="call-token-count">{usage ? `${number(usage)} tok` : "—"}</span>
        <ChevronRight size={14} className="details-chevron" />
      </summary>
      <div className="call-details">
        {call.error && <p className="inline-error">{call.error}</p>}
        <div className="usage-grid">
          <span><small>Input</small><strong>{number(call.usage?.input_tokens)}</strong></span>
          <span><small>Output</small><strong>{number(call.usage?.output_tokens)}</strong></span>
          <span><small>Cache read</small><strong>{number(call.usage?.cache_read_input_tokens)}</strong></span>
        </div>
        <label>Request</label>
        <pre>{JSON.stringify(call.request, null, 2)}</pre>
        {call.response !== undefined && (
          <>
            <label>Response</label>
            <pre>{JSON.stringify(call.response, null, 2)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

export function ModelSidebar({ onClose }: { onClose: () => void }) {
  const {
    provider,
    setProvider,
    model,
    setModel,
    apiKey,
    setApiKey,
    envConfigured,
    isConfigured,
    calls,
    clearCalls,
    callModel,
    totalUsage,
  } = useModel();
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<"idle" | "success" | "error">("idle");

  const totalTokens = useMemo(
    () => (totalUsage.input_tokens || 0) + (totalUsage.output_tokens || 0),
    [totalUsage],
  );

  const testConnection = async () => {
    setTesting(true);
    setTestState("idle");
    try {
      await callModel<{ ok: boolean }>("connection", {}, apiKey.trim() || undefined);
      setTestState("success");
    } catch {
      setTestState("error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <aside className="claude-sidebar" id="model-sidebar" aria-label="Model setup and API calls">
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">Model activity</span>
          <h2>Model setup</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close model sidebar">
          <X size={16} />
        </button>
      </div>

      <section className="sidebar-section key-section">
        <div className="provider-switch" aria-label="Model provider">
          {(["openai", "anthropic"] as ModelProvider[]).map((option) => (
            <button
              type="button"
              key={option}
              className={provider === option ? "active" : ""}
              onClick={() => {
                setProvider(option);
                setTestState("idle");
              }}
            >
              {option === "openai" ? "OpenAI" : "Anthropic"}
            </button>
          ))}
        </div>
        <div className="section-title-row">
          <h3>Setup</h3>
          <span className={`status-pill ${isConfigured ? "ready" : ""}`}>
            {isConfigured ? <Check size={11} /> : null}
            {envConfigured[provider] && !apiKey ? "Environment key" : isConfigured ? "Ready" : "Not configured"}
          </span>
        </div>
        <label className="field-label" htmlFor="model-key">
          {provider === "openai" ? "OpenAI" : "Anthropic"} API key
        </label>
        <div className="key-field">
          <KeyRound size={14} />
          <input
            id="model-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setTestState("idle");
            }}
            placeholder={
              envConfigured[provider]
                ? `Using ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}`
                : provider === "openai"
                  ? "sk-proj-…"
                  : "sk-ant-…"
            }
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            spellCheck={false}
          />
        </div>
        <label className="field-label model-label" htmlFor="model-choice">
          Model
        </label>
        <select
          id="model-choice"
          className="model-select"
          value={model}
          onChange={(event) => setModel(event.target.value as typeof model)}
        >
          {MODEL_OPTIONS[provider].map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="privacy-note">Held in memory for this session. Never added to call logs.</p>
        <button
          className="button secondary full-width"
          type="button"
          onClick={testConnection}
          disabled={testing || (!apiKey.trim() && !envConfigured[provider])}
        >
          {testing ? <LoaderCircle size={14} className="spin" /> : <Clock3 size={14} />}
          {testing ? "Testing…" : "Test connection"}
        </button>
        {testState === "success" && <p className="connection-message success">Connection verified.</p>}
        {testState === "error" && <p className="connection-message error">Connection failed. Open the call below.</p>}
      </section>

      <section className="sidebar-section usage-section">
        <div className="section-title-row">
          <h3>Session usage</h3>
          <strong className="total-tokens">{number(totalTokens)} tokens</strong>
        </div>
        <div className="token-meter" aria-label={`${number(totalTokens)} tokens used`}>
          <span
            className="input-meter"
            style={{ width: `${totalTokens ? ((totalUsage.input_tokens || 0) / totalTokens) * 100 : 0}%` }}
          />
          <span
            className="output-meter"
            style={{ width: `${totalTokens ? ((totalUsage.output_tokens || 0) / totalTokens) * 100 : 0}%` }}
          />
        </div>
        <div className="meter-legend">
          <span><i className="input-swatch" />Input {number(totalUsage.input_tokens)}</span>
          <span><i className="output-swatch" />Output {number(totalUsage.output_tokens)}</span>
        </div>
      </section>

      <section className="sidebar-section call-section">
        <div className="section-title-row sticky-row">
          <div>
            <h3>API calls</h3>
            <small>{calls.length} this session</small>
          </div>
          {calls.length > 0 && (
            <button className="quiet-button" type="button" onClick={clearCalls}>
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
        <div className="call-list">
          {calls.length ? (
            calls.map((call) => <CallRow call={call} key={call.id} />)
          ) : (
            <div className="empty-calls">
              <span className="empty-call-icon">{`{ }`}</span>
              <p>No calls yet</p>
              <small>Synonyms and semantic matches will appear here.</small>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
