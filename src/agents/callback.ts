import type { RegisterEntryRow } from "../db/index.js";
import { getOrder, updateOrderField, listFreeSlots, isSlotFree, takeSlot } from "../db/orders.js";
import { getCall } from "../db/calls.js";
import { claimCallbackAttempt, findInProgressAttempt, completeCallbackAttempt } from "../register/callbackAttempts.js";
import { setResolution } from "../telephony/callResolutions.js";
import type { ToolDef } from "../telephony/voiceAgentClient.js";

const FIELD_LABEL: Record<string, string> = {
  delivery_day: "delivery day",
  delivery_window: "delivery time window",
};

const BERLIN_TZ = "Europe/Berlin";

function berlinParts(date: Date): { dateStr: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { dateStr: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function calendarDayDiff(fromDateStr: string, toDateStr: string): number {
  const from = Date.parse(`${fromDateStr}T00:00:00Z`);
  const to = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Lowercase, mid-sentence time phrase for the self-quote ("on Thursday at
 * 7:42 PM" / "last night at 1:41 AM") — always derived from the register
 * entry's own timestamp against the current time, in Europe/Berlin, never
 * hardcoded. "Last night" covers both a promise made earlier the same
 * calendar day before 5am, and one made the previous calendar day after 6pm.
 */
function formatPromiseTime(iso: string, now: Date = new Date()): string {
  const entry = berlinParts(new Date(iso));
  const current = berlinParts(now);
  const diff = calendarDayDiff(entry.dateStr, current.dateStr); // days between entry's day and today

  const isLastNight = (diff === 0 && entry.hour < 5) || (diff === 1 && entry.hour >= 18);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

  if (isLastNight) return `last night at ${time}`;

  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN_TZ, weekday: "long" }).format(new Date(iso));
  return `on ${weekday} at ${time}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatWindow(window: string): string {
  const [start, end] = window.split("-");
  return `between ${start} and ${end}`;
}

function formatSlot(slot: { day: string; window: string }): string {
  return `${slot.day}, ${formatWindow(slot.window)}`;
}

export interface CallbackContext {
  systemPrompt: string;
  greeting: string;
  tools: ToolDef[];
  runTool: (callId: string, name: string, args: Record<string, unknown>) => string;
}

/**
 * F6 Rückruf-Agent. Builds a call-specific system_prompt + greeting from the
 * exact broken promise (brief: "system_prompt enthält alte Zusage, neuen Wert
 * und die Liste freier Slots"). The greeting is the self-quote — the Hero
 * Moment depends on it matching the register entry's own words.
 */
export function buildCallbackContext(entry: RegisterEntryRow, newValue: string): CallbackContext {
  const order = getOrder(entry.order_id ?? "");
  if (!order) throw new Error(`Callback context requires an order (entry ${entry.id})`);
  const orderId = order.order_id;

  // The promise's real timestamp is the call it was made on, not this
  // register row's own created_at (which can lag, e.g. on reprocessing).
  const originatingCall = getCall(entry.call_id);
  const promiseMadeAt = originatingCall?.started_at ?? entry.created_at;

  const firstName = order.customer_name.split(" ")[0];
  const oldWhen = formatPromiseTime(promiseMadeAt); // e.g. "on Thursday at 7:42 PM" or "last night at 1:41 AM"
  const fieldLabel = FIELD_LABEL[entry.field] ?? entry.field;
  const freeSlots = listFreeSlots().filter((s) => s.taken === 0);
  const slotsText = freeSlots.length
    ? freeSlots.map((s) => `${s.id}: ${formatSlot(s)}`).join("; ")
    : "no free slots right now";

  const sameWindowNote = entry.field === "delivery_day" ? ", same window" : "";

  const greeting = `Hi ${firstName}, this is Unsay from Northwind Furniture. This call is recorded so we can keep our promises. ${capitalizeFirst(oldWhen)} I told you your delivery would come ${entry.value}. That's no longer true. It moves to ${newValue}${sameWindowNote}. Does ${newValue} work for you?`;

  const systemPrompt = `You are Unsay, an outbound voice agent for Northwind Furniture calling ${firstName} back because a promise changed.

Exact facts, do not deviate from these:
- Order: ${order.order_id}, ${order.item}
- Old promise (${fieldLabel}): "${entry.value}", made ${oldWhen}, exact words: "${entry.quote}"
- New value: "${newValue}"
- Free alternative slots if ${newValue} does not work: ${slotsText}

Your job:
1. Speak the greeting (already set) — it states the old promise and the new value.
2. If the customer accepts "${newValue}", call confirm_new_value with entry_id="${entry.id}" and value="${newValue}".
3. If the customer wants a different slot, offer ONLY the free slots listed above by id, and call offer_alternative with entry_id="${entry.id}" and the chosen slot_id. Never invent a slot that is not in that list.
4. If the customer rejects every option, tell them a team member will follow up personally, thank them, and end the call. Do not call any tool in that case.

Keep responses short, one or two sentences, since they are spoken aloud. Be direct and take responsibility — never say "unfortunately" or apologize excessively. Do not offer anything not in the facts above.`;

  const tools: ToolDef[] = [
    {
      type: "function",
      name: "confirm_new_value",
      description: "Confirm the customer accepts the new value stated in the greeting.",
      parameters: {
        type: "object",
        properties: {
          entry_id: { type: "string" },
          value: { type: "string" },
        },
        required: ["entry_id", "value"],
      },
    },
    {
      type: "function",
      name: "offer_alternative",
      description: "Book a free alternative slot the customer chose instead of the new value.",
      parameters: {
        type: "object",
        properties: {
          entry_id: { type: "string" },
          slot_id: { type: "string" },
        },
        required: ["entry_id", "slot_id"],
      },
    },
  ];

  function runTool(callId: string, name: string, args: Record<string, unknown>): string {
    if (name === "confirm_new_value") {
      const value = String(args.value ?? "");
      const current = getOrder(orderId)![entry.field as "delivery_day" | "delivery_window"];
      // Compare loosely — the value came through an LLM tool call, not a
      // fixed enum, so it can differ from the source by case, whitespace,
      // or trailing punctuation ("Monday" vs "monday." vs " Monday ")
      // without meaning anything different.
      if (value.trim().toLowerCase() !== current.trim().toLowerCase()) {
        return JSON.stringify({ ok: false, reason: "value_no_longer_current" });
      }
      resolveEntry(entry, callId, current);
      return JSON.stringify({ ok: true });
    }

    if (name === "offer_alternative") {
      const slotId = String(args.slot_id ?? "");
      if (!isSlotFree(slotId)) {
        return JSON.stringify({ ok: false, reason: "slot_not_free" });
      }
      const slot = freeSlots.find((s) => s.id === slotId);
      if (!slot) {
        return JSON.stringify({ ok: false, reason: "unknown_slot" });
      }
      takeSlot(slotId);
      updateOrderField(orderId, "delivery_day", slot.day);
      updateOrderField(orderId, "delivery_window", slot.window);
      resolveEntry(entry, callId, slot.day);
      return JSON.stringify({ ok: true, day: slot.day, window: slot.window });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  return { systemPrompt, greeting, tools, runTool };
}

function resolveEntry(entry: RegisterEntryRow, callId: string, value: string): void {
  setResolution(callId, { entryId: entry.id, status: "confirmed", value });
  const attempt = findInProgressAttempt(entry.id);
  if (attempt) completeCallbackAttempt(attempt.id, callId);
}

export { claimCallbackAttempt };
