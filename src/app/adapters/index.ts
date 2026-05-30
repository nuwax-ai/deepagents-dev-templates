/**
 * Data Format Adapters
 *
 * Transform data between different formats used by the agent,
 * platform APIs, and MCP tools.
 *
 * @scaffold — Not yet wired. This module provides extension points for
 * future data transformation needs. Currently has zero consumers.
 * Remove or implement as needed.
 */

export interface DataAdapter<TInput = unknown, TOutput = unknown> {
  name: string;
  from: string;
  to: string;
  transform: (input: TInput) => TOutput;
}

const adapters: DataAdapter[] = [];

export function registerAdapter(adapter: DataAdapter): void {
  adapters.push(adapter);
}

export function findAdapter(from: string, to: string): DataAdapter | undefined {
  return adapters.find((a) => a.from === from && a.to === to);
}

export function listAdapters(): DataAdapter[] {
  return [...adapters];
}
