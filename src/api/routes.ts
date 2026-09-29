import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { listOrders, getOrder, updateOrderField, listFreeSlots } from "../db/orders.js";
import { getCall, getTranscriptWords } from "../db/calls.js";
import { reconcileOrder } from "../register/observer.js";
import { claimCallbackAttempt } from "../register/callbackAttempts.js";
import { triggerCallback } from "../telephony/triggerCallback.js";
import { listRegisterView } from "./register.js";
import { bus, emitEvent, type UnsayEvent } from "./events.js";
import { env } from "../config/env.js";

const EDITABLE_FIELDS = new Set(["delivery_day", "delivery_window"]);

// The order table is shown on the public demo URL (brief F9). Phone numbers
// are real (team allowlist) — never expose them in full to anonymous jury
// visitors, only the last 2 digits so the UI can still say "a real number".
function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, 3)} •••• ${phone.slice(-2)}` : "••••";
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/orders", async () => listOrders().map((o) => ({ ...o, phone: maskPhone(o.phone) })));

  app.get("/api/free-slots", async () => listFreeSlots());

  app.get("/api/register", async () => listRegisterView());

  app.patch("/api/orders/:orderId", async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const body = req.body as Record<string, string>;
    const order = getOrder(orderId);
    if (!order) return reply.code(404).send({ error: "order not found" });

    let updated = order;
    for (const [field, value] of Object.entries(body)) {
      if (!EDITABLE_FIELDS.has(field) || typeof value !== "string" || !value) continue;
      updated = updateOrderField(orderId, field as "delivery_day" | "delivery_window", value);
    }

    // F5 Beobachter: diff against every bound register entry, trigger
    // exactly one callback per (entry, new_value) — idempotency lives in
    // callback_attempts' UNIQUE constraint, not in this handler.
    const events = reconcileOrder(updated);
    if (env.callsEnabled) {
      for (const event of events) {
        const attempt = claimCallbackAttempt(event.entryId, event.newValue);
        if (attempt) {
          void triggerCallback(event, attempt.id);
        }
      }
    } else if (events.length) {
      console.log(`[orders] ${events.length} promise(s) broken but CALLS_ENABLED is off — no call placed`);
    }

    emitEvent({ type: "register_updated" });
    return { order: updated, brokenPromises: events.length };
  });

  // Word-level transcript for the proof-beat: quote text + timing so the UI
  // can highlight words in sync with playback (F7).
  app.get("/api/calls/:callId/words", async (req, reply) => {
    const { callId } = req.params as { callId: string };
    const call = getCall(callId);
    if (!call) return reply.code(404).send({ error: "call not found" });
    return getTranscriptWords(call);
  });

  // Audio playback for the register's play-at-the-second button (F7).
  app.get("/media/recordings/:callId", async (req, reply) => {
    const { callId } = req.params as { callId: string };
    const call = getCall(callId);
    if (!call?.recording_path || !existsSync(call.recording_path)) {
      return reply.code(404).send({ error: "no recording" });
    }
    reply.type("audio/mpeg");
    return reply.send(createReadStream(call.recording_path));
  });

  // Live updates for the UI (register changes, call status, tool calls) —
  // no reload needed (F7 acceptance).
  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(`retry: 2000\n\n`);

    const onEvent = (event: UnsayEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    bus.on("event", onEvent);

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      bus.off("event", onEvent);
    });
  });
}
