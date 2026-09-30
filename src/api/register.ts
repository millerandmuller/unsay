import { listEntries } from "../register/repository.js";
import { getLatestCallForEntry, getCall } from "../db/calls.js";
import { getOrder } from "../db/orders.js";
import type { RegisterEntryRow } from "../db/index.js";

export interface RegisterEntryView extends RegisterEntryRow {
  callback_call_status: string | null;
  broken_seconds: number | null;
  call_started_at: string | null;
  customer_name: string | null;
}

/** Joins each entry with its most recent callback call's live status, the
 * *originating* call's real start time (not this row's own created_at,
 * which can lag on reprocessing), and the customer name — so the UI can
 * show "Calling…" / "Call unanswered" and a correct header without extra
 * round trips. */
export function listRegisterView(): RegisterEntryView[] {
  return listEntries().map((entry) => {
    const call = getLatestCallForEntry(entry.id);
    const broken_seconds = entry.status === "broken" && entry.broken_at ? Math.floor((Date.now() - Date.parse(entry.broken_at)) / 1000) : null;
    const originatingCall = getCall(entry.call_id);
    const order = entry.order_id ? getOrder(entry.order_id) : undefined;
    return {
      ...entry,
      callback_call_status: call?.status ?? null,
      broken_seconds,
      call_started_at: originatingCall?.started_at ?? null,
      customer_name: order?.customer_name ?? null,
    };
  });
}
