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
import type { ModelCall, ModelProvider, ModelUsage } from "./types";
import { DEFAULT_MODELS, selectConfiguredProvider, type ModelId } from "./model-config";

type ModelPurpose = ModelCall["purpose"];
type ProviderMap<T> = Record<ModelProvider, T>;

type ModelContextValue = {
  provider: ModelProvider;
  setProvider: (provider: ModelProvider) => void;
  model: ModelId;
  setModel: (model: ModelId) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  envConfigured: ProviderMap<boolean>;
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
  const [provider, setProvider] = useState<ModelProvider>("openai");
  const [models, setModels] = useState<Record<ModelProvider, ModelId>>(DEFAULT_MODELS);
  const [apiKeys, setApiKeys] = useState<ProviderMap<string>>({ openai: "", anthropic: "" });
  const [envConfigured, setEnvConfigured] = useState<ProviderMap<boolean>>({
    openai: false,
    anthropic: false,
  });
  const [calls, setCalls] = useState<ModelCall[]>([]);

  useEffect(() => {
    fetch("/api/model")
      .then((response) => response.json())
      .then((data) => {
        const configured = {
          openai: Boolean(data.openai),
          anthropic: Boolean(data.anthropic),
        };
        setEnvConfigured(configured);
        setProvider((current) => selectConfiguredProvider(current, configured));
      })
      .catch(() => setEnvConfigured({ openai: false, anthropic: false }));
  }, []);

  const callModel = useCallback(
    async <T,>(purpose: ModelPurpose, payload: unknown, keyOverride?: string): Promise<T> => {
      const activeProvider = provider;
      const activeModel = models[activeProvider];
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      setCalls((current) => [
        { id, provider: activeProvider, model: activeModel, purpose, createdAt, status: "pending", request: payload },
        ...current,
      ]);

      try {
        const response = await fetch("/api/model", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: activeProvider,
            model: activeModel,
            apiKey: keyOverride || apiKeys[activeProvider] || undefined,
            purpose,
            payload,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          const message = data.error || "Model request failed";
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
        const message = error instanceof Error ? error.message : "Model request failed";
        setCalls((current) =>
          current.map((call) =>
            call.id === id ? { ...call, status: "error", error: message } : call,
          ),
        );
        throw error;
      }
    },
    [apiKeys, models, provider],
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
      provider,
      setProvider,
      model: models[provider],
      setModel: (model) => setModels((current) => ({ ...current, [provider]: model })),
      apiKey: apiKeys[provider],
      setApiKey: (value) => setApiKeys((current) => ({ ...current, [provider]: value })),
      envConfigured,
      isConfigured: Boolean(apiKeys[provider]) || envConfigured[provider],
      calls,
      clearCalls: () => setCalls([]),
      callModel,
      totalUsage,
    }),
    [apiKeys, models, provider, envConfigured, calls, callModel, totalUsage],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
  const context = useContext(ModelContext);
  if (!context) throw new Error("useModel must be used within ModelProviderRoot");
  return context;
}
