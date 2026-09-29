import { env } from "../config/env.js";
import { getOrder } from "../db/orders.js";
import { createCall, setTwilioCallSid, markCallStatus } from "../db/calls.js";
import { getEntry } from "../register/repository.js";
import { failCallbackAttempt } from "../register/callbackAttempts.js";
import { buildCallbackContext } from "../agents/callback.js";
import { setPendingCallbackContext } from "./pendingContexts.js";
import { placeCall } from "./twilioRest.js";
import { emitEvent } from "../api/events.js";
import type { BrokenPromiseEvent } from "../register/observer.js";

/**
 * F5/F6: places the self-triggered outbound call for a broken promise. Called
 * by the orders API route after claiming the (entryId, newValue) idempotency
 * slot — exactly one call per claimed attempt.
 */
export async function triggerCallback(event: BrokenPromiseEvent, attemptId: string): Promise<void> {
  const entry = getEntry(event.entryId);
  const order = getOrder(event.orderId);
  if (!entry || !order) {
    failCallbackAttempt(attemptId);
    return;
  }

  const context = buildCallbackContext(entry, event.newValue);

  const call = createCall({
    direction: "outbound",
    purpose: "callback",
    order_id: order.order_id,
    triggered_by_entry_id: entry.id,
    from_number: env.twilioPhoneNumber,
    to_number: order.phone,
  });

  setPendingCallbackContext(call.id, context);
  emitEvent({ type: "call_status", callId: call.id, status: "dialing", purpose: "callback", orderId: order.order_id });

  try {
    const sid = await placeCall({
      to: order.phone,
      twimlUrl: `${env.publicBaseUrl}/twilio/voice/outbound-twiml?callId=${call.id}`,
      statusCallbackUrl: `${env.publicBaseUrl}/twilio/status/call?callId=${call.id}`,
    });
    setTwilioCallSid(call.id, sid);
  } catch (err) {
    console.error(`[triggerCallback] failed to place call for entry ${entry.id}:`, err);
    markCallStatus(call.id, "failed");
    failCallbackAttempt(attemptId);
    emitEvent({ type: "call_status", callId: call.id, status: "failed", purpose: "callback", orderId: order.order_id });
  }
}
