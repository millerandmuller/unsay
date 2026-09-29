import { randomUUID } from "node:crypto";
import { db, type RegisterEntryRow, type CommitmentLevel, type SpeakerRole } from "../db/index.js";

export interface NewRegisterEntry {
  call_id: string;
  order_id: string | null;
  field: string;
  value: string;
  quote: string;
  speaker_role: SpeakerRole;
  commitment_level: CommitmentLevel;
  start_ms: number | null;
  end_ms: number | null;
  supersedes_id?: string | null;
}

const insertEntry = db.prepare(`
  INSERT INTO register_entries
    (id, call_id, order_id, field, value, quote, speaker_role, commitment_level, start_ms, end_ms, anchor_status, status, supersedes_id)
  VALUES
    (@id, @call_id, @order_id, @field, @value, @quote, @speaker_role, @commitment_level, @start_ms, @end_ms, @anchor_status, 'active', @supersedes_id)
`);

export function createRegisterEntry(entry: NewRegisterEntry): RegisterEntryRow {
  const id = randomUUID();
  const anchor_status = entry.start_ms != null && entry.end_ms != null ? "ok" : "missing";
  insertEntry.run({
    id,
    call_id: entry.call_id,
    order_id: entry.order_id,
    field: entry.field,
    value: entry.value,
    quote: entry.quote,
    speaker_role: entry.speaker_role,
    commitment_level: entry.commitment_level,
    start_ms: entry.start_ms,
    end_ms: entry.end_ms,
    anchor_status,
    supersedes_id: entry.supersedes_id ?? null,
  });
  return getEntry(id)!;
}

export function getEntry(id: string): RegisterEntryRow | undefined {
  return db.prepare(`SELECT * FROM register_entries WHERE id = ?`).get(id) as RegisterEntryRow | undefined;
}

export function listEntries(): RegisterEntryRow[] {
  return db.prepare(`SELECT * FROM register_entries ORDER BY created_at DESC`).all() as RegisterEntryRow[];
}

// 'confirmed' entries are watched too — a re-confirmed promise can still be
// broken by a later order edit. Only 'superseded' and 'needs_human' are terminal.
export function listActiveEntriesFor(orderId: string, field: string): RegisterEntryRow[] {
  return db
    .prepare(`SELECT * FROM register_entries WHERE order_id = ? AND field = ? AND status IN ('active', 'broken', 'confirmed')`)
    .all(orderId, field) as RegisterEntryRow[];
}

export function listEntriesForOrder(orderId: string): RegisterEntryRow[] {
  return db.prepare(`SELECT * FROM register_entries WHERE order_id = ? ORDER BY created_at DESC`).all(orderId) as RegisterEntryRow[];
}

export function markBroken(id: string): void {
  db.prepare(`UPDATE register_entries SET status = 'broken', broken_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
}

export function markActive(id: string): void {
  db.prepare(`UPDATE register_entries SET status = 'active', broken_at = NULL WHERE id = ?`).run(id);
}

export function markConfirmed(id: string): void {
  db.prepare(`UPDATE register_entries SET status = 'confirmed' WHERE id = ?`).run(id);
}

export function markSuperseded(id: string): void {
  db.prepare(`UPDATE register_entries SET status = 'superseded' WHERE id = ?`).run(id);
}

export function markNeedsHuman(id: string): void {
  db.prepare(`UPDATE register_entries SET status = 'needs_human' WHERE id = ?`).run(id);
}

/** Links a freshly-created (pipeline-extracted) entry back to the promise it resolves. */
export function linkSupersession(newEntryId: string, oldEntryId: string): void {
  db.prepare(`UPDATE register_entries SET supersedes_id = ?, status = 'confirmed' WHERE id = ?`).run(oldEntryId, newEntryId);
  markSuperseded(oldEntryId);
}
