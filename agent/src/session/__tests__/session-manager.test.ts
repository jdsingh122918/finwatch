import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionTranscriptEntry, AgentMessage } from "@finwatch/shared";
import { SessionManager } from "../session-manager.js";

// Use a temporary directory for tests
const TEST_DIR = path.join(import.meta.dirname ?? ".", ".test-sessions");

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    manager = new SessionManager(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a new session file with header entry", async () => {
    const sessionId = await manager.create("monitor");

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("session");
    if (entries[0]!.type === "session") {
      expect(entries[0]!.id).toBe(sessionId);
      expect(entries[0]!.kind).toBe("monitor");
      expect(entries[0]!.version).toBe(1);
    }
  });

  it("creates sessions with unique ids", async () => {
    const id1 = await manager.create("monitor");
    const id2 = await manager.create("subagent");
    expect(id1).not.toBe(id2);
  });

  it("appends entries to an existing session", async () => {
    const sessionId = await manager.create("monitor");

    const message: AgentMessage = {
      role: "user",
      content: "Analyze AAPL",
      timestamp: Date.now(),
    };

    const entry: SessionTranscriptEntry = {
      type: "message",
      message,
    };

    await manager.append(sessionId, entry);

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.type).toBe("message");
    if (entries[1]!.type === "message") {
      expect(entries[1]!.message.content).toBe("Analyze AAPL");
    }
  });

  it("appends multiple entries in sequence", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "message",
      message: { role: "user", content: "First", timestamp: 1 },
    });
    await manager.append(sessionId, {
      type: "message",
      message: { role: "assistant", content: "Second", timestamp: 2 },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(3); // header + 2 messages
  });

  it("throws when appending to nonexistent session", async () => {
    await expect(
      manager.append("nonexistent", {
        type: "message",
        message: { role: "user", content: "test", timestamp: 1 },
      })
    ).rejects.toThrow("Session not found: nonexistent");
  });

  it("throws when reading nonexistent session", async () => {
    await expect(manager.read("nonexistent")).rejects.toThrow(
      "Session not found: nonexistent"
    );
  });

  it("reads entries as correct types", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "data_tick",
      source: "yahoo",
      payload: {
        sourceId: "yahoo",
        timestamp: Date.now(),
        metrics: { price: 150.25 },
        metadata: {},
      },
    });

    await manager.append(sessionId, {
      type: "anomaly",
      anomaly: {
        id: "anom-1",
        severity: "high",
        source: "yahoo",
        timestamp: Date.now(),
        description: "Price spike",
        metrics: { price: 200 },
        preScreenScore: 0.9,
        sessionId,
      },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(3);
    expect(entries[1]!.type).toBe("data_tick");
    expect(entries[2]!.type).toBe("anomaly");
  });

  it("lists all sessions sorted by creation time (newest first)", async () => {
    const id1 = await manager.create("monitor");
    const id2 = await manager.create("subagent");
    const id3 = await manager.create("improvement");

    const sessions = await manager.list();
    expect(sessions).toHaveLength(3);
    // Newest first
    expect(sessions[0]!.id).toBe(id3);
    expect(sessions[1]!.id).toBe(id2);
    expect(sessions[2]!.id).toBe(id1);
  });

  it("list returns session metadata (id, kind, timestamp)", async () => {
    const id = await manager.create("subagent");
    const sessions = await manager.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(id);
    expect(sessions[0]!.kind).toBe("subagent");
    expect(typeof sessions[0]!.timestamp).toBe("string");
  });

  it("rotates (archives) old sessions beyond max count", async () => {
    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      await manager.create("monitor");
    }

    // Rotate, keeping only 3
    const archived = await manager.rotate(3);

    expect(archived).toHaveLength(2);
    const remaining = await manager.list();
    expect(remaining).toHaveLength(3);
  });

  it("rotate does nothing when count is below max", async () => {
    await manager.create("monitor");
    await manager.create("monitor");

    const archived = await manager.rotate(5);
    expect(archived).toHaveLength(0);

    const remaining = await manager.list();
    expect(remaining).toHaveLength(2);
  });

  it("getPath returns the file path for a session", async () => {
    const id = await manager.create("monitor");
    const filePath = manager.getPath(id);
    expect(filePath).toBe(path.join(TEST_DIR, `${id}.jsonl`));
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("handles entries with special characters in content", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "message",
      message: {
        role: "user",
        content: 'Line1\nLine2\t"quoted"\nLine3',
        timestamp: 1,
      },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(2);
    if (entries[1]!.type === "message") {
      expect(entries[1]!.message.content).toBe('Line1\nLine2\t"quoted"\nLine3');
    }
  });
});
