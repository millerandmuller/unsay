# Unsay

*The voice agent that calls you back when its promise is no longer true.*

Built on AssemblyAI for the AssemblyAI Voice Agent Hackathon (lablab.ai, September 2026).

## The problem

Every business that promises things on the phone — a delivery day, a time window, a price — loses that promise the moment the call ends. Plans change (a truck gets rescheduled, a slot fills up), and nobody calls the customer back before they find out the hard way. A text message asks for silence back; a call gets a confirmed new slot in the same conversation.

## The loop

1. **Gesagt ist gebucht — said is booked.** Every binding promise made on a call becomes a register entry: the value, the exact words, the speaker, and the audio window those words were spoken in. A transcript nobody reads is worthless; a register is.
2. **The proof is the sound, not the summary.** Every entry is playable at the exact second it was said — no waveform, just a play button, a progress bar, and the words highlighted as they're spoken.
3. **The agent corrects itself before the customer notices — and only with what's true.** The moment the source of truth changes, the register entry flips to "broken" and an outbound call goes out on its own. The agent quotes its own earlier promise, offers only what's actually free, and closes the loop with a new, equally-anchored entry.

## Architecture

```
Twilio (inbound + outbound calls, recording)
        │  audio/pcmu (G.711 mu-law, 8kHz) — no transcoding
        ▼
AssemblyAI Voice Agent API (WebSocket)  ──┐
  session.system_prompt / greeting        │  live conversation,
  tools: lookup_order /                   │  both directions
         confirm_new_value /              │
         offer_alternative                │
        └──────────────┬───────────────────┘
                        │ call ends → recording saved
                        ▼
AssemblyAI pre-recorded STT (Universal-3.5 Pro)
  speaker_labels + word-level timestamps + keyterms
                        │
                        ▼
AssemblyAI LLM Gateway (structured output)
  extracts firm commitments as JSON
                        │
                        ▼
Deterministic word-aligner (ours, not the LLM's guess)
  anchors each commitment's quote to real start_ms/end_ms
                        │
                        ▼
Register (SQLite) ←→ Order table / free slots (the "source of truth")
        │
        ▼
UI (SSE live updates): register + editable order table
```

Three AssemblyAI products carry the product, not one:
- **Voice Agent API** — both calls (the order-desk call *and* the self-triggered callback) run through it, including live tool calls.
- **Universal-3.5 Pro (pre-recorded)** — every saved recording is re-transcribed with word-level timestamps and diarization, so the register's audio anchors are exact, not estimated.
- **LLM Gateway** — structured-output extraction of commitments from the transcript, OpenAI-compatible, model configured via `LLM_GATEWAY_MODEL` (no code change to swap models).

## Why these parameters

| Parameter | Value | Why |
|---|---|---|
| `input`/`output.format.encoding` | `audio/pcmu` | Matches Twilio Media Streams' native G.711 mu-law exactly — zero transcoding, lower latency. |
| `system_prompt` (order desk) | fixed | The agent's only job is to look up an order and read back the day/window verbatim — no room to invent one. |
| `system_prompt` (callback) | built per call | Contains the exact old promise (value, quote, time), the new value, and the live list of free slots — the agent can't offer what isn't in the source. |
| `greeting` | set per purpose | The Voice Agent API speaks first as soon as `session.ready` fires — required for the callback to be genuinely self-triggered (nobody dials, nobody clicks). |
| Word-anchoring | our own deterministic matcher, not the LLM's guess | An LLM's own `start`/`end` guess drifts; matching the extracted quote against the *real* word-level transcript never does. If it can't find the quote, the entry ships without a play button rather than a fake one. |

## Honesty (what's curated vs. real)

- The order table (6 rows) and the free-slot list are **curated demo data**, not a real ERP — labeled as such in the UI itself.
- Outbound calls are hard-restricted to a single allowlisted number (`DEMO_CALLEE_NUMBER`) — enforced in code (`isAllowedOutboundNumber`), not just by convention. No call ever goes to a real customer.
- A `CALLS_ENABLED` safety switch defaults to **off**: editing the order table on the public demo URL updates the register visually, but only places a real phone call when a team member has explicitly turned calling on for a rehearsal or recording session.
- Everything else — the phone bridge, the recording, the transcription, the extraction, the word-anchoring, the outbound call itself — is real.

## Setup

```bash
cp .env.example .env   # fill in AssemblyAI + Twilio credentials, see below
npm install
npm run seed            # curated orders + free slots
npm run dev              # local dev server (tsx watch)
```

Required env vars — see `.env.example`. Notably:
- `DEMO_CALLEE_NUMBER` — the only number Unsay is allowed to call.
- `CALLS_ENABLED` — `true` only while actively rehearsing/recording; leave unset/`false` on the public demo URL.
- `PUBLIC_BASE_URL` — must be reachable by Twilio (ngrok locally, the Fly.io URL in production).

After changing `PUBLIC_BASE_URL`, point the Twilio number's Voice webhook at this server:

```bash
npm run configure-twilio
```

### Deploy

```bash
flyctl deploy
```

Long-lived WebSocket connections (Twilio ↔ server ↔ Voice Agent API) rule out serverless — deployed on Fly.io with a persistent volume for the SQLite database and call recordings.

## Tech stack

Node 20, TypeScript, Fastify + `@fastify/websocket`, `better-sqlite3`, vanilla JS/CSS UI with Server-Sent Events for live updates. No build step for the frontend.
