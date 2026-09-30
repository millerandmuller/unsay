import OpenAI from "openai";
import { env } from "../config/env.js";
import type { CommitmentLevel, SpeakerRole } from "../db/index.js";

const gateway = new OpenAI({
  apiKey: env.assemblyAiApiKey,
  baseURL: "https://llm-gateway.assemblyai.com/v1",
});

export interface ExtractedCommitment {
  field: "delivery_day" | "delivery_window" | "price" | "callback";
  value: string;
  quote: string;
  speaker_role: SpeakerRole;
  commitment_level: CommitmentLevel;
  order_id: string | null;
}

// Plain JSON mode, not `json_schema` strict mode: the LLM Gateway's
// translation to non-OpenAI models (e.g. Claude) rejected the strict
// schema with an empty-body 400. JSON mode is far more broadly supported;
// the shape is described in the prompt instead and validated on parse.
const SYSTEM_PROMPT = `You extract commitments from a phone call transcript between a furniture delivery voice agent and a customer.
A commitment is a specific, checkable promise about a delivery: which day, which time window, a price, or a promise to call back.
Only extract what was actually said. The "quote" field must be an exact, verbatim substring of the transcript (same words, same order) so it can be located in the word-level transcript later — never paraphrase the quote.
Mark commitment_level "firm" only for a definite statement with no hedging. Mark it "tentative" for hedged language such as "should", "probably", "I think".
If no order id is mentioned, use null.
For "delivery_window", format the value compactly as start-end in 24h hours only, e.g. "8-12" (not "8:00 AM to 12:00 PM" or "between 8 and 12") — this must match the format used elsewhere in the system.

Respond with ONLY a JSON object, no prose, matching exactly this shape:
{
  "commitments": [
    {
      "field": "delivery_day" | "delivery_window" | "price" | "callback",
      "value": string,
      "quote": string,
      "speaker_role": "agent" | "customer",
      "commitment_level": "firm" | "tentative",
      "order_id": string | null
    }
  ]
}
If there are no commitments, respond with {"commitments": []}.`;

const VALID_FIELDS = new Set(["delivery_day", "delivery_window", "price", "callback"]);
const VALID_SPEAKER_ROLES = new Set(["agent", "customer"]);
const VALID_COMMITMENT_LEVELS = new Set(["firm", "tentative"]);

function isValidCommitment(c: unknown): c is ExtractedCommitment {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.field === "string" &&
    VALID_FIELDS.has(o.field) &&
    typeof o.value === "string" &&
    typeof o.quote === "string" &&
    typeof o.speaker_role === "string" &&
    VALID_SPEAKER_ROLES.has(o.speaker_role) &&
    typeof o.commitment_level === "string" &&
    VALID_COMMITMENT_LEVELS.has(o.commitment_level) &&
    (o.order_id === null || typeof o.order_id === "string")
  );
}

export async function extractCommitments(transcriptText: string): Promise<ExtractedCommitment[]> {
  const completion = await gateway.chat.completions.create({
    model: env.llmGatewayModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcriptText },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return [];

  // Claude via this gateway doesn't fully honor json_object mode — it
  // sometimes wraps the JSON in a ```json ... ``` fence anyway.
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (err) {
    console.error("[extraction] failed to parse LLM Gateway response as JSON:", content, err);
    return [];
  }

  const commitments = (parsed as { commitments?: unknown[] })?.commitments;
  if (!Array.isArray(commitments)) return [];

  const valid = commitments.filter(isValidCommitment);
  if (valid.length !== commitments.length) {
    console.warn(`[extraction] dropped ${commitments.length - valid.length} malformed commitment(s)`, commitments);
  }
  return valid;
}
