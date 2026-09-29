import { randomUUID } from "node:crypto";
import { db, type CallRow, type CallDirection, type CallPurpose, type TranscriptWord } from "./index.js";

export interface NewCall {
  direction: CallDirection;
  purpose: CallPurpose;
  order_id?: string | null;
  triggered_by_entry_id?: string | null;
  from_number?: string | null;
  to_number?: string | null;
}

const insertCall = db.prepare(`
  INSERT INTO calls (id, direction, purpose, order_id, triggered_by_entry_id, from_number, to_number, status)
  VALUES (@id, @direction, @purpose, @order_id, @triggered_by_entry_id, @from_number, @to_number, 'in_progress')
`);

export function createCall(call: NewCall): CallRow {
  const id = randomUUID();
  insertCall.run({
    id,
    direction: call.direction,
    purpose: call.purpose,
    order_id: call.order_id ?? null,
    triggered_by_entry_id: call.triggered_by_entry_id ?? null,
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? null,
  });
  return getCall(id)!;
}

export function getCall(id: string): CallRow | undefined {
  return db.prepare(`SELECT * FROM calls WHERE id = ?`).get(id) as CallRow | undefined;
}

export function setCallOrder(id: string, orderId: string): void {
  db.prepare(`UPDATE calls SET order_id = ? WHERE id = ?`).run(orderId, id);
}

export function setTwilioCallSid(id: string, sid: string): void {
  db.prepare(`UPDATE calls SET twilio_call_sid = ? WHERE id = ?`).run(sid, id);
}

export function getLatestCallForEntry(entryId: string): CallRow | undefined {
  return db
    .prepare(`SELECT * FROM calls WHERE triggered_by_entry_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(entryId) as CallRow | undefined;
}

export function getCallByTwilioSid(sid: string): CallRow | undefined {
  return db.prepare(`SELECT * FROM calls WHERE twilio_call_sid = ?`).get(sid) as CallRow | undefined;
}

export function markCallStatus(id: string, status: CallRow["status"]): void {
  const endedAt = status === "in_progress" ? null : new Date().toISOString();
  db.prepare(`UPDATE calls SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?`).run(status, endedAt, id);
}

export function setRecording(id: string, recordingUrl: string, recordingPath: string): void {
  db.prepare(`UPDATE calls SET recording_url = ?, recording_path = ? WHERE id = ?`).run(recordingUrl, recordingPath, id);
}

export function setTranscript(id: string, words: TranscriptWord[], speechModelUsed: string): void {
  db.prepare(`UPDATE calls SET transcript_words = ?, speech_model_used = ? WHERE id = ?`).run(
    JSON.stringify(words),
    speechModelUsed,
    id
  );
}

export function getTranscriptWords(call: CallRow): TranscriptWord[] {
  if (!call.transcript_words) return [];
  return JSON.parse(call.transcript_words) as TranscriptWord[];
}
