"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ModelCall, ModelUsage } from "./types";
import { DEFAULT_MODEL, type ModelId } from "./model-config";

type ModelPurpose = ModelCall["purpose"];

type ModelContextValue = {
  provider: "typesafe";
  model: ModelId;
  setModel: (model: ModelId) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  envConfigured: boolean;
  isConfigured: boolean;
  calls: ModelCall[];
  clearCalls: () => void;
  callModel: <T>(purpose: ModelPurpose, payload: unknown, keyOverride?: string) => Promise<T>;
  totalUsage: ModelUsage;
};

const ModelContext = createContext<ModelContextValue | null>(null);

const emptyUsage: ModelUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

export function ModelProviderRoot({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [envConfigured, setEnvConfigured] = useState(false);
  const [calls, setCalls] = useState<ModelCall[]>([]);

  useEffect(() => {
    fetch("/api/model")
      .then((response) => response.json())
      .then((data) => setEnvConfigured(Boolean(data.typesafe)))
      .catch(() => setEnvConfigured(false));
  }, []);

  const callModel = useCallback(
    async <T,>(purpose: ModelPurpose, payload: unknown, keyOverride?: string): Promise<T> => {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      setCalls((current) => [
        { id, provider: "typesafe", model, purpose, createdAt, status: "pending", request: payload },
        ...current,
      ]);

      try {
        const response = await fetch("/api/model", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            apiKey: keyOverride || apiKey || undefined,
            purpose,
            payload,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          const message = data.error || "TypeSafe request failed";
          setCalls((current) =>
            current.map((call) =>
              call.id === id
                ? {
                    ...call,
                    status: "error",
                    error: message,
                    request: data.request ?? call.request,
                    response: data.response,
                    usage: data.usage,
                    latencyMs: data.latencyMs,
                  }
                : call,
            ),
          );
          throw new Error(message);
        }

        setCalls((current) =>
          current.map((call) =>
            call.id === id
              ? {
                  ...call,
                  model: data.response?.model || call.model,
                  status: "success",
                  request: data.request,
                  response: data.response,
                  parsed: data.parsed,
                  usage: data.usage,
                  latencyMs: data.latencyMs,
                }
              : call,
          ),
        );
        return data.parsed as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TypeSafe request failed";
        setCalls((current) =>
          current.map((call) =>
            call.id === id ? { ...call, status: "error", error: message } : call,
          ),
        );
        throw error;
      }
    },
    [apiKey, model],
  );

  const totalUsage = useMemo(
    () =>
      calls.reduce<ModelUsage>((sum, call) => {
        const usage = call.usage || emptyUsage;
        return {
          input_tokens: (sum.input_tokens || 0) + (usage.input_tokens || 0),
          output_tokens: (sum.output_tokens || 0) + (usage.output_tokens || 0),
          cache_creation_input_tokens:
            (sum.cache_creation_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
          cache_read_input_tokens:
            (sum.cache_read_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
        };
      }, emptyUsage),
    [calls],
  );

  const value = useMemo<ModelContextValue>(
    () => ({
      provider: "typesafe",
      model,
      setModel,
      apiKey,
      setApiKey,
      envConfigured,
      isConfigured: Boolean(apiKey) || envConfigured,
      calls,
      clearCalls: () => setCalls([]),
      callModel,
      totalUsage,
    }),
    [apiKey, model, envConfigured, calls, callModel, totalUsage],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
  const context = useContext(ModelContext);
  if (!context) throw new Error("useModel must be used within ModelProviderRoot");
  return context;
}
