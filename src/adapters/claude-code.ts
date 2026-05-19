import { join } from "path";
import { writeTextFile, readTextFile, ensureDir, fileExists } from "../utils/fs";
import matter from "gray-matter";
import type { RuntimeAdapter, ResolvedSkill, ResolvedAgent, WorkspaceModel } from "../types";

const HOOK_EVENT_MAP: Record<string, string> = {
  "session-start": "SessionStart",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  "user-prompt-submit": "UserPromptSubmit",
  stop: "Stop",
};

const GENERATED_MANIFEST = ".prsm/generated-files.json";

async function trackFile(outputBase: string, path: string): Promise<void> {
  const manifestPath = join(outputBase, GENERATED_MANIFEST);
  let files: string[] = [];
  if (await fileExists(manifestPath)) {
    files = JSON.parse(await readTextFile(manifestPath));
  }
  if (!files.includes(path)) {
    files.push(path);
    await ensureDir(join(outputBase, ".prsm"));
    await writeTextFile(manifestPath, JSON.stringify(files, null, 2));
  }
}

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
    const compiled = matter.stringify(skill.content, skill.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackFile(outputBase, outPath);
  }

  async compileAgent(agent: ResolvedAgent, outputBase: string): Promise<void> {
    const outPath = join(this.agentOutputDir(outputBase), `${agent.name}.md`);
    const compiled = matter.stringify(agent.content, agent.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
    await trackFile(outputBase, outPath);
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

    const merged = {
      ...existing,
      hooks: { ...(existing.hooks as Record<string, unknown> ?? {}), ...prsmHooks },
      permissions: {
        ...(existing.permissions as Record<string, unknown> ?? {}),
        allow: model.permissions,
      },
    };

    await ensureDir(join(outputBase, ".claude"));
    await writeTextFile(settingsPath, JSON.stringify(merged, null, 2));
    await trackFile(outputBase, settingsPath);
  }

  async clean(outputBase: string): Promise<void> {
    // Only delete files prsm previously wrote — never touch user-authored files
    const manifestPath = join(outputBase, GENERATED_MANIFEST);
    if (!(await fileExists(manifestPath))) return;

    const { rm } = await import("fs/promises");
    const files: string[] = JSON.parse(await readTextFile(manifestPath));
    for (const f of files) {
      try { await rm(f, { force: true }); } catch {}
    }
    await rm(manifestPath, { force: true });
  }
}
