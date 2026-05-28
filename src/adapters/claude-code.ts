import { join, dirname } from "path";
import { writeTextFile, readTextFile, ensureDir, fileExists } from "../utils/fs";
import { trackGeneratedFile, cleanGeneratedFiles } from "../utils/generated-files";
import matter from "gray-matter";
import type { RuntimeAdapter, ResolvedSkill, ResolvedAgent, WorkspaceModel, OutputConfig } from "../types";

const HOOK_EVENT_MAP: Record<string, string> = {
  "session-start": "SessionStart",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  "user-prompt-submit": "UserPromptSubmit",
  stop: "Stop",
};

export class ClaudeCodeAdapter implements RuntimeAdapter {
  id = "claude-code";
  displayName = "Claude Code";

  // Output paths honor prsm.yaml's `output.claude-code` block, falling back to
  // the conventional .claude/* locations when unset (#9).
  private skillOutputDir(outputBase: string, output?: OutputConfig): string {
    return join(outputBase, output?.skills ?? ".claude/skills");
  }

  private agentOutputDir(outputBase: string, output?: OutputConfig): string {
    return join(outputBase, output?.agents ?? ".claude/agents");
  }

  async compileSkill(skill: ResolvedSkill, outputBase: string, output?: OutputConfig): Promise<void> {
    const dirName = `hub-${skill.category}-${skill.name}`;
    const outPath = join(this.skillOutputDir(outputBase, output), dirName, "SKILL.md");
    const compiled = matter.stringify(skill.content, skill.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackGeneratedFile(outputBase, this.id, outPath);
  }

  async compileAgent(agent: ResolvedAgent, outputBase: string, output?: OutputConfig): Promise<void> {
    const outPath = join(this.agentOutputDir(outputBase, output), `${agent.name}.md`);
    const compiled = matter.stringify(agent.content, agent.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackGeneratedFile(outputBase, this.id, outPath);
  }

  async generateConfig(model: WorkspaceModel, outputBase: string): Promise<void> {
    const settingsPath = join(outputBase, model.output[this.id]?.settings ?? ".claude/settings.json");

    // Claude Code resolves hooks by matcher group: each event maps to an array
    // of { matcher, hooks: [{ type, command }] } entries. A flat
    // [{ command }] shape is silently ignored — the hook never fires. An empty
    // matcher ("") means "match every invocation", the correct default for
    // events that don't filter by tool (Stop, SessionStart, etc.).
    // See https://code.claude.com/docs/en/hooks#how-a-hook-resolves
    type HookMatcherGroup = {
      matcher: string;
      hooks: Array<{ type: "command"; command: string }>;
    };
    const prsmHooks: Record<string, HookMatcherGroup[]> = {};
    for (const [hookKey, scriptPath] of Object.entries(model.hooks)) {
      if (!scriptPath) continue;
      const eventName = HOOK_EVENT_MAP[hookKey];
      if (!eventName) continue;
      prsmHooks[eventName] = [
        { matcher: "", hooks: [{ type: "command", command: scriptPath }] },
      ];
    }

    // Read existing settings.json and merge — preserve non-prsm keys
    let existing: Record<string, unknown> = {};
    if (await fileExists(settingsPath)) {
      try { existing = JSON.parse(await readTextFile(settingsPath)); } catch {}
    }

    // Merge permissions.allow additively — never replace user-authored entries
    const existingAllow: string[] = Array.isArray((existing.permissions as Record<string, unknown>)?.allow)
      ? (existing.permissions as Record<string, unknown>).allow as string[]
      : [];
    const mergedAllow = [...new Set([...existingAllow, ...model.permissions])];

    const merged = {
      ...existing,
      hooks: { ...(existing.hooks as Record<string, unknown> ?? {}), ...prsmHooks },
      permissions: {
        ...(existing.permissions as Record<string, unknown> ?? {}),
        allow: mergedAllow,
      },
    };

    await ensureDir(dirname(settingsPath));
    await writeTextFile(settingsPath, JSON.stringify(merged, null, 2));
    // settings.json is a shared user file — not tracked as prsm-generated
  }

  async clean(outputBase: string): Promise<void> {
    await cleanGeneratedFiles(outputBase, this.id);
  }
}
