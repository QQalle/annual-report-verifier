import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { ModelProvider } from "@/lib/types";
import { DEFAULT_MODELS, isModelForProvider, type ModelId } from "@/lib/model-config";

type Purpose = "connection" | "synonym" | "match-labels";

function requestDefinition(purpose: Purpose, payload: Record<string, unknown>) {
  if (purpose === "connection") {
    return {
      prompt: "Return a successful connection check.",
      maxTokens: 32,
      name: "connection_check",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    };
  }

  if (purpose === "synonym") {
    const word = String(payload.word || "").slice(0, 120);
    const context = String(payload.context || "").slice(0, 600);
    return {
      prompt:
        `Suggest one Swedish synonym for the selected annual-report word. ` +
        `Keep the same grammatical form and capitalization. Return the original word ` +
        `if no safe synonym exists.\nWord: ${JSON.stringify(word)}\n` +
        `Context: ${JSON.stringify(context)}`,
      maxTokens: 96,
      name: "swedish_synonym",
      schema: {
        type: "object",
        properties: {
          synonym: { type: "string" },
          reason: { type: "string" },
        },
        required: ["synonym", "reason"],
        additionalProperties: false,
      },
    };
  }

  const labelsNew = Array.isArray(payload.labelsNew)
    ? payload.labelsNew.map(String).slice(0, 80)
    : [];
  const labelsOld = Array.isArray(payload.labelsOld)
    ? payload.labelsOld.map(String).slice(0, 120)
    : [];
  return {
    prompt:
      `Map annual-report row labels between adjacent years. Note numbers may differ. ` +
      `For each newer label, return one or more older labels that mean the same thing, ` +
      `or an empty array. Multiple older labels are allowed only when the newer row is ` +
      `an aggregate. Do not compare or invent numbers.\nNewer labels: ` +
      `${JSON.stringify(labelsNew)}\nOlder labels: ${JSON.stringify(labelsOld)}`,
    maxTokens: 1600,
    name: "annual_report_label_mappings",
    schema: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              labelNew: { type: "string" },
              labelsOld: { type: "array", items: { type: "string" } },
              relationship: { type: "string", enum: ["direct", "aggregate", "none"] },
            },
            required: ["labelNew", "labelsOld", "relationship"],
            additionalProperties: false,
          },
        },
      },
      required: ["mappings"],
      additionalProperties: false,
    },
  };
}

export async function GET() {
  return NextResponse.json({
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = (await request.json()) as {
      provider?: ModelProvider;
      model?: string;
      apiKey?: string;
      purpose?: Purpose;
      payload?: Record<string, unknown>;
    };
    const provider = body.provider;
    if (!provider || !["openai", "anthropic"].includes(provider)) {
      return NextResponse.json({ error: "Choose OpenAI or Anthropic first." }, { status: 400 });
    }
    const model: ModelId = body.model && isModelForProvider(provider, body.model)
      ? body.model
      : DEFAULT_MODELS[provider];
    if (!body.purpose || !["connection", "synonym", "match-labels"].includes(body.purpose)) {
      return NextResponse.json({ error: "Unsupported model call purpose." }, { status: 400 });
    }
    const apiKey =
      body.apiKey ||
      (provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);
    if (!apiKey) {
      return NextResponse.json(
        { error: `Add an ${provider === "openai" ? "OpenAI" : "Anthropic"} API key in the model sidebar first.` },
        { status: 400 },
      );
    }

    const definition = requestDefinition(body.purpose, body.payload || {});

    if (provider === "openai") {
      const openaiRequest = {
        model,
        input: [{ role: "user", content: definition.prompt }],
        max_output_tokens: definition.maxTokens,
        text: {
          format: {
            type: "json_schema",
            name: definition.name,
            strict: true,
            schema: definition.schema,
          },
        },
      };
      const client = new OpenAI({ apiKey });
      const response = await client.responses.create(openaiRequest as never);
      const parsed = JSON.parse(response.output_text);
      return NextResponse.json({
        request: { provider, purpose: body.purpose, ...openaiRequest },
        response,
        parsed,
        usage: {
          input_tokens: response.usage?.input_tokens,
          output_tokens: response.usage?.output_tokens,
          cache_read_input_tokens: response.usage?.input_tokens_details?.cached_tokens,
        },
        latencyMs: Date.now() - started,
      });
    }

    const anthropicRequest = {
      model,
      max_tokens: definition.maxTokens,
      messages: [{ role: "user", content: definition.prompt }],
      output_config: {
        format: { type: "json_schema", schema: definition.schema },
      },
    };
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create(anthropicRequest as never);
    const content = response.content as Array<{ type: string; text?: string }>;
    const text = content.find((block) => block.type === "text")?.text;
    const parsed = text ? JSON.parse(text) : null;
    return NextResponse.json({
      request: { provider, purpose: body.purpose, ...anthropicRequest },
      response,
      parsed,
      usage: response.usage,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Model request failed." },
      { status: 500 },
    );
  }
}
