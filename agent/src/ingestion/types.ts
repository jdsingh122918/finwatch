import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";

export interface DataSource {
  readonly id: string;
  readonly config: SourceConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<SourceHealth>;
  fetch(): Promise<DataTick[]>;
}
