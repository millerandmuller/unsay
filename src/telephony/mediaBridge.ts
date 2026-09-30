import type { WebSocket } from "ws";
import { connectVoiceAgent, type VoiceAgentSessionOptions } from "./voiceAgentClient.js";
import type { TwilioInboundMessage } from "./twilioStream.js";

export type ToolRunner = (name: string, args: Record<string, unknown>) => string;

/**
 * Bridges a Twilio Media Stream WebSocket to a Voice Agent API session.
 * Both legs speak audio/pcmu, so audio is forwarded byte-for-byte — no
 * transcoding. Barge-in: input.speech.started -> Twilio `clear`.
 */
export function runVoiceBridge(
  twilioWs: WebSocket,
  logLabel: string,
  sessionOptions: VoiceAgentSessionOptions,
  runTool: ToolRunner,
  onFirstAgentAudio?: () => void,
  onTwilioStart?: (callSid: string) => void
): void {
  let streamSid: string | undefined;
  let firstAudioFired = false;

  const agent = connectVoiceAgent(sessionOptions, {
    onReady: (sessionId) => console.log(`[${logLabel}] voice-agent session ready (${sessionId})`),
    onReplyAudio: (payload) => {
      if (!streamSid) return;
      twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
      if (!firstAudioFired) {
        firstAudioFired = true;
        onFirstAgentAudio?.();
      }
    },
    onSpeechStarted: () => {
      if (streamSid) twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
    },
    onToolCall: async (name, args) => runTool(name, args),
    onTranscript: (role, text) => console.log(`[${logLabel}] ${role}: "${text}"`),
    onError: (message) => console.error(`[${logLabel}] voice-agent error: ${message}`),
    onClose: (code, reason) => console.log(`[${logLabel}] voice-agent closed, code=${code} reason="${reason}"`),
  });

  twilioWs.on("message", (data) => {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      console.log(`[${logLabel}] twilio stream started (${streamSid}), callSid=${msg.start.callSid}`);
      // The stream only starts once Twilio has actually connected the call —
      // this is the first point where call-level actions (like starting a
      // recording) are guaranteed to be valid (Twilio error 21220 otherwise).
      onTwilioStart?.(msg.start.callSid);
    } else if (msg.event === "media") {
      if (msg.media.track === "inbound") agent.sendAudio(msg.media.payload);
    } else if (msg.event === "stop") {
      console.log(`[${logLabel}] twilio stream stopped`);
      agent.close();
    }
  });

  twilioWs.on("close", (code, reason) => {
    console.log(`[${logLabel}] twilio websocket closed, code=${code} reason="${reason?.toString() || ""}"`);
    agent.close();
  });
}
