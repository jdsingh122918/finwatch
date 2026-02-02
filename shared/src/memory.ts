export type MemoryEntry = {
  id: string;
  content: string;
  embedding: number[];
  source: string;
  timestamp: number;
  tags: string[];
};

export type SearchResult = {
  entry: MemoryEntry;
  score: number;
  matchType: "vector" | "keyword" | "hybrid";
};

export type DomainPattern = {
  id: string;
  pattern: string;
  confidence: number;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type DomainCorrelation = {
  id: string;
  sourceA: string;
  sourceB: string;
  rule: string;
  confidence: number;
  createdAt: number;
};

export type DomainThreshold = {
  id: string;
  source: string;
  metric: string;
  value: number;
  direction: "above" | "below";
  updatedAt: number;
};

export type MemoryEvent = {
  type: "created" | "updated" | "deleted";
  entryId: string;
  timestamp: number;
};
