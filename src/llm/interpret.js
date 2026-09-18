import { getOpenAIClient } from "./client.js";
import { buildMessages } from "./prompt.js";
import { directiveInterpretationSchema } from "./schema.js";

const LLM_TIMEOUT_MS = 12000;

/**
 * Calls the LLM to interpret operator notes into raw (unvalidated) directive
 * fields. Returns an array of raw entries on success, or null on any failure
 * (missing key, timeout, provider error, unparseable output) — callers must
 * treat null as "safe-fallback to no_op for every note", never crash on it.
 */
export async function interpretOperatorNotes({ operatorNotes, battery }) {
  const client = getOpenAIClient();
  if (!client) {
    console.error("LLM interpret skipped: OPENAI_API_KEY not set");
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const messages = buildMessages({ operatorNotes, battery });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const response = await client.chat.completions.create(
      {
        model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "directive_interpretations",
            strict: true,
            schema: directiveInterpretationSchema,
          },
        },
        temperature: 0,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    const raw = response?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.directive_interpretations)) return null;

    return parsed.directive_interpretations;
  } catch (err) {
    console.error("LLM interpret failed:", err?.message || err);
    return null;
  }
}
