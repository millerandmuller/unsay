import { getCall, setTranscript, getTranscriptWords } from "../db/calls.js";
import { listOrders, getOrder } from "../db/orders.js";
import { createRegisterEntry, getEntry, linkSupersession } from "../register/repository.js";
import type { RegisterEntryRow, TranscriptWord } from "../db/index.js";
import { transcribeRecording } from "./assemblyai.js";
import { extractCommitments } from "./extraction.js";
import { alignQuote } from "./align.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function buildKeytermsPrompt(): string[] {
  const orders = listOrders();
  const names = orders.map((o) => o.customer_name);
  const ids = orders.map((o) => o.order_id);
  return [...WEEKDAYS, ...names, ...ids];
}

function wordsToTranscriptText(words: TranscriptWord[]): string {
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let buffer: string[] = [];

  for (const w of words) {
    if (w.speaker !== currentSpeaker) {
      if (buffer.length) lines.push(`Speaker ${currentSpeaker}: ${buffer.join(" ")}`);
      currentSpeaker = w.speaker;
      buffer = [];
    }
    buffer.push(w.text);
  }
  if (buffer.length) lines.push(`Speaker ${currentSpeaker}: ${buffer.join(" ")}`);

  return lines.join("\n");
}

/**
 * F3 + F4: transcribe a saved recording, extract firm commitments via the
 * LLM Gateway, anchor each one deterministically to the real word timestamps,
 * and persist the firm ones as register entries. Tentative commitments are
 * classified but never persisted — only binding promises get watched
 * (brief Section 8: "Keine Überwachung von tentative-Aussagen").
 */
export async function processCallRecording(callId: string): Promise<RegisterEntryRow[]> {
  const call = getCall(callId);
  if (!call) throw new Error(`Unknown call: ${callId}`);
  if (!call.recording_path) throw new Error(`Call ${callId} has no saved recording yet`);

  const { words, speechModelUsed } = await transcribeRecording(call.recording_path, buildKeytermsPrompt());
  setTranscript(callId, words, speechModelUsed);

  const transcriptText = wordsToTranscriptText(words);
  const commitments = await extractCommitments(transcriptText);

  const created: RegisterEntryRow[] = [];
  for (const commitment of commitments) {
    if (commitment.commitment_level !== "firm") {
      console.log(`[pipeline] skipping tentative commitment: ${commitment.field}=${commitment.value}`);
      continue;
    }

    // The LLM's order_id is free-text and can be malformed (e.g. "1042"
    // instead of "ORD-1042") — never trust it against the orders FK. Only
    // use it if it resolves to a real order; otherwise fall back to the
    // order the call was already bound to (via lookup_order or the
    // triggering register entry).
    const extractedOrderId = commitment.order_id && getOrder(commitment.order_id) ? commitment.order_id : null;

    const anchor = alignQuote(words, commitment.quote);
    const entry = createRegisterEntry({
      call_id: callId,
      order_id: extractedOrderId ?? call.order_id ?? null,
      field: commitment.field,
      value: commitment.value,
      quote: commitment.quote,
      speaker_role: commitment.speaker_role,
      commitment_level: commitment.commitment_level,
      start_ms: anchor?.start_ms ?? null,
      end_ms: anchor?.end_ms ?? null,
    });
    created.push(entry);
  }

  // A callback call that resolved a broken promise: link the new,
  // audio-anchored entry back to the one it supersedes (brief: "die alte
  // Zusage bleibt als superseded stehen"). Require the value to actually
  // differ from the old one — the agent restating its own old promise
  // while explaining a rejection ("I told you Thursday...") extracts as a
  // same-field "firm commitment" too, but that's history, not a resolution.
  if (call.purpose === "callback" && call.triggered_by_entry_id) {
    const triggering = getEntry(call.triggered_by_entry_id);
    if (triggering) {
      const match = created.find(
        (e) => e.order_id === triggering.order_id && e.field === triggering.field && e.value !== triggering.value
      );
      if (match) linkSupersession(match.id, triggering.id);
    }
  }

  return created;
}

export function getWordsForCall(callId: string): TranscriptWord[] {
  const call = getCall(callId);
  if (!call) return [];
  return getTranscriptWords(call);
}
