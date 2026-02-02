export type AutoCaptureConfig = { maxUpdatesPerTurn: number; dedupThreshold: number };
export type ExtractedKnowledge = { type: "pattern" | "threshold" | "correlation" | "observation"; content: string; confidence: number };

const PATTERN_RE = [/pattern[:\s]+(.+)/gi, /observation[:\s]+(.+)/gi, /(?:consistently|always|typically)\s+(.+)/gi];
const THRESHOLD_RE = [/threshold[:\s]+(.+)/gi, /(?:flag|alert)\s+(?:if|when)\s+(.+)/gi];
const CORRELATION_RE = [/correlat(?:es?|ion)[:\s]+(.+)/gi, /(\w+)\s+(?:leads?|follows?|predicts?)\s+(.+)/gi];

function extract(text: string, regexes: RegExp[], type: ExtractedKnowledge["type"], conf: number): ExtractedKnowledge[] {
  const out: ExtractedKnowledge[] = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m; while ((m = re.exec(text)) !== null) {
      const c = (m[1] ?? m[0]).trim();
      if (c.length > 10) out.push({ type, content: c, confidence: conf });
    }
  }
  return out;
}

export function extractKnowledge(response: string, config: AutoCaptureConfig): ExtractedKnowledge[] {
  const all = [...extract(response, PATTERN_RE, "pattern", 0.6), ...extract(response, THRESHOLD_RE, "threshold", 0.7), ...extract(response, CORRELATION_RE, "correlation", 0.5)];
  const unique: ExtractedKnowledge[] = [];
  for (const item of all) { if (!unique.some(e => e.content.includes(item.content) || item.content.includes(e.content))) unique.push(item); }
  return unique.slice(0, config.maxUpdatesPerTurn);
}
