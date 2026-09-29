import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createCall, setTwilioCallSid, markCallStatus, setRecording, getCall } from "../db/calls.js";
import { markNeedsHuman } from "../register/repository.js";
import { failCallbackAttempt, findInProgressAttempt } from "../register/callbackAttempts.js";
import { getResolution, clearResolution } from "./callResolutions.js";
import { startRecordingForCall, downloadRecording } from "./twilioRest.js";
import { runVoiceBridge } from "./mediaBridge.js";
import { takePendingCallbackContext } from "./pendingContexts.js";
import { ORDER_DESK_SYSTEM_PROMPT, ORDER_DESK_GREETING, ORDER_DESK_TOOLS, runOrderDeskTool } from "../agents/orderDesk.js";
import { processCallRecording } from "../pipeline/process.js";
import { emitEvent } from "../api/events.js";
import type { CallRow } from "../db/index.js";

const HOST = env.publicBaseUrl.replace(/^https?:\/\//, "");

function mapTwilioStatus(status: string): CallRow["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "busy":
    case "no-answer":
      return "no_answer";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "in_progress";
  }
}

export async function registerTelephonyRoutes(app: FastifyInstance): Promise<void> {
  // ---- Inbound: Anruf 1, F2 order desk ----
  app.post("/twilio/voice/inbound", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const call = createCall({
      direction: "inbound",
      purpose: "order_desk",
      from_number: body.From,
      to_number: body.To,
    });
    setTwilioCallSid(call.id, body.CallSid);

    try {
      await startRecordingForCall(body.CallSid, `${env.publicBaseUrl}/twilio/status/recording?callId=${call.id}`);
    } catch (err) {
      console.error(`[inbound] failed to start recording for ${call.id}:`, err);
    }

    emitEvent({ type: "call_status", callId: call.id, status: "in_progress", purpose: "order_desk", orderId: null });

    reply.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${HOST}/twilio/media/order-desk/${call.id}" />
  </Connect>
</Response>`
    );
  });

  app.get("/twilio/media/order-desk/:callId", { websocket: true }, (socket, req) => {
    const { callId } = req.params as { callId: string };
    runVoiceBridge(
      socket,
      `order-desk:${callId}`,
      { systemPrompt: ORDER_DESK_SYSTEM_PROMPT, greeting: ORDER_DESK_GREETING, tools: ORDER_DESK_TOOLS },
      (name, args) => runOrderDeskTool(callId, name, args)
    );
  });

  // ---- Outbound: F6 callback, self-triggered ----
  app.post("/twilio/voice/outbound-twiml", async (req, reply) => {
    const { callId } = req.query as { callId: string };
    const body = req.body as Record<string, string>;
    if (body.CallSid) setTwilioCallSid(callId, body.CallSid);

    reply.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${HOST}/twilio/media/callback/${callId}" />
  </Connect>
</Response>`
    );
  });

  app.get("/twilio/media/callback/:callId", { websocket: true }, (socket, req) => {
    const { callId } = req.params as { callId: string };
    const context = takePendingCallbackContext(callId);
    if (!context) {
      console.error(`[callback:${callId}] no pending context — closing`);
      socket.close();
      return;
    }
    const call = getCall(callId);
    runVoiceBridge(
      socket,
      `callback:${callId}`,
      { systemPrompt: context.systemPrompt, greeting: context.greeting, tools: context.tools },
      (name, args) => context.runTool(callId, name, args),
      () => {
        // Hero Moment sync cue (F7): the moment the agent starts speaking,
        // the UI plays the original clip at the exact anchored second.
        emitEvent({
          type: "call_status",
          callId,
          status: "agent_speaking",
          purpose: "callback",
          orderId: call?.order_id ?? null,
          entryId: call?.triggered_by_entry_id ?? null,
        });
      }
    );
  });

  // ---- Status callbacks ----
  app.post("/twilio/status/call", async (req, reply) => {
    const { callId } = req.query as { callId: string };
    const body = req.body as Record<string, string>;
    const call = getCall(callId);
    reply.code(200).send();
    if (!call) return;

    const status = mapTwilioStatus(body.CallStatus);
    markCallStatus(callId, status);
    emitEvent({ type: "call_status", callId, status, purpose: call.purpose, orderId: call.order_id });

    if (call.purpose !== "callback" || status === "in_progress") return;

    if (status === "completed") {
      const resolution = getResolution(callId);
      if (!resolution && call.triggered_by_entry_id) {
        // Customer talked but rejected everything, or the call ended
        // without a tool resolving it — brief edge case 4.
        markNeedsHuman(call.triggered_by_entry_id);
        emitEvent({ type: "register_updated" });
      }
      clearResolution(callId);
      return;
    }

    // no_answer / failed: leave the entry 'broken' (edge case 1 — visible,
    // no auto-retry in the demo), but free the idempotency slot so a genuine
    // future change to the same new_value can retry.
    if (call.triggered_by_entry_id) {
      const attempt = findInProgressAttempt(call.triggered_by_entry_id);
      if (attempt) failCallbackAttempt(attempt.id);
    }
  });

  app.post("/twilio/status/recording", async (req, reply) => {
    const { callId } = req.query as { callId: string };
    const body = req.body as Record<string, string>;
    reply.code(200).send();

    if (body.RecordingStatus !== "completed") return;
    const call = getCall(callId);
    if (!call) return;

    (async () => {
      try {
        const destPath = `${env.recordingsDir}/${callId}.mp3`;
        await downloadRecording(body.RecordingUrl, destPath);
        setRecording(callId, body.RecordingUrl, destPath);
        console.log(`[recording:${callId}] saved, running pipeline...`);
        await processCallRecording(callId);
        emitEvent({ type: "register_updated" });
        console.log(`[recording:${callId}] pipeline done`);
      } catch (err) {
        console.error(`[recording:${callId}] pipeline failed:`, err);
      }
    })();
  });
}
