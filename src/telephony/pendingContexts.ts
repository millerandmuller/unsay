import type { CallbackContext } from "../agents/callback.js";

// Bridges the gap between "we placed the call" (HTTP, has the context) and
// "Twilio connected the media stream" (WebSocket, needs the context) for
// outbound callback calls. Keyed by our internal call id.
const pending = new Map<string, CallbackContext>();

export function setPendingCallbackContext(callId: string, context: CallbackContext): void {
  pending.set(callId, context);
}

export function takePendingCallbackContext(callId: string): CallbackContext | undefined {
  const ctx = pending.get(callId);
  pending.delete(callId);
  return ctx;
}
