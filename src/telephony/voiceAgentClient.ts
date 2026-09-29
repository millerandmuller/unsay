import WebSocket from "ws";
import { env } from "../config/env.js";

// Confirmed against AssemblyAI/voice-agent-api-twilio-example (read for
// protocol reference only, not copied — its LICENSE is unclear, see brief
// Section H.T). Endpoint, session.update shape, and event names below are
// verbatim from that reference. `turn_detection` is from the brief's H.T
// live-doc summary (not present in the reference repo) — verify the exact
// field names against the docs on the first real spike call; unknown fields
// are expected to be ignored rather than rejected.
const AAI_AGENT_URL = process.env.AAI_AGENT_URL || "wss://agents.assemblyai.com/v1/realtime";

export interface TurnDetectionConfig {
  vad_threshold?: number;
  min_silence?: number;
  max_silence?: number;
  interrupt_response?: boolean;
}

export interface ToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceAgentSessionOptions {
  systemPrompt: string;
  greeting: string;
  voice?: string;
  tools?: ToolDef[];
  turnDetection?: TurnDetectionConfig;
}

export interface VoiceAgentHandlers {
  onReady?: (sessionId: string) => void;
  onReplyAudio: (base64Payload: string) => void;
  onSpeechStarted: () => void;
  onToolCall?: (name: string, args: Record<string, unknown>, callId: string) => Promise<string>;
  onTranscript?: (role: "user" | "agent", text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

function buildSessionUpdate(opts: VoiceAgentSessionOptions) {
  return {
    type: "session.update",
    session: {
      system_prompt: opts.systemPrompt,
      greeting: opts.greeting,
      input: { type: "audio", format: { encoding: "audio/pcmu" } },
      output: {
        type: "audio",
        voice: opts.voice ?? env.voiceAgentVoice,
        format: { encoding: "audio/pcmu" },
      },
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.turnDetection ? { turn_detection: opts.turnDetection } : {}),
    },
  };
}

export interface VoiceAgentConnection {
  sendAudio: (base64Payload: string) => void;
  close: () => void;
}

export function connectVoiceAgent(opts: VoiceAgentSessionOptions, handlers: VoiceAgentHandlers): VoiceAgentConnection {
  const ws = new WebSocket(AAI_AGENT_URL, {
    headers: { Authorization: `Bearer ${env.assemblyAiApiKey}` },
  });

  let ready = false;

  ws.on("open", () => {
    ws.send(JSON.stringify(buildSessionUpdate(opts)));
  });

  ws.on("message", (data) => {
    let event: any;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    // Server-side error events arrive without a `type` field.
    if (event.type === undefined && event.code) event.type = "session.error";

    switch (event.type) {
      case "session.ready":
        ready = true;
        handlers.onReady?.(event.session_id);
        break;
      case "reply.audio":
        if (event.data) handlers.onReplyAudio(event.data);
        break;
      case "input.speech.started":
        handlers.onSpeechStarted();
        break;
      case "transcript.user":
        if (event.text) handlers.onTranscript?.("user", event.text);
        break;
      case "transcript.agent":
        if (event.text) handlers.onTranscript?.("agent", event.text);
        break;
      case "tool.call": {
        const name: string = event.name ?? "";
        const rawArgs = event.args;
        const args: Record<string, unknown> =
          typeof rawArgs === "string" ? safeParseJson(rawArgs) : rawArgs && typeof rawArgs === "object" ? rawArgs : {};
        if (handlers.onToolCall) {
          handlers.onToolCall(name, args, event.call_id).then((result) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "tool.result", call_id: event.call_id, result, is_error: false }));
            }
          });
        }
        break;
      }
      case "session.error":
      case "error":
        handlers.onError?.(`${event.code ?? ""} ${event.message ?? JSON.stringify(event)}`);
        break;
    }
  });

  ws.on("close", () => handlers.onClose?.());
  ws.on("error", (e) => handlers.onError?.(String(e)));

  return {
    sendAudio(base64Payload: string) {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input.audio", audio: base64Payload }));
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
