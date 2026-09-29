import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(dirname(env.databasePath), { recursive: true });

export const db = new Database(env.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

export type RegisterStatus = "active" | "broken" | "confirmed" | "superseded" | "needs_human";
export type CommitmentLevel = "firm" | "tentative";
export type SpeakerRole = "agent" | "customer";
export type CallDirection = "inbound" | "outbound";
export type CallPurpose = "order_desk" | "callback" | "browser_fallback";
export type CallStatus = "in_progress" | "completed" | "no_answer" | "failed";

export interface OrderRow {
  order_id: string;
  customer_name: string;
  item: string;
  phone: string;
  delivery_day: string;
  delivery_window: string;
  updated_at: string;
}

export interface FreeSlotRow {
  id: string;
  day: string;
  window: string;
  taken: 0 | 1;
}

export interface CallRow {
  id: string;
  direction: CallDirection;
  purpose: CallPurpose;
  order_id: string | null;
  triggered_by_entry_id: string | null;
  twilio_call_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  status: CallStatus;
  recording_url: string | null;
  recording_path: string | null;
  transcript_words: string | null;
  speech_model_used: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface RegisterEntryRow {
  id: string;
  call_id: string;
  order_id: string | null;
  field: string;
  value: string;
  quote: string;
  speaker_role: SpeakerRole;
  commitment_level: CommitmentLevel;
  start_ms: number | null;
  end_ms: number | null;
  anchor_status: "ok" | "missing";
  status: RegisterStatus;
  broken_at: string | null;
  supersedes_id: string | null;
  created_at: string;
}

export interface TranscriptWord {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker: string;
}
