import { EventEmitter } from "node:events";

export type UnsayEvent =
  | { type: "register_updated" }
  | { type: "call_status"; callId: string; status: string; purpose: string; orderId: string | null; entryId?: string | null }
  | { type: "tool_call"; callId: string; name: string; args: unknown; result: unknown };

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitEvent(event: UnsayEvent): void {
  bus.emit("event", event);
}
