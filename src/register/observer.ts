import type { OrderRow } from "../db/index.js";
import { listActiveEntriesFor, markActive, markBroken } from "./repository.js";

// Only firm commitments on these fields are watched (brief Section 8: no
// monitoring of "tentative" statements, no monitoring of unlisted fields).
export const MONITORED_FIELDS = ["delivery_day", "delivery_window"] as const;
export type MonitoredField = (typeof MONITORED_FIELDS)[number];

export interface BrokenPromiseEvent {
  entryId: string;
  orderId: string;
  field: MonitoredField;
  oldValue: string;
  newValue: string;
}

/**
 * Diffs an order's current field values against every active/broken register
 * entry bound to (order_id, field). Called after any order edit.
 *
 * - active entry, value differs from the order  -> mark broken, emit event
 * - broken entry, value still differs           -> re-emit (caller de-dupes via callback_attempts)
 * - broken entry, value now matches again        -> revert to active, no call (edge case: cell reverted before the callback connected)
 * - entry value matches order value              -> no-op
 */
export function reconcileOrder(order: OrderRow): BrokenPromiseEvent[] {
  const events: BrokenPromiseEvent[] = [];

  for (const field of MONITORED_FIELDS) {
    const currentValue = order[field];
    const entries = listActiveEntriesFor(order.order_id, field);

    for (const entry of entries) {
      const matches = entry.value === currentValue;

      if (matches) {
        if (entry.status === "broken") {
          markActive(entry.id);
        }
        continue;
      }

      if (entry.status === "active") {
        markBroken(entry.id);
      }
      // status is now (or already was) 'broken' — emit so the caller can
      // claim the idempotency slot for this exact new value.
      events.push({
        entryId: entry.id,
        orderId: order.order_id,
        field,
        oldValue: entry.value,
        newValue: currentValue,
      });
    }
  }

  return events;
}
