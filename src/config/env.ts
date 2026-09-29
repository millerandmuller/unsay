import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  assemblyAiApiKey: required("ASSEMBLYAI_API_KEY"),
  llmGatewayModel: required("LLM_GATEWAY_MODEL"),
  voiceAgentVoice: process.env.VOICE_AGENT_VOICE || "ivy",

  twilioAccountSid: required("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: required("TWILIO_AUTH_TOKEN"),
  twilioPhoneNumber: required("TWILIO_PHONE_NUMBER"),

  // Allowlist of numbers Unsay is permitted to call outbound. Dealbreaker (brief Section 8):
  // no outbound call to any number outside this list, ever — including on the live demo URL.
  demoCalleeNumber: required("DEMO_CALLEE_NUMBER"),

  publicBaseUrl: required("PUBLIC_BASE_URL").replace(/\/$/, ""),
  port: Number(process.env.PORT || 8080),
  databasePath: process.env.DATABASE_PATH || "./data/unsay.db",
  recordingsDir: process.env.RECORDINGS_DIR || "./recordings",

  // Safety gate (brief F9: "Anrufe nur nach Freischaltung" — the live demo
  // URL is public, so editing the order table must NOT place a real call to
  // the team's phone by default). Defaults to false/off on purpose. Set
  // CALLS_ENABLED=true in product/.env only while actively rehearsing or
  // recording the demo; leave it off while the URL is public for judging.
  callsEnabled: process.env.CALLS_ENABLED === "true",
};

export const OUTBOUND_ALLOWLIST = new Set([env.demoCalleeNumber]);

export function isAllowedOutboundNumber(number: string): boolean {
  return OUTBOUND_ALLOWLIST.has(number);
}
