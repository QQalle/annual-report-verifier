export const MODEL_OPTIONS = [
  { id: "jev-1.13.0", label: "Jev 1.13 (pinned)" },
  { id: "jev-latest", label: "Jev latest" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export const DEFAULT_MODEL: ModelId = "jev-1.13.0";

export function isModel(model: string): model is ModelId {
  return MODEL_OPTIONS.some((option) => option.id === model);
}
