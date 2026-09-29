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

const SCHEMA = {
  name: "commitments",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      commitments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: ["delivery_day", "delivery_window", "price", "callback"] },
            value: { type: "string" },
            quote: { type: "string", description: "Verbatim words spoken, exactly as they appear in the transcript." },
            speaker_role: { type: "string", enum: ["agent", "customer"] },
            commitment_level: {
              type: "string",
              enum: ["firm", "tentative"],
              description: "'firm' only for a definite, binding statement (e.g. 'Thursday, between 8 and 12'). 'tentative' for hedged language (e.g. 'should work Thursday').",
            },
            order_id: { type: ["string", "null"] },
          },
          required: ["field", "value", "quote", "speaker_role", "commitment_level", "order_id"],
        },
      },
    },
    required: ["commitments"],
  },
  strict: true,
} as const;

const SYSTEM_PROMPT = `You extract commitments from a phone call transcript between a furniture delivery voice agent and a customer.
A commitment is a specific, checkable promise about a delivery: which day, which time window, a price, or a promise to call back.
Only extract what was actually said. The "quote" field must be an exact, verbatim substring of the transcript (same words, same order) so it can be located in the word-level transcript later — never paraphrase the quote.
Mark commitment_level "firm" only for a definite statement with no hedging. Mark it "tentative" for hedged language such as "should", "probably", "I think".
If no order id is mentioned, use null.`;

export async function extractCommitments(transcriptText: string): Promise<ExtractedCommitment[]> {
  const completion = await gateway.chat.completions.create({
    model: env.llmGatewayModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcriptText },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return [];

  const parsed = JSON.parse(content) as { commitments: ExtractedCommitment[] };
  return parsed.commitments ?? [];
}
