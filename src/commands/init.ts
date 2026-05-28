import { Command } from "commander";
import { writeTextFile, ensureDir, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";

const TEMPLATE_MANIFEST = (name: string) => `name: ${name}
version: 1.0.0
author: ""

runtimes:
  - claude-code

extends: []

dependencies: {}

hooks:
  session-start: hooks/session-start.sh
  pre-tool-use: hooks/pretool-safety.sh
  stop: hooks/session-stop.sh

repos: {}

output:
  claude-code:
    skills: .claude/skills/
    agents: .claude/agents/
    settings: .claude/settings.json
`;

const TEMPLATE_HOOK = `#!/bin/bash
# prsm hook — customize this script for your workflow
`;

const TEMPLATE_SKILL = `---
name: my-skill
description: A sample skill
category: general
triggers:
  - invoke my skill
runtimes:
  - claude-code
tools:
  - Read
  - Write
  - Bash
---

# My Skill

Describe what this skill does here.
`;

export function initCommand(): Command {
  return new Command("init")
    .description("Scaffold a new prsm workspace")
    .argument("[name]", "workspace name", "my-workspace")
    .option("--from-claude-dir <path>", "migrate from existing .claude/ directory")
    .action(async (name: string, options: { fromClaudeDir?: string }) => {
      const target = join(process.cwd(), name);

      if (options.fromClaudeDir) {
        logger.error("--from-claude-dir migration not yet implemented. Coming in a later release.");
        process.exit(1);
      }

      if (await fileExists(join(target, "prsm.yaml"))) {
        logger.warn(`${target} already has a prsm.yaml. Aborting.`);
        process.exit(1);
      }

      await ensureDir(target);
      await writeTextFile(join(target, "prsm.yaml"), TEMPLATE_MANIFEST(name));
      await ensureDir(join(target, "skills/general/my-skill"));
      await writeTextFile(join(target, "skills/general/my-skill/SKILL.md"), TEMPLATE_SKILL);
      await ensureDir(join(target, "hooks"));
      for (const h of ["session-start.sh", "pretool-safety.sh", "session-stop.sh"]) {
        await writeTextFile(join(target, "hooks", h), TEMPLATE_HOOK);
      }
      await ensureDir(join(target, "agents"));
      await writeTextFile(join(target, ".gitignore"), ".prsm/\nnode_modules/\n");

      logger.success(`Workspace "${name}" created at ${target}`);
      logger.info(`Next: cd ${name} && prsm build`);
    });
}
