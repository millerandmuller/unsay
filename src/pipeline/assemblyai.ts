import { createReadStream, statSync } from "node:fs";
import { env } from "../config/env.js";
import type { TranscriptWord } from "../db/index.js";

const API_BASE = "https://api.assemblyai.com/v2";

async function uploadAudio(filePath: string): Promise<string> {
  const size = statSync(filePath).size;
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: {
      authorization: env.assemblyAiApiKey,
      "content-type": "application/octet-stream",
      "content-length": String(size),
    },
    duplex: "half",
    body: createReadStream(filePath) as unknown as ReadableStream,
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI upload failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { upload_url: string };
  return data.upload_url;
}

interface TranscriptResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  speech_model?: string;
  speech_model_used?: string;
  words?: Array<{ text: string; start: number; end: number; speaker?: string | null }>;
}

async function requestTranscript(uploadUrl: string, keytermsPrompt: string[]): Promise<string> {
  const res = await fetch(`${API_BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: env.assemblyAiApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speech_models: ["universal-3-5-pro"],
      speaker_labels: true,
      keyterms_prompt: keytermsPrompt,
    }),
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI transcript request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TranscriptResponse;
  return data.id;
}

async function pollTranscript(id: string): Promise<TranscriptResponse> {
  const started = Date.now();
  const timeoutMs = 5 * 60_000;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${API_BASE}/transcript/${id}`, {
      headers: { authorization: env.assemblyAiApiKey },
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI transcript poll failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as TranscriptResponse;
    if (data.status === "completed") return data;
    if (data.status === "error") throw new Error(`AssemblyAI transcription error: ${data.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`AssemblyAI transcription timed out after ${timeoutMs}ms (id=${id})`);
}

export interface TranscriptionResult {
  words: TranscriptWord[];
  speechModelUsed: string;
}

/**
 * Pre-recorded transcription of a saved call recording. Universal-3.5 Pro,
 * word-level timestamps + diarization, keyterms for weekdays/names/order ids
 * (brief Section H.T / F3). We transcribe the *saved* recording (not the live
 * stream) so timestamps line up exactly with the audio the UI plays back.
 */
export async function transcribeRecording(filePath: string, keytermsPrompt: string[]): Promise<TranscriptionResult> {
  const uploadUrl = await uploadAudio(filePath);
  const transcriptId = await requestTranscript(uploadUrl, keytermsPrompt);
  const result = await pollTranscript(transcriptId);

  const words: TranscriptWord[] = (result.words ?? []).map((w) => ({
    text: w.text,
    start_ms: w.start,
    end_ms: w.end,
    speaker: w.speaker ?? "?",
  }));

  return {
    words,
    speechModelUsed: result.speech_model_used ?? result.speech_model ?? "universal-3-5-pro",
  };
}
