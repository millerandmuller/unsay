// Twilio Media Streams message types (WebSocket). Both directions use
// audio/x-mulaw (G.711 mu-law) at 8kHz — this matches the Voice Agent API's
// audio/pcmu encoding exactly, so audio is forwarded with no transcoding.
export type TwilioInboundMessage =
  | { event: "connected"; protocol: string; version: string }
  | {
      event: "start";
      sequenceNumber: number;
      start: {
        streamSid: string;
        accountSid: string;
        callSid: string;
        tracks: ("inbound" | "outbound")[];
        mediaFormat: { encoding: string; sampleRate: number; channels: number };
        customParameters?: Record<string, string>;
      };
    }
  | { event: "media"; sequenceNumber: number; streamSid: string; media: { track: string; chunk: string; timestamp: string; payload: string } }
  | { event: "mark"; sequenceNumber: number; streamSid: string; mark: { name: string } }
  | { event: "stop"; sequenceNumber: number; streamSid: string; stop: { accountSid: string; callSid: string } };

export type TwilioOutboundMessage =
  | { event: "media"; streamSid: string; media: { payload: string } }
  | { event: "clear"; streamSid: string }
  | { event: "mark"; streamSid: string; mark: { name: string } };
