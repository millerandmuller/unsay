import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import Twilio from "twilio";
import { env, isAllowedOutboundNumber } from "../config/env.js";

export const twilioClient = Twilio(env.twilioAccountSid, env.twilioAuthToken);

export interface PlaceCallOptions {
  to: string;
  twimlUrl: string;
  statusCallbackUrl: string;
}

/**
 * Places an outbound call. Hard-blocks any number outside the demo
 * allowlist (brief Section 8 dealbreaker) — this check is enforced here,
 * not just at the caller, so there is exactly one place that can dial out.
 */
export async function placeCall(opts: PlaceCallOptions): Promise<string> {
  if (!isAllowedOutboundNumber(opts.to)) {
    throw new Error(`Refusing to call ${opts.to}: not on the outbound allowlist`);
  }
  const call = await twilioClient.calls.create({
    to: opts.to,
    from: env.twilioPhoneNumber,
    url: opts.twimlUrl,
    record: true,
    recordingChannels: "mono",
    statusCallback: opts.statusCallbackUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    timeout: 20,
  });
  return call.sid;
}

/** Starts call-level recording for a live inbound call (REST, not TwiML — <Connect><Stream> hands the call off and never returns to run a <Record> verb). */
export async function startRecordingForCall(callSid: string, recordingStatusCallbackUrl: string): Promise<void> {
  await twilioClient.calls(callSid).recordings.create({
    recordingChannels: "mono",
    recordingStatusCallback: recordingStatusCallbackUrl,
    recordingStatusCallbackEvent: ["completed"],
  });
}

export async function downloadRecording(recordingUrl: string, destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64");
  const res = await fetch(`${recordingUrl}.mp3`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download recording ${recordingUrl}: ${res.status}`);
  }
  const fileStream = createWriteStream(destPath);
  await finished(Readable.fromWeb(res.body as any).pipe(fileStream));
}
