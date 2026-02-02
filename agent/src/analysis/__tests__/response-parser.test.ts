import { describe, it, expect } from "vitest";
import { parseAnomalies, ParseError } from "../response-parser.js";

describe("parseAnomalies", () => {
  const sessionId = "session-123";

  it("parses a valid JSON array with one anomaly", () => {
    const text = `\`\`\`json
[
  {
    "severity": "high",
    "source": "yahoo",
    "symbol": "AAPL",
    "description": "Unusual volume spike",
    "metrics": { "volume": 150000000 }
  }
]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe("high");
    expect(result[0]!.source).toBe("yahoo");
    expect(result[0]!.symbol).toBe("AAPL");
    expect(result[0]!.description).toBe("Unusual volume spike");
    expect(result[0]!.metrics.volume).toBe(150000000);
    expect(result[0]!.sessionId).toBe(sessionId);
    expect(result[0]!.id).toBeDefined();
    expect(result[0]!.timestamp).toBeGreaterThan(0);
  });

  it("parses multiple anomalies", () => {
    const text = `\`\`\`json
[
  { "severity": "high", "source": "yahoo", "symbol": "AAPL", "description": "Volume spike", "metrics": { "volume": 150000000 } },
  { "severity": "low", "source": "csv", "description": "Slight price deviation", "metrics": { "close": 184.4 } }
]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(2);
    expect(result[0]!.severity).toBe("high");
    expect(result[1]!.severity).toBe("low");
  });

  it("returns empty array for empty JSON array", () => {
    const text = `\`\`\`json
[]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result).toEqual([]);
  });

  it("extracts JSON from surrounding text", () => {
    const text = `I analyzed the data and found one anomaly:

\`\`\`json
[{ "severity": "medium", "source": "yahoo", "symbol": "GOOG", "description": "RSI divergence", "metrics": { "rsi": 85 } }]
\`\`\`

This indicates overbought conditions.`;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("GOOG");
  });

  it("handles JSON without code fences", () => {
    const text = `[{ "severity": "low", "source": "yahoo", "symbol": "TSLA", "description": "Minor deviation", "metrics": { "close": 240 } }]`;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("TSLA");
  });

  it("assigns unique IDs to each anomaly", () => {
    const text = `\`\`\`json
[
  { "severity": "high", "source": "a", "description": "One", "metrics": {} },
  { "severity": "low", "source": "b", "description": "Two", "metrics": {} }
]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result[0]!.id).not.toBe(result[1]!.id);
  });

  it("assigns preScreenScore of 0 when not in LLM output", () => {
    const text = `\`\`\`json
[{ "severity": "medium", "source": "yahoo", "description": "Test", "metrics": {} }]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result[0]!.preScreenScore).toBe(0);
  });

  it("throws ParseError for completely invalid JSON", () => {
    const text = `This is not JSON at all`;
    expect(() => parseAnomalies(text, sessionId)).toThrow(ParseError);
  });

  it("throws ParseError when JSON is not an array", () => {
    const text = `\`\`\`json
{ "severity": "high", "source": "yahoo", "description": "Not array", "metrics": {} }
\`\`\``;
    expect(() => parseAnomalies(text, sessionId)).toThrow(ParseError);
  });

  it("skips entries with invalid severity and returns valid ones", () => {
    const text = `\`\`\`json
[
  { "severity": "high", "source": "yahoo", "description": "Valid", "metrics": {} },
  { "severity": "extreme", "source": "yahoo", "description": "Bad severity", "metrics": {} },
  { "severity": "low", "source": "yahoo", "description": "Also valid", "metrics": {} }
]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(2);
    expect(result[0]!.description).toBe("Valid");
    expect(result[1]!.description).toBe("Also valid");
  });

  it("skips entries missing required fields", () => {
    const text = `\`\`\`json
[
  { "severity": "high", "source": "yahoo", "description": "Valid", "metrics": {} },
  { "severity": "high", "description": "Missing source" },
  { "source": "yahoo", "description": "Missing severity", "metrics": {} }
]
\`\`\``;
    const result = parseAnomalies(text, sessionId);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe("Valid");
  });
});
