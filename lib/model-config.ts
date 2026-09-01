import type { ModelProvider } from "./types";

export const MODEL_OPTIONS = {
  openai: [
    { id: "gpt-5.6", label: "GPT-5.6 (Sol alias)" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
  ],
} as const satisfies Record<ModelProvider, readonly { id: string; label: string }[]>;

export type ModelId = (typeof MODEL_OPTIONS)[ModelProvider][number]["id"];

export const DEFAULT_MODELS: Record<ModelProvider, ModelId> = {
  openai: "gpt-5.6",
  anthropic: "claude-haiku-4-5",
};

export function isModelForProvider(provider: ModelProvider, model: string): model is ModelId {
  return MODEL_OPTIONS[provider].some((option) => option.id === model);
}

export function selectConfiguredProvider(
  current: ModelProvider,
  configured: Record<ModelProvider, boolean>,
): ModelProvider {
  if (configured[current]) return current;
  if (configured.anthropic) return "anthropic";
  if (configured.openai) return "openai";
  return current;
}
