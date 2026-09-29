import { listEntries } from "../register/repository.js";
import { getLatestCallForEntry } from "../db/calls.js";
import type { RegisterEntryRow } from "../db/index.js";

export interface RegisterEntryView extends RegisterEntryRow {
  callback_call_status: string | null;
  broken_seconds: number | null;
}

/** Joins each entry with its most recent callback call's live status so the
 * UI can show "Calling…" / "Call unanswered" without a second round trip. */
export function listRegisterView(): RegisterEntryView[] {
  return listEntries().map((entry) => {
    const call = getLatestCallForEntry(entry.id);
    const broken_seconds = entry.status === "broken" && entry.broken_at ? Math.floor((Date.now() - Date.parse(entry.broken_at)) / 1000) : null;
    return {
      ...entry,
      callback_call_status: call?.status ?? null,
      broken_seconds,
    };
  });
}
