import { join } from "path";
import { writeTextFile, readTextFile, ensureDir, fileExists } from "../utils/fs";
import { trackGeneratedFile, cleanGeneratedFiles } from "../utils/generated-files";
import matter from "gray-matter";
import type { RuntimeAdapter, ResolvedSkill, ResolvedAgent, WorkspaceModel } from "../types";

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

  private skillOutputDir(outputBase: string): string {
    return join(outputBase, ".claude/skills");
  }

  private agentOutputDir(outputBase: string): string {
    return join(outputBase, ".claude/agents");
  }

  async compileSkill(skill: ResolvedSkill, outputBase: string): Promise<void> {
    const dirName = `hub-${skill.category}-${skill.name}`;
    const outPath = join(this.skillOutputDir(outputBase), dirName, "SKILL.md");
    const compiled = matter.stringify(skill.content, skill.frontmatter as unknown as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackGeneratedFile(outputBase, this.id, outPath);
  }

  async compileAgent(agent: ResolvedAgent, outputBase: string): Promise<void> {
    const outPath = join(this.agentOutputDir(outputBase), `${agent.name}.md`);
    const compiled = matter.stringify(agent.content, agent.frontmatter as unknown as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackGeneratedFile(outputBase, this.id, outPath);
  }

  async generateConfig(model: WorkspaceModel, outputBase: string): Promise<void> {
    const settingsPath = join(outputBase, ".claude/settings.json");

    const prsmHooks: Record<string, Array<{ command: string }>> = {};
    for (const [hookKey, scriptPath] of Object.entries(model.hooks)) {
      if (!scriptPath) continue;
      const eventName = HOOK_EVENT_MAP[hookKey];
      if (!eventName) continue;
      prsmHooks[eventName] = [{ command: scriptPath }];
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

    await ensureDir(join(outputBase, ".claude"));
    await writeTextFile(settingsPath, JSON.stringify(merged, null, 2));
    // settings.json is a shared user file — not tracked as prsm-generated
  }

  async clean(outputBase: string): Promise<void> {
    await cleanGeneratedFiles(outputBase, this.id);
  }
}
