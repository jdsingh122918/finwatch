import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { SessionTranscriptEntry, SessionKind } from "@finwatch/shared";

export type SessionListEntry = {
  id: string;
  kind: SessionKind;
  timestamp: string;
};

let globalSeq = 0;

export class SessionManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async create(kind: SessionKind): Promise<string> {
    const seq = String(globalSeq++).padStart(6, "0");
    const id = `session-${Date.now()}-${seq}-${crypto.randomBytes(4).toString("hex")}`;
    const filePath = this.getPath(id);
    const timestamp = new Date().toISOString();

    const header: SessionTranscriptEntry = {
      type: "session",
      version: 1,
      id,
      timestamp,
      kind,
    };

    await fs.promises.writeFile(filePath, JSON.stringify(header) + "\n", "utf-8");
    return id;
  }

  async append(sessionId: string, entry: SessionTranscriptEntry): Promise<void> {
    const filePath = this.getPath(sessionId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async read(sessionId: string): Promise<SessionTranscriptEntry[]> {
    const filePath = this.getPath(sessionId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const entries: SessionTranscriptEntry[] = [];

    for (const line of lines) {
      if (line.trim()) {
        entries.push(JSON.parse(line) as SessionTranscriptEntry);
      }
    }

    return entries;
  }

  async list(): Promise<SessionListEntry[]> {
    const files = await fs.promises.readdir(this.baseDir);
    const sessions: SessionListEntry[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = path.join(this.baseDir, file);
      const content = await fs.promises.readFile(filePath, "utf-8");
      const firstLine = content.split("\n")[0];
      if (!firstLine) continue;

      try {
        const header = JSON.parse(firstLine) as SessionTranscriptEntry;
        if (header.type === "session") {
          sessions.push({
            id: header.id,
            kind: header.kind,
            timestamp: header.timestamp,
          });
        }
      } catch {
        // Skip malformed files
      }
    }

    // Sort newest first by ID (contains monotonic timestamp + sequence number)
    sessions.sort((a, b) => b.id.localeCompare(a.id));

    return sessions;
  }

  async rotate(maxSessions: number): Promise<string[]> {
    const sessions = await this.list();

    if (sessions.length <= maxSessions) {
      return [];
    }

    // Sessions are already sorted newest-first, so archive the tail
    const toArchive = sessions.slice(maxSessions);
    const archivedIds: string[] = [];

    for (const session of toArchive) {
      const filePath = this.getPath(session.id);
      await fs.promises.unlink(filePath);
      archivedIds.push(session.id);
    }

    return archivedIds;
  }

  getPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }
}
