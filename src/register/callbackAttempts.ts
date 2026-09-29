import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";

export type CallbackAttemptStatus = "in_progress" | "completed" | "failed";

export interface CallbackAttemptRow {
  id: string;
  entry_id: string;
  new_value: string;
  status: CallbackAttemptStatus;
  call_id: string | null;
  created_at: string;
}

const insertAttempt = db.prepare(`
  INSERT INTO callback_attempts (id, entry_id, new_value, status)
  VALUES (@id, @entry_id, @new_value, 'in_progress')
`);

/**
 * Claims the idempotency slot for (entryId, newValue). Returns the created
 * attempt row, or null if an attempt for this exact (entry, new_value) pair
 * already exists — the UNIQUE constraint is the source of truth, not a
 * SELECT-then-INSERT race.
 */
export function claimCallbackAttempt(entryId: string, newValue: string): CallbackAttemptRow | null {
  const id = randomUUID();
  try {
    insertAttempt.run({ id, entry_id: entryId, new_value: newValue });
  } catch (err: unknown) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return null;
    }
    throw err;
  }
  return db.prepare(`SELECT * FROM callback_attempts WHERE id = ?`).get(id) as CallbackAttemptRow;
}

export function findInProgressAttempt(entryId: string): CallbackAttemptRow | undefined {
  return db
    .prepare(`SELECT * FROM callback_attempts WHERE entry_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`)
    .get(entryId) as CallbackAttemptRow | undefined;
}

export function completeCallbackAttempt(id: string, callId: string): void {
  db.prepare(`UPDATE callback_attempts SET status = 'completed', call_id = ? WHERE id = ?`).run(callId, id);
}

export function failCallbackAttempt(id: string): void {
  db.prepare(`UPDATE callback_attempts SET status = 'failed' WHERE id = ?`).run(id);
}
