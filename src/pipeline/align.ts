import type { TranscriptWord } from "../db/index.js";

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Deterministic word-anchoring (brief F4): never trust the LLM's own
 * start/end guess. Tokenize the quote, slide a window over the real
 * word-level transcript, and anchor on an exact normalized-token match.
 * Returns null if the quote can't be found (edge case 5: "audio anchor
 * missing" — the entry is created without a play button, never shown as
 * anchored).
 */
export function alignQuote(words: TranscriptWord[], quote: string): { start_ms: number; end_ms: number } | null {
  const quoteTokens = quote.split(/\s+/).map(normalize).filter(Boolean);
  if (quoteTokens.length === 0) return null;

  const wordTokens = words.map((w) => normalize(w.text));

  for (let start = 0; start <= wordTokens.length - quoteTokens.length; start++) {
    let matched = true;
    for (let i = 0; i < quoteTokens.length; i++) {
      if (wordTokens[start + i] !== quoteTokens[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const end = start + quoteTokens.length - 1;
      return { start_ms: words[start].start_ms, end_ms: words[end].end_ms };
    }
  }

  return null;
}
