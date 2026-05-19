import type { RuntimeAdapter } from "../types";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";

const registry = new Map<string, RuntimeAdapter>([
  ["claude-code", new ClaudeCodeAdapter()],
  ["codex", new CodexAdapter()],
]);

export function getAdapter(id: string): RuntimeAdapter {
  const adapter = registry.get(id);
  if (!adapter) {
    throw new Error(`Unknown runtime "${id}". Available: ${[...registry.keys()].join(", ")}`);
  }
  return adapter;
}

export function listAdapters(): RuntimeAdapter[] {
  return [...registry.values()];
}
