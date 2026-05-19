# prsm CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the prsm CLI — a Bun/TypeScript tool that compiles canonical skill/agent/hook manifests to Claude Code and Codex runtime outputs with lockfile-backed reproducibility.

**Architecture:** Parse `prsm.yaml` + skill/agent markdown files → resolve preset extends chains → merge layers (last wins) → dispatch to runtime adapters that write `.claude/` or `.agents/` output dirs. Only adapters are runtime-specific; everything upstream is runtime-agnostic.

**Tech Stack:** Bun, TypeScript, commander, zod, js-yaml, chalk, semver, gray-matter (frontmatter parsing), bun:test

---

## File Map

```
src/
  cli.ts                         # entry point, commander setup
  types.ts                       # all shared TS types
  commands/
    init.ts                      # prsm init [name] [--from-claude-dir]
    build.ts                     # prsm build
    install.ts                   # prsm install
    validate.ts                  # prsm validate
    list.ts                      # prsm list
    explain.ts                   # prsm explain <skill>
    doctor.ts                    # prsm doctor
    context.ts                   # prsm context <repo>
    sync.ts                      # prsm sync
    diff.ts                      # prsm diff [--cross-repo]
    eject.ts                     # prsm eject [preset-name]
  core/
    manifest.ts                  # prsm.yaml parse + zod schema
    skill.ts                     # SKILL.md frontmatter parse
    agent.ts                     # AGENT.md frontmatter parse
    preset.ts                    # preset.yaml parse
    workspace.ts                 # workspace discovery + load
    lockfile.ts                  # prsm.lock read/write
    repo-map.ts                  # repo-mapping helpers
  adapters/
    index.ts                     # RuntimeAdapter interface + registry
    claude-code.ts               # .claude/ output
    codex.ts                     # .agents/ output
  compiler/
    index.ts                     # build orchestration
    merger.ts                    # preset layer merge (last wins)
  validators/
    dependencies.ts              # required:true presence check
  utils/
    fs.ts                        # file system helpers
    logger.ts                    # chalk logger
    checksum.ts                  # sha256 helpers
    yaml.ts                      # js-yaml wrappers

tests/
  unit/
    core/manifest.test.ts
    core/skill.test.ts
    core/lockfile.test.ts
    compiler/merger.test.ts
    validators/dependencies.test.ts
    adapters/claude-code.test.ts
    adapters/codex.test.ts
  integration/
    build.test.ts
    install.test.ts
    validate.test.ts
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `.gitignore`

- [ ] **Step 1: Write failing test for CLI entry**

```ts
// tests/unit/cli.test.ts
import { describe, it, expect } from "bun:test";

describe("cli entry", () => {
  it("exports a main function", async () => {
    const mod = await import("../../src/cli");
    expect(typeof mod.main).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/cli.test.ts
```
Expected: `Cannot find module '../../src/cli'`

- [ ] **Step 3: Create package.json**

```json
{
  "name": "@prsm/prsm",
  "version": "1.0.0",
  "description": "Wire your AI stack once, deploy to any runtime.",
  "bin": { "prsm": "./dist/cli.js" },
  "scripts": {
    "build": "bun build src/cli.ts --compile --outfile dist/prsm",
    "build:bundle": "bun build src/cli.ts --outfile dist/cli.js --target bun",
    "test": "bun test",
    "dev": "bun run src/cli.ts"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0",
    "semver": "^7.6.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/semver": "^7.5.8",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 5: Create src/cli.ts**

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("prsm")
  .description("Wire your AI stack once, deploy to any runtime.")
  .version("1.0.0");

export async function main() {
  await program.parseAsync(process.argv);
}

main();
```

- [ ] **Step 6: Install dependencies**

```bash
bun install
```

- [ ] **Step 7: Run test to verify it passes**

```bash
bun test tests/unit/cli.test.ts
```
Expected: PASS

- [ ] **Step 8: Update .gitignore**

```
node_modules/
dist/
.prsm/
*.lock.bak
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json src/cli.ts .gitignore tests/unit/cli.test.ts
git commit -m "feat: project scaffold — Bun CLI entry point"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/types.test.ts
import { describe, it, expect } from "bun:test";
import type { WorkspaceManifest, ResolvedSkill, ResolvedAgent } from "../../src/types";

describe("types", () => {
  it("WorkspaceManifest shape is correct", () => {
    const manifest: WorkspaceManifest = {
      name: "my-hub",
      version: "1.0.0",
      runtimes: ["claude-code"],
      skills: [],
      agents: [],
      hooks: {},
      repos: {},
      extends: [],
      output: {},
    };
    expect(manifest.name).toBe("my-hub");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/types.test.ts
```
Expected: `Cannot find module '../../src/types'`

- [ ] **Step 3: Create src/types.ts**

```ts
export type Runtime = "claude-code" | "codex";

export interface SkillRef {
  path: string;
}

export interface AgentRef {
  path: string;
}

export interface RepoEntry {
  path: string;
  org?: string;
  default_branch?: string;
}

export type RepoMap = Record<string, Record<string, RepoEntry>>;

export interface HooksConfig {
  "session-start"?: string;
  "pre-tool-use"?: string;
  "post-tool-use"?: string;
  "user-prompt-submit"?: string;
  stop?: string;
}

export interface OutputConfig {
  skills?: string;
  agents?: string;
  settings?: string;
}

export interface WorkspaceManifest {
  name: string;
  version: string;
  author?: string;
  runtimes: Runtime[];
  extends: string[];
  dependencies: Record<string, string>;
  skills: SkillRef[];
  agents: AgentRef[];
  hooks: HooksConfig;
  repos: RepoMap;
  output: Record<Runtime, OutputConfig>;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  category?: string;
  triggers?: string[];
  runtimes?: Runtime[];
  tools?: string[];
  "cross-repo"?: boolean;
  dependencies?: Record<string, SkillDependency>;
}

export interface SkillDependency {
  type: "skill" | "plugin" | "library";
  source: "local" | "remote" | "package-manager";
  version?: string;
  platforms?: Runtime[];
  required: boolean;
}

export interface AgentFrontmatter {
  name: string;
  description: string;
  version?: string;
  model?: string;
  color?: string;
  tools?: string[];
  runtimes?: Runtime[];
}

export interface ResolvedSkill {
  name: string;
  category: string;
  frontmatter: SkillFrontmatter;
  content: string;
  sourcePath: string;
  origin: "local" | "preset";
  originDetail: string;
}

export interface ResolvedAgent {
  name: string;
  frontmatter: AgentFrontmatter;
  content: string;
  sourcePath: string;
  origin: "local" | "preset";
  originDetail: string;
}

export interface ResolvedHooks {
  "session-start"?: string;
  "pre-tool-use"?: string;
  "post-tool-use"?: string;
  "user-prompt-submit"?: string;
  stop?: string;
}

export interface WorkspaceModel {
  name: string;
  version: string;
  runtimes: Runtime[];
  skills: ResolvedSkill[];
  agents: ResolvedAgent[];
  hooks: ResolvedHooks;
  permissions: string[];
  repos: RepoMap;
  output: Record<string, OutputConfig>;
}

export interface PresetManifest {
  name: string;
  version: string;
  description?: string;
  extends?: string[];
  skills?: string[];
  agents?: string[];
  hooks?: HooksConfig;
  permissions?: string[];
}

export interface LockEntry {
  version: string;
  url: string;
  checksum: string;
}

export interface LockFile {
  version: 1;
  presets: Record<string, LockEntry>;
  resolvedAt: string;
}

export interface RuntimeAdapter {
  id: string;
  displayName: string;
  compileSkill(skill: ResolvedSkill, outputBase: string): Promise<void>;
  compileAgent(agent: ResolvedAgent, outputBase: string): Promise<void>;
  generateConfig(model: WorkspaceModel, outputBase: string): Promise<void>;
  clean(outputBase: string): Promise<void>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/unit/types.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/unit/types.test.ts
git commit -m "feat: shared TypeScript types"
```

---

## Task 3: Utilities (fs, logger, yaml, checksum)

**Files:**
- Create: `src/utils/fs.ts`
- Create: `src/utils/logger.ts`
- Create: `src/utils/yaml.ts`
- Create: `src/utils/checksum.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/utils/fs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fileExists, readTextFile, ensureDir, writeTextFile } from "../../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

describe("fs utils", () => {
  it("fileExists returns false for missing file", async () => {
    expect(await fileExists(join(tmp, "nope.txt"))).toBe(false);
  });

  it("writeTextFile + readTextFile roundtrip", async () => {
    await writeTextFile(join(tmp, "hello.txt"), "world");
    expect(await readTextFile(join(tmp, "hello.txt"))).toBe("world");
  });

  it("ensureDir creates nested dirs", async () => {
    await ensureDir(join(tmp, "a/b/c"));
    expect(await fileExists(join(tmp, "a/b/c"))).toBe(true);
  });
});
```

```ts
// tests/unit/utils/checksum.test.ts
import { describe, it, expect } from "bun:test";
import { sha256Hex } from "../../../src/utils/checksum";

describe("checksum", () => {
  it("sha256Hex produces consistent 64-char hex", async () => {
    const hash = await sha256Hex("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(await sha256Hex("hello world"));
  });

  it("different inputs produce different hashes", async () => {
    const a = await sha256Hex("foo");
    const b = await sha256Hex("bar");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/utils/
```
Expected: module not found errors

- [ ] **Step 3: Create src/utils/fs.ts**

```ts
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export async function fileExists(p: string): Promise<boolean> {
  return existsSync(p);
}

export async function readTextFile(p: string): Promise<string> {
  return readFile(p, "utf-8");
}

export async function writeTextFile(p: string, content: string): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf-8");
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export function findUpSync(filename: string, from: string): string | null {
  let dir = from;
  while (true) {
    const candidate = `${dir}/${filename}`;
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
```

- [ ] **Step 4: Create src/utils/logger.ts**

```ts
import chalk from "chalk";

export const logger = {
  info: (msg: string) => console.log(chalk.cyan("ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("✓"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✗"), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
};
```

- [ ] **Step 5: Create src/utils/yaml.ts**

```ts
import yaml from "js-yaml";

export function parseYaml<T = unknown>(content: string): T {
  return yaml.load(content) as T;
}

export function dumpYaml(value: unknown): string {
  return yaml.dump(value, { indent: 2, lineWidth: -1 });
}
```

- [ ] **Step 6: Create src/utils/checksum.ts**

```ts
export async function sha256Hex(input: string | Buffer): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun test tests/unit/utils/
```
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/utils/ tests/unit/utils/
git commit -m "feat: fs, logger, yaml, checksum utilities"
```

---

## Task 4: Manifest Parser (prsm.yaml)

**Files:**
- Create: `src/core/manifest.ts`
- Create: `tests/unit/core/manifest.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/core/manifest.test.ts
import { describe, it, expect } from "bun:test";
import { parseManifest, ManifestSchema } from "../../../src/core/manifest";

const VALID_YAML = `
name: my-hub
version: 1.0.0
runtimes:
  - claude-code
skills:
  - path: skills/platform/copilot
agents: []
hooks:
  session-start: hooks/session-start.sh
repos: {}
extends: []
output:
  claude-code:
    skills: .claude/skills/
    agents: .claude/agents/
`;

describe("parseManifest", () => {
  it("parses a valid prsm.yaml", () => {
    const m = parseManifest(VALID_YAML);
    expect(m.name).toBe("my-hub");
    expect(m.runtimes).toContain("claude-code");
    expect(m.skills).toHaveLength(1);
    expect(m.hooks["session-start"]).toBe("hooks/session-start.sh");
  });

  it("throws on missing required fields", () => {
    expect(() => parseManifest("name: only-name")).toThrow();
  });

  it("defaults missing optional arrays to empty", () => {
    const m = parseManifest("name: x\nversion: 1.0.0\nruntimes:\n  - claude-code");
    expect(m.extends).toEqual([]);
    expect(m.skills).toEqual([]);
    expect(m.agents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/core/manifest.test.ts
```
Expected: module not found

- [ ] **Step 3: Create src/core/manifest.ts**

```ts
import { z } from "zod";
import { parseYaml } from "../utils/yaml";
import type { WorkspaceManifest } from "../types";

const SkillRefSchema = z.object({ path: z.string() });
const AgentRefSchema = z.object({ path: z.string() });
const RepoEntrySchema = z.object({
  path: z.string(),
  org: z.string().optional(),
  default_branch: z.string().optional(),
});
const HooksSchema = z.object({
  "session-start": z.string().optional(),
  "pre-tool-use": z.string().optional(),
  "post-tool-use": z.string().optional(),
  "user-prompt-submit": z.string().optional(),
  stop: z.string().optional(),
}).default({});
const OutputConfigSchema = z.object({
  skills: z.string().optional(),
  agents: z.string().optional(),
  settings: z.string().optional(),
});

export const ManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  author: z.string().optional(),
  runtimes: z.array(z.enum(["claude-code", "codex"])).min(1),
  extends: z.array(z.string()).default([]),
  dependencies: z.record(z.string()).default({}),
  skills: z.array(SkillRefSchema).default([]),
  agents: z.array(AgentRefSchema).default([]),
  hooks: HooksSchema,
  repos: z.record(z.record(RepoEntrySchema)).default({}),
  output: z.record(OutputConfigSchema).default({}),
});

export function parseManifest(yamlContent: string): WorkspaceManifest {
  const raw = parseYaml(yamlContent);
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid prsm.yaml:\n${issues}`);
  }
  return result.data as WorkspaceManifest;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/core/manifest.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/manifest.ts tests/unit/core/manifest.test.ts
git commit -m "feat: prsm.yaml manifest parser with zod schema"
```

---

## Task 5: Skill and Agent Parsers

**Files:**
- Create: `src/core/skill.ts`
- Create: `src/core/agent.ts`
- Create: `tests/unit/core/skill.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/core/skill.test.ts
import { describe, it, expect } from "bun:test";
import { parseSkillFile } from "../../../src/core/skill";

const SKILL_MD = `---
name: platform-copilot
description: Routes platform work
version: 1.0.0
category: platform
triggers:
  - dispatch work
runtimes:
  - claude-code
tools:
  - Read
  - Write
dependencies:
  hub-adr:
    type: skill
    source: local
    required: true
---

# Platform Copilot

This skill routes work.
`;

describe("parseSkillFile", () => {
  it("extracts frontmatter and content", () => {
    const skill = parseSkillFile(SKILL_MD, "skills/platform/copilot/SKILL.md");
    expect(skill.frontmatter.name).toBe("platform-copilot");
    expect(skill.frontmatter.triggers).toContain("dispatch work");
    expect(skill.content).toContain("# Platform Copilot");
    expect(skill.frontmatter.dependencies?.["hub-adr"].required).toBe(true);
  });

  it("throws when name is missing", () => {
    expect(() => parseSkillFile("---\ndescription: x\n---\ncontent", "path")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/core/skill.test.ts
```
Expected: module not found

- [ ] **Step 3: Create src/core/skill.ts**

```ts
import matter from "gray-matter";
import { z } from "zod";
import type { SkillFrontmatter, ResolvedSkill } from "../types";

const SkillDependencySchema = z.object({
  type: z.enum(["skill", "plugin", "library"]),
  source: z.enum(["local", "remote", "package-manager"]),
  version: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  required: z.boolean(),
});

const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  category: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  runtimes: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  "cross-repo": z.boolean().optional(),
  dependencies: z.record(SkillDependencySchema).optional(),
});

export function parseSkillFile(
  fileContent: string,
  sourcePath: string,
): { frontmatter: SkillFrontmatter; content: string; sourcePath: string } {
  const { data, content } = matter(fileContent);
  const result = SkillFrontmatterSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid SKILL.md at ${sourcePath}:\n${issues}`);
  }
  return { frontmatter: result.data as SkillFrontmatter, content: content.trim(), sourcePath };
}

export function skillToResolved(
  parsed: { frontmatter: SkillFrontmatter; content: string; sourcePath: string },
  origin: "local" | "preset",
  originDetail: string,
): ResolvedSkill {
  return {
    name: parsed.frontmatter.name,
    category: parsed.frontmatter.category ?? "general",
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    sourcePath: parsed.sourcePath,
    origin,
    originDetail,
  };
}
```

- [ ] **Step 4: Create src/core/agent.ts**

```ts
import matter from "gray-matter";
import { z } from "zod";
import type { AgentFrontmatter, ResolvedAgent } from "../types";

const AgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  model: z.string().optional(),
  color: z.string().optional(),
  tools: z.array(z.string()).optional(),
  runtimes: z.array(z.string()).optional(),
});

export function parseAgentFile(
  fileContent: string,
  sourcePath: string,
): { frontmatter: AgentFrontmatter; content: string; sourcePath: string } {
  const { data, content } = matter(fileContent);
  const result = AgentFrontmatterSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid AGENT.md at ${sourcePath}:\n${issues}`);
  }
  return { frontmatter: result.data as AgentFrontmatter, content: content.trim(), sourcePath };
}

export function agentToResolved(
  parsed: { frontmatter: AgentFrontmatter; content: string; sourcePath: string },
  origin: "local" | "preset",
  originDetail: string,
): ResolvedAgent {
  return {
    name: parsed.frontmatter.name,
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    sourcePath: parsed.sourcePath,
    origin,
    originDetail,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/unit/core/skill.test.ts
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/skill.ts src/core/agent.ts tests/unit/core/skill.test.ts
git commit -m "feat: SKILL.md and AGENT.md parsers"
```

---

## Task 6: Workspace Loader

**Files:**
- Create: `src/core/workspace.ts`
- Create: `tests/unit/core/workspace.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/core/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadWorkspace } from "../../../src/core/workspace";
import { writeTextFile, ensureDir } from "../../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-ws-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
`;

const SKILL_MD = `---
name: my-skill
description: A test skill
category: test
---
# My Skill
content here
`;

describe("loadWorkspace", () => {
  it("loads manifest and discovers local skills", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    await ensureDir(join(tmp, "skills/test/my-skill"));
    await writeTextFile(join(tmp, "skills/test/my-skill/SKILL.md"), SKILL_MD);

    const ws = await loadWorkspace(tmp);
    expect(ws.name).toBe("test-ws");
    expect(ws.skills).toHaveLength(1);
    expect(ws.skills[0].name).toBe("my-skill");
    expect(ws.skills[0].origin).toBe("local");
  });

  it("throws when prsm.yaml is missing", async () => {
    await expect(loadWorkspace(tmp)).rejects.toThrow("prsm.yaml");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/core/workspace.test.ts
```
Expected: module not found

- [ ] **Step 3: Create src/core/workspace.ts**

```ts
import { join, relative, dirname, basename } from "path";
import { readdir } from "fs/promises";
import { readTextFile, fileExists } from "../utils/fs";
import { parseManifest } from "./manifest";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import type { WorkspaceManifest, WorkspaceModel, ResolvedSkill, ResolvedAgent } from "../types";

export async function findWorkspaceRoot(from: string): Promise<string | null> {
  let dir = from;
  while (true) {
    if (await fileExists(join(dir, "prsm.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function discoverSkillsDir(skillsDir: string, workspaceRoot: string): Promise<ResolvedSkill[]> {
  const skills: ResolvedSkill[] = [];
  if (!(await fileExists(skillsDir))) return skills;

  const categories = await readdir(skillsDir, { withFileTypes: true });
  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const catDir = join(skillsDir, cat.name);
    const skillDirs = await readdir(catDir, { withFileTypes: true });
    for (const sd of skillDirs) {
      if (!sd.isDirectory()) continue;
      const skillMdPath = join(catDir, sd.name, "SKILL.md");
      if (!(await fileExists(skillMdPath))) continue;
      const content = await readTextFile(skillMdPath);
      const relPath = relative(workspaceRoot, skillMdPath);
      const parsed = parseSkillFile(content, relPath);
      skills.push(skillToResolved(parsed, "local", relPath));
    }
  }
  return skills;
}

async function discoverAgentsDir(agentsDir: string, workspaceRoot: string): Promise<ResolvedAgent[]> {
  const agents: ResolvedAgent[] = [];
  if (!(await fileExists(agentsDir))) return agents;

  const agentDirs = await readdir(agentsDir, { withFileTypes: true });
  for (const ad of agentDirs) {
    if (!ad.isDirectory()) continue;
    const agentMdPath = join(agentsDir, ad.name, "AGENT.md");
    if (!(await fileExists(agentMdPath))) continue;
    const content = await readTextFile(agentMdPath);
    const relPath = relative(workspaceRoot, agentMdPath);
    const parsed = parseAgentFile(content, relPath);
    agents.push(agentToResolved(parsed, "local", relPath));
  }
  return agents;
}

export async function loadWorkspace(root: string): Promise<WorkspaceModel & { manifest: WorkspaceManifest }> {
  const manifestPath = join(root, "prsm.yaml");
  if (!(await fileExists(manifestPath))) {
    throw new Error(`prsm.yaml not found in ${root}`);
  }

  const manifestContent = await readTextFile(manifestPath);
  const manifest = parseManifest(manifestContent);

  const skills = await discoverSkillsDir(join(root, "skills"), root);
  const agents = await discoverAgentsDir(join(root, "agents"), root);

  return {
    manifest,
    name: manifest.name,
    version: manifest.version,
    runtimes: manifest.runtimes,
    skills,
    agents,
    hooks: manifest.hooks,
    permissions: [],
    repos: manifest.repos,
    output: manifest.output,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/core/workspace.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workspace.ts tests/unit/core/workspace.test.ts
git commit -m "feat: workspace loader — discovers skills/agents from disk"
```

---

## Task 7: Dependency Presence Validator

**Files:**
- Create: `src/validators/dependencies.ts`
- Create: `tests/unit/validators/dependencies.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/validators/dependencies.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { validateDependencyPresence } from "../../../src/validators/dependencies";
import { ensureDir, writeTextFile } from "../../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { ResolvedSkill } from "../../../src/types";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-dep-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

function makeSkill(name: string, deps: Record<string, { source: string; required: boolean }>): ResolvedSkill {
  return {
    name,
    category: "test",
    frontmatter: {
      name,
      description: "test",
      dependencies: Object.fromEntries(
        Object.entries(deps).map(([k, v]) => [k, { type: "skill" as const, source: v.source as "local", required: v.required }])
      ),
    },
    content: "",
    sourcePath: `skills/test/${name}/SKILL.md`,
    origin: "local",
    originDetail: `skills/test/${name}/SKILL.md`,
  };
}

describe("validateDependencyPresence", () => {
  it("passes when required local dep exists", async () => {
    await ensureDir(join(tmp, "skills/test/dep-skill"));
    await writeTextFile(join(tmp, "skills/test/dep-skill/SKILL.md"), "---\nname: dep-skill\ndescription: x\n---\ncontent");
    const skill = makeSkill("my-skill", { "dep-skill": { source: "local", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });

  it("fails when required local dep is missing", async () => {
    const skill = makeSkill("my-skill", { "missing-dep": { source: "local", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("missing-dep");
    expect(errors[0]).toContain("my-skill");
  });

  it("ignores optional local dep that is missing", async () => {
    const skill = makeSkill("my-skill", { "opt-dep": { source: "local", required: false } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });

  it("ignores remote deps (not locally checkable)", async () => {
    const skill = makeSkill("my-skill", { "remote-dep": { source: "remote", required: true } });
    const errors = await validateDependencyPresence([skill], tmp);
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/validators/dependencies.test.ts
```
Expected: module not found

- [ ] **Step 3: Create src/validators/dependencies.ts**

```ts
import { join } from "path";
import { fileExists } from "../utils/fs";
import type { ResolvedSkill } from "../types";

async function findSkillPath(depName: string, workspaceRoot: string): Promise<string | null> {
  // Skills live at skills/<category>/<name>/SKILL.md — search all categories
  const { readdir } = await import("fs/promises");
  const skillsDir = join(workspaceRoot, "skills");
  if (!(await fileExists(skillsDir))) return null;

  const cats = await readdir(skillsDir, { withFileTypes: true });
  for (const cat of cats) {
    if (!cat.isDirectory()) continue;
    const candidate = join(skillsDir, cat.name, depName, "SKILL.md");
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

export async function validateDependencyPresence(
  skills: ResolvedSkill[],
  workspaceRoot: string,
): Promise<string[]> {
  const errors: string[] = [];

  for (const skill of skills) {
    const deps = skill.frontmatter.dependencies ?? {};
    for (const [depName, dep] of Object.entries(deps)) {
      if (!dep.required) continue;
      if (dep.source !== "local") continue;

      const found = await findSkillPath(depName, workspaceRoot);
      if (!found) {
        errors.push(
          `Skill "${skill.name}" requires local skill "${depName}" but it was not found in skills/. ` +
          `Add it under skills/<category>/${depName}/SKILL.md or set required: false.`,
        );
      }
    }
  }

  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/validators/dependencies.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/validators/dependencies.ts tests/unit/validators/dependencies.test.ts
git commit -m "feat: required:true local dependency presence validator"
```

---

## Task 8: Preset Engine

**Files:**
- Create: `src/core/preset.ts`
- Create: `src/compiler/merger.ts`
- Create: `tests/unit/compiler/merger.test.ts`

- [ ] **Step 1: Write failing tests for merger**

```ts
// tests/unit/compiler/merger.test.ts
import { describe, it, expect } from "bun:test";
import { mergeLayers } from "../../../src/compiler/merger";
import type { WorkspaceModel, ResolvedSkill } from "../../../src/types";

function makeModel(skills: ResolvedSkill[]): WorkspaceModel {
  return {
    name: "test",
    version: "1.0.0",
    runtimes: ["claude-code"],
    skills,
    agents: [],
    hooks: {},
    permissions: [],
    repos: {},
    output: {},
  };
}

function makeSkill(name: string, origin: "local" | "preset"): ResolvedSkill {
  return {
    name,
    category: "test",
    frontmatter: { name, description: "test" },
    content: `content for ${name} from ${origin}`,
    sourcePath: `skills/test/${name}/SKILL.md`,
    origin,
    originDetail: origin,
  };
}

describe("mergeLayers", () => {
  it("later layer wins on name conflict", () => {
    const base = makeModel([makeSkill("platform-copilot", "preset")]);
    const local = makeModel([makeSkill("platform-copilot", "local")]);
    const merged = mergeLayers([base, local]);
    expect(merged.skills).toHaveLength(1);
    expect(merged.skills[0].origin).toBe("local");
  });

  it("preserves skills from both layers when no conflict", () => {
    const layer1 = makeModel([makeSkill("skill-a", "preset")]);
    const layer2 = makeModel([makeSkill("skill-b", "local")]);
    const merged = mergeLayers([layer1, layer2]);
    expect(merged.skills).toHaveLength(2);
  });

  it("permissions are additive", () => {
    const layer1: WorkspaceModel = { ...makeModel([]), permissions: ["Bash(git *)"] };
    const layer2: WorkspaceModel = { ...makeModel([]), permissions: ["Bash(gh *)"] };
    const merged = mergeLayers([layer1, layer2]);
    expect(merged.permissions).toContain("Bash(git *)");
    expect(merged.permissions).toContain("Bash(gh *)");
  });

  it("hooks: later layer wins per event", () => {
    const layer1: WorkspaceModel = { ...makeModel([]), hooks: { stop: "hooks/base-stop.sh" } };
    const layer2: WorkspaceModel = { ...makeModel([]), hooks: { stop: "hooks/local-stop.sh" } };
    const merged = mergeLayers([layer1, layer2]);
    expect(merged.hooks.stop).toBe("hooks/local-stop.sh");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/compiler/merger.test.ts
```
Expected: module not found

- [ ] **Step 3: Create src/compiler/merger.ts**

```ts
import type { WorkspaceModel, ResolvedSkill, ResolvedAgent, ResolvedHooks } from "../types";

export function mergeLayers(layers: WorkspaceModel[]): WorkspaceModel {
  if (layers.length === 0) throw new Error("mergeLayers requires at least one layer");

  const base = layers[0];
  let result: WorkspaceModel = { ...base };

  for (const layer of layers.slice(1)) {
    // Skills: last wins by name
    const skillMap = new Map<string, ResolvedSkill>(result.skills.map((s) => [s.name, s]));
    for (const s of layer.skills) skillMap.set(s.name, s);
    result.skills = Array.from(skillMap.values());

    // Agents: last wins by name
    const agentMap = new Map(result.agents.map((a) => [a.name, a]));
    for (const a of layer.agents) agentMap.set(a.name, a);
    result.agents = Array.from(agentMap.values());

    // Hooks: last wins per event key
    result.hooks = { ...result.hooks, ...Object.fromEntries(
      Object.entries(layer.hooks).filter(([, v]) => v != null)
    ) } as ResolvedHooks;

    // Permissions: additive, deduplicated
    const permSet = new Set([...result.permissions, ...layer.permissions]);
    result.permissions = Array.from(permSet);

    // Output: later layer wins per runtime
    result.output = { ...result.output, ...layer.output };

    // Repos: merge nested categories
    for (const [cat, repos] of Object.entries(layer.repos)) {
      result.repos[cat] = { ...(result.repos[cat] ?? {}), ...repos };
    }
  }

  return result;
}
```

- [ ] **Step 4: Create src/core/preset.ts**

```ts
import { join } from "path";
import { readTextFile, fileExists } from "../utils/fs";
import { parseYaml } from "../utils/yaml";
import { z } from "zod";
import type { PresetManifest, WorkspaceModel } from "../types";
import { parseSkillFile, skillToResolved } from "./skill";
import { parseAgentFile, agentToResolved } from "./agent";
import { readdir } from "fs/promises";

const PresetManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  extends: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  hooks: z.object({
    "session-start": z.string().optional(),
    "pre-tool-use": z.string().optional(),
    "post-tool-use": z.string().optional(),
    stop: z.string().optional(),
  }).default({}),
  permissions: z.array(z.string()).default([]),
});

export function parsePresetManifest(content: string, sourcePath: string): PresetManifest {
  const raw = parseYaml(content);
  const result = PresetManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid preset.yaml at ${sourcePath}:\n${issues}`);
  }
  return result.data as PresetManifest;
}

export async function loadPresetAsLayer(presetDir: string): Promise<WorkspaceModel> {
  const presetYamlPath = join(presetDir, "preset.yaml");
  if (!(await fileExists(presetYamlPath))) {
    throw new Error(`preset.yaml not found in ${presetDir}`);
  }

  const content = await readTextFile(presetYamlPath);
  const manifest = parsePresetManifest(content, presetYamlPath);

  const skills = [];
  const skillsDir = join(presetDir, "skills");
  if (await fileExists(skillsDir)) {
    const cats = await readdir(skillsDir, { withFileTypes: true });
    for (const cat of cats) {
      if (!cat.isDirectory()) continue;
      const skillNames = await readdir(join(skillsDir, cat.name), { withFileTypes: true });
      for (const sn of skillNames) {
        if (!sn.isDirectory()) continue;
        const p = join(skillsDir, cat.name, sn.name, "SKILL.md");
        if (await fileExists(p)) {
          const parsed = parseSkillFile(await readTextFile(p), p);
          skills.push(skillToResolved(parsed, "preset", manifest.name));
        }
      }
    }
  }

  const agents = [];
  const agentsDir = join(presetDir, "agents");
  if (await fileExists(agentsDir)) {
    const agentDirs = await readdir(agentsDir, { withFileTypes: true });
    for (const ad of agentDirs) {
      if (!ad.isDirectory()) continue;
      const p = join(agentsDir, ad.name, "AGENT.md");
      if (await fileExists(p)) {
        const parsed = parseAgentFile(await readTextFile(p), p);
        agents.push(agentToResolved(parsed, "preset", manifest.name));
      }
    }
  }

  return {
    name: manifest.name,
    version: manifest.version,
    runtimes: [],
    skills,
    agents,
    hooks: manifest.hooks as WorkspaceModel["hooks"],
    permissions: manifest.permissions,
    repos: {},
    output: {},
  };
}
```

- [ ] **Step 5: Run merger tests**

```bash
bun test tests/unit/compiler/merger.test.ts
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/compiler/merger.ts src/core/preset.ts tests/unit/compiler/merger.test.ts
git commit -m "feat: preset layer merger (last wins) + preset.yaml loader"
```

---

## Task 9: Lockfile

**Files:**
- Create: `src/core/lockfile.ts`
- Create: `tests/unit/core/lockfile.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/core/lockfile.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeLockFile, readLockFile } from "../../../src/core/lockfile";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { LockFile } from "../../../src/types";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-lock-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

describe("lockfile", () => {
  it("roundtrips write/read", async () => {
    const lock: LockFile = {
      version: 1,
      presets: {
        "prsm-preset-platform-engineering": {
          version: "2.0.0",
          url: "https://example.com/preset.tar.gz",
          checksum: "sha256:abc123",
        },
      },
      resolvedAt: "2026-05-19T00:00:00Z",
    };
    await writeLockFile(join(tmp, "prsm.lock"), lock);
    const read = await readLockFile(join(tmp, "prsm.lock"));
    expect(read.version).toBe(1);
    expect(read.presets["prsm-preset-platform-engineering"].version).toBe("2.0.0");
  });

  it("returns null for missing lockfile", async () => {
    const result = await readLockFile(join(tmp, "prsm.lock"));
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/unit/core/lockfile.test.ts
```

- [ ] **Step 3: Create src/core/lockfile.ts**

```ts
import { join } from "path";
import { readTextFile, writeTextFile, fileExists } from "../utils/fs";
import { parseYaml, dumpYaml } from "../utils/yaml";
import type { LockFile } from "../types";

export async function readLockFile(lockPath: string): Promise<LockFile | null> {
  if (!(await fileExists(lockPath))) return null;
  const content = await readTextFile(lockPath);
  return parseYaml<LockFile>(content);
}

export async function writeLockFile(lockPath: string, lock: LockFile): Promise<void> {
  const header = "# Auto-generated by prsm. Do not edit manually.\n";
  await writeTextFile(lockPath, header + dumpYaml(lock));
}

export function createLockFile(
  presets: Record<string, { version: string; url: string; checksum: string }>,
): LockFile {
  return {
    version: 1,
    presets,
    resolvedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/core/lockfile.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/lockfile.ts tests/unit/core/lockfile.test.ts
git commit -m "feat: prsm.lock read/write"
```

---

## Task 10: Runtime Adapters

**Files:**
- Create: `src/adapters/index.ts`
- Create: `src/adapters/claude-code.ts`
- Create: `src/adapters/codex.ts`
- Create: `tests/unit/adapters/claude-code.test.ts`
- Create: `tests/unit/adapters/codex.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/adapters/claude-code.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { fileExists, readTextFile } from "../../../src/utils/fs";
import type { ResolvedSkill, ResolvedAgent, WorkspaceModel } from "../../../src/types";

let tmp: string;
const adapter = new ClaudeCodeAdapter();
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-cc-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const skill: ResolvedSkill = {
  name: "platform-copilot",
  category: "platform",
  frontmatter: {
    name: "platform-copilot",
    description: "Routes platform work",
    triggers: ["dispatch work"],
    tools: ["Read", "Write"],
  },
  content: "# Platform Copilot\n\nThis skill routes work.",
  sourcePath: "skills/platform/copilot/SKILL.md",
  origin: "local",
  originDetail: "local",
};

const agent: ResolvedAgent = {
  name: "pr-reviewer",
  frontmatter: {
    name: "pr-reviewer",
    description: "Reviews PRs",
    model: "claude-sonnet-4-6",
    color: "purple",
    tools: ["Read", "Bash"],
  },
  content: "You are an expert reviewer.",
  sourcePath: "agents/pr-reviewer/AGENT.md",
  origin: "local",
  originDetail: "local",
};

describe("ClaudeCodeAdapter", () => {
  it("writes skill to hub-<category>-<name>/SKILL.md", async () => {
    await adapter.compileSkill(skill, tmp);
    const path = join(tmp, ".claude/skills/hub-platform-platform-copilot/SKILL.md");
    expect(await fileExists(path)).toBe(true);
    const content = await readTextFile(path);
    expect(content).toContain("name: platform-copilot");
    expect(content).toContain("# Platform Copilot");
  });

  it("writes agent to agents/<name>.md", async () => {
    await adapter.compileAgent(agent, tmp);
    const path = join(tmp, ".claude/agents/pr-reviewer.md");
    expect(await fileExists(path)).toBe(true);
    const content = await readTextFile(path);
    expect(content).toContain("model: claude-sonnet-4-6");
    expect(content).toContain("You are an expert reviewer.");
  });

  it("generateConfig writes hooks to settings.json", async () => {
    const model: WorkspaceModel = {
      name: "test",
      version: "1.0.0",
      runtimes: ["claude-code"],
      skills: [],
      agents: [],
      hooks: { stop: "hooks/stop.sh", "pre-tool-use": "hooks/safety.sh" },
      permissions: ["Bash(git *)"],
      repos: {},
      output: {},
    };
    await adapter.generateConfig(model, tmp);
    const path = join(tmp, ".claude/settings.json");
    expect(await fileExists(path)).toBe(true);
    const settings = JSON.parse(await readTextFile(path));
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.permissions.allow).toContain("Bash(git *)");
  });
});
```

```ts
// tests/unit/adapters/codex.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CodexAdapter } from "../../../src/adapters/codex";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { fileExists } from "../../../src/utils/fs";
import type { ResolvedSkill, WorkspaceModel } from "../../../src/types";

let tmp: string;
const adapter = new CodexAdapter();
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-codex-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const skill: ResolvedSkill = {
  name: "platform-copilot",
  category: "platform",
  frontmatter: { name: "platform-copilot", description: "Routes work" },
  content: "# Platform Copilot",
  sourcePath: "skills/platform/copilot/SKILL.md",
  origin: "local",
  originDetail: "local",
};

describe("CodexAdapter", () => {
  it("writes skill to .agents/skills/", async () => {
    await adapter.compileSkill(skill, tmp);
    const path = join(tmp, ".agents/skills/hub-platform-platform-copilot/SKILL.md");
    expect(await fileExists(path)).toBe(true);
  });

  it("generateConfig is a no-op for v1 (no hooks)", async () => {
    const model: WorkspaceModel = {
      name: "test", version: "1.0.0", runtimes: ["codex"],
      skills: [], agents: [], hooks: { stop: "hooks/stop.sh" },
      permissions: [], repos: {}, output: {},
    };
    // Should not throw even with hooks declared
    await expect(adapter.generateConfig(model, tmp)).resolves.toBeUndefined();
    // No settings file written
    expect(await fileExists(join(tmp, ".agents/openai.yaml"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/adapters/
```

- [ ] **Step 3: Create src/adapters/index.ts**

```ts
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
```

- [ ] **Step 4: Create src/adapters/claude-code.ts**

```ts
import { join } from "path";
import { writeTextFile, ensureDir } from "../utils/fs";
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
    const compiled = matter.stringify(skill.content, skill.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
  }

  async compileAgent(agent: ResolvedAgent, outputBase: string): Promise<void> {
    const outPath = join(this.agentOutputDir(outputBase), `${agent.name}.md`);
    const compiled = matter.stringify(agent.content, agent.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
  }

  async generateConfig(model: WorkspaceModel, outputBase: string): Promise<void> {
    const settingsPath = join(outputBase, ".claude/settings.json");

    const hooks: Record<string, Array<{ command: string; matcher?: string }>> = {};
    for (const [hookKey, scriptPath] of Object.entries(model.hooks)) {
      if (!scriptPath) continue;
      const eventName = HOOK_EVENT_MAP[hookKey];
      if (!eventName) continue;
      hooks[eventName] = [{ command: scriptPath }];
    }

    const settings = {
      hooks,
      permissions: {
        allow: model.permissions,
      },
    };

    await ensureDir(join(outputBase, ".claude"));
    await writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
  }

  async clean(outputBase: string): Promise<void> {
    const { rm } = await import("fs/promises");
    const skillsDir = this.skillOutputDir(outputBase);
    const agentsDir = this.agentOutputDir(outputBase);
    try { await rm(skillsDir, { recursive: true, force: true }); } catch {}
    try { await rm(agentsDir, { recursive: true, force: true }); } catch {}
  }
}
```

- [ ] **Step 5: Create src/adapters/codex.ts**

```ts
import { join } from "path";
import { writeTextFile } from "../utils/fs";
import matter from "gray-matter";
import { logger } from "../utils/logger";
import type { RuntimeAdapter, ResolvedSkill, ResolvedAgent, WorkspaceModel } from "../types";

export class CodexAdapter implements RuntimeAdapter {
  id = "codex";
  displayName = "Codex CLI";

  async compileSkill(skill: ResolvedSkill, outputBase: string): Promise<void> {
    const dirName = `hub-${skill.category}-${skill.name}`;
    const outPath = join(outputBase, ".agents/skills", dirName, "SKILL.md");
    const compiled = matter.stringify(skill.content, skill.frontmatter as Record<string, unknown>);
    await writeTextFile(outPath, compiled);
  }

  // Codex has no agent concept — no-op
  async compileAgent(_agent: ResolvedAgent, _outputBase: string): Promise<void> {}

  // Codex does not support hooks in v1 — silently skip
  async generateConfig(model: WorkspaceModel, _outputBase: string): Promise<void> {
    const declaredHooks = Object.values(model.hooks).filter(Boolean);
    if (declaredHooks.length > 0) {
      logger.dim(`  [codex] Hooks declared but Codex does not support hooks — skipped`);
    }
  }

  async clean(outputBase: string): Promise<void> {
    const { rm } = await import("fs/promises");
    try { await rm(join(outputBase, ".agents/skills"), { recursive: true, force: true }); } catch {}
  }
}
```

- [ ] **Step 6: Run adapter tests**

```bash
bun test tests/unit/adapters/
```
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/ tests/unit/adapters/
git commit -m "feat: Claude Code + Codex runtime adapters"
```

---

## Task 11: Compiler Orchestration

**Files:**
- Create: `src/compiler/index.ts`
- Create: `tests/integration/build.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/build.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { compile } from "../../src/compiler/index";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-build-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
  - codex
output:
  claude-code:
    skills: .claude/skills/
  codex:
    skills: .agents/skills/
`;

const SKILL_MD = `---
name: my-skill
description: A test skill
category: platform
triggers:
  - invoke my skill
---
# My Skill
Content here.
`;

describe("compile", () => {
  it("outputs skill to both runtimes", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    await ensureDir(join(tmp, "skills/platform/my-skill"));
    await writeTextFile(join(tmp, "skills/platform/my-skill/SKILL.md"), SKILL_MD);

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/skills/hub-platform-my-skill/SKILL.md"))).toBe(true);
    expect(await fileExists(join(tmp, ".agents/skills/hub-platform-my-skill/SKILL.md"))).toBe(true);
  });

  it("generates .claude/settings.json when hooks are declared", async () => {
    const manifestWithHooks = MANIFEST + `\nhooks:\n  stop: hooks/stop.sh\n`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifestWithHooks);

    await compile(tmp);

    expect(await fileExists(join(tmp, ".claude/settings.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/integration/build.test.ts
```

- [ ] **Step 3: Create src/compiler/index.ts**

```ts
import { loadWorkspace } from "../core/workspace";
import { mergeLayers } from "./merger";
import { getAdapter } from "../adapters/index";
import { logger } from "../utils/logger";
import type { WorkspaceModel } from "../types";

export async function compile(workspaceRoot: string): Promise<void> {
  const ws = await loadWorkspace(workspaceRoot);

  // For v1, no preset resolution yet — just use local workspace as single layer
  const model: WorkspaceModel = {
    name: ws.name,
    version: ws.version,
    runtimes: ws.runtimes,
    skills: ws.skills,
    agents: ws.agents,
    hooks: ws.hooks,
    permissions: ws.permissions,
    repos: ws.repos,
    output: ws.output,
  };

  for (const runtime of model.runtimes) {
    const adapter = getAdapter(runtime);
    logger.info(`Building for ${adapter.displayName}...`);

    await adapter.clean(workspaceRoot);

    for (const skill of model.skills) {
      await adapter.compileSkill(skill, workspaceRoot);
    }

    for (const agent of model.agents) {
      await adapter.compileAgent(agent, workspaceRoot);
    }

    await adapter.generateConfig(model, workspaceRoot);

    logger.success(`${adapter.displayName}: ${model.skills.length} skills, ${model.agents.length} agents`);
  }
}
```

- [ ] **Step 4: Run integration tests**

```bash
bun test tests/integration/build.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/compiler/index.ts tests/integration/build.test.ts
git commit -m "feat: compiler orchestration — dispatches to runtime adapters"
```

---

## Task 12: `prsm build` Command

**Files:**
- Create: `src/commands/build.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create src/commands/build.ts**

```ts
import { Command } from "commander";
import { compile } from "../compiler/index";
import { findWorkspaceRoot } from "../core/workspace";
import { logger } from "../utils/logger";

export function buildCommand(): Command {
  return new Command("build")
    .description("Compile skills/agents/hooks to runtime outputs")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) {
        logger.error("No prsm.yaml found. Run prsm init to create a workspace.");
        process.exit(1);
      }
      try {
        await compile(root);
        logger.success("Build complete.");
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 2: Wire into cli.ts**

```ts
import { Command } from "commander";
import { buildCommand } from "./commands/build";

const program = new Command();

program
  .name("prsm")
  .description("Wire your AI stack once, deploy to any runtime.")
  .version("1.0.0");

program.addCommand(buildCommand());

export async function main() {
  await program.parseAsync(process.argv);
}

main();
```

- [ ] **Step 3: Smoke test**

```bash
bun run src/cli.ts build --help
```
Expected: prints build command help

- [ ] **Step 4: Commit**

```bash
git add src/commands/build.ts src/cli.ts
git commit -m "feat: prsm build command"
```

---

## Task 13: `prsm validate` Command

**Files:**
- Create: `src/commands/validate.ts`
- Create: `tests/integration/validate.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/validate.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runValidate } from "../../src/commands/validate";
import { writeTextFile, ensureDir } from "../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-val-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const MANIFEST = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
`;

const SKILL_WITH_MISSING_DEP = `---
name: my-skill
description: test
dependencies:
  missing-dep:
    type: skill
    source: local
    required: true
---
content
`;

describe("runValidate", () => {
  it("returns no errors for a clean workspace", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    const errors = await runValidate(tmp);
    expect(errors).toHaveLength(0);
  });

  it("returns error when required local dep is missing", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST);
    await ensureDir(join(tmp, "skills/test/my-skill"));
    await writeTextFile(join(tmp, "skills/test/my-skill/SKILL.md"), SKILL_WITH_MISSING_DEP);
    const errors = await runValidate(tmp);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("missing-dep");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/integration/validate.test.ts
```

- [ ] **Step 3: Create src/commands/validate.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { validateDependencyPresence } from "../validators/dependencies";
import { logger } from "../utils/logger";

export async function runValidate(root: string): Promise<string[]> {
  const ws = await loadWorkspace(root);
  const errors = await validateDependencyPresence(ws.skills, root);
  return errors;
}

export function validateCommand(): Command {
  return new Command("validate")
    .description("Lint manifest, skill files, and dependency declarations")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) {
        logger.error("No prsm.yaml found.");
        process.exit(1);
      }
      try {
        const errors = await runValidate(root);
        if (errors.length === 0) {
          logger.success("Workspace is valid.");
        } else {
          for (const e of errors) logger.error(e);
          process.exit(1);
        }
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Wire into cli.ts**

```ts
import { buildCommand } from "./commands/build";
import { validateCommand } from "./commands/validate";

// ...existing program setup...
program.addCommand(buildCommand());
program.addCommand(validateCommand());
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/integration/validate.test.ts
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/validate.ts tests/integration/validate.test.ts src/cli.ts
git commit -m "feat: prsm validate command with dependency presence checking"
```

---

## Task 14: `prsm install` Command

**Files:**
- Create: `src/commands/install.ts`
- Create: `tests/integration/install.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/install.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInstall } from "../../src/commands/install";
import { writeTextFile, ensureDir, fileExists } from "../../src/utils/fs";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "prsm-install-")); });
afterEach(async () => { await rm(tmp, { recursive: true }); });

const MANIFEST_NO_PRESETS = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends: []
`;

const PRESET_YAML = `
name: test-preset
version: 1.0.0
skills: []
agents: []
hooks: {}
permissions: []
`;

describe("runInstall", () => {
  it("creates prsm.lock when no extends (empty lock)", async () => {
    await writeTextFile(join(tmp, "prsm.yaml"), MANIFEST_NO_PRESETS);
    await runInstall(tmp);
    expect(await fileExists(join(tmp, "prsm.lock"))).toBe(true);
  });

  it("resolves local preset and writes lock entry", async () => {
    const presetDir = join(tmp, "presets/test-preset");
    await ensureDir(presetDir);
    await writeTextFile(join(presetDir, "preset.yaml"), PRESET_YAML);

    const manifest = `
name: test-ws
version: 1.0.0
runtimes:
  - claude-code
extends:
  - ${presetDir}
`;
    await writeTextFile(join(tmp, "prsm.yaml"), manifest);
    await runInstall(tmp);

    expect(await fileExists(join(tmp, "prsm.lock"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/integration/install.test.ts
```

- [ ] **Step 3: Create src/commands/install.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { loadPresetAsLayer, parsePresetManifest } from "../core/preset";
import { writeLockFile, createLockFile } from "../core/lockfile";
import { sha256Hex } from "../utils/checksum";
import { readTextFile, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";

export async function runInstall(root: string): Promise<void> {
  const ws = await loadWorkspace(root);
  const manifest = ws.manifest;

  const presetEntries: Record<string, { version: string; url: string; checksum: string }> = {};

  for (const presetRef of manifest.extends) {
    // v1: support local directory paths
    const presetYamlPath = join(presetRef, "preset.yaml");
    if (!(await fileExists(presetYamlPath))) {
      throw new Error(`Cannot resolve preset "${presetRef}": preset.yaml not found at ${presetYamlPath}`);
    }

    const content = await readTextFile(presetYamlPath);
    const presetManifest = parsePresetManifest(content, presetYamlPath);
    const checksum = `sha256:${await sha256Hex(content)}`;

    presetEntries[presetManifest.name] = {
      version: presetManifest.version,
      url: presetRef,
      checksum,
    };

    logger.success(`Resolved ${presetManifest.name}@${presetManifest.version}`);
  }

  const lock = createLockFile(presetEntries);
  await writeLockFile(join(root, "prsm.lock"), lock);
  logger.success(`prsm.lock written with ${Object.keys(presetEntries).length} preset(s).`);
}

export function installCommand(): Command {
  return new Command("install")
    .description("Resolve preset inheritance and generate prsm.lock")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) {
        logger.error("No prsm.yaml found.");
        process.exit(1);
      }
      try {
        await runInstall(root);
      } catch (err) {
        logger.error(String(err));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Wire into cli.ts**

```ts
import { installCommand } from "./commands/install";
// ...
program.addCommand(installCommand());
```

- [ ] **Step 5: Run tests**

```bash
bun test tests/integration/install.test.ts
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/install.ts tests/integration/install.test.ts src/cli.ts
git commit -m "feat: prsm install — resolve presets and write prsm.lock"
```

---

## Task 15: `prsm init` Command

**Files:**
- Create: `src/commands/init.ts`

- [ ] **Step 1: Create src/commands/init.ts**

```ts
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

skills: []

agents: []

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
```

- [ ] **Step 2: Wire into cli.ts**

```ts
import { initCommand } from "./commands/init";
// ...
program.addCommand(initCommand());
```

- [ ] **Step 3: Smoke test**

```bash
bun run src/cli.ts init test-workspace
ls test-workspace/
```
Expected: `prsm.yaml  skills/  hooks/  agents/  .gitignore`

- [ ] **Step 4: Clean up smoke test**

```bash
rm -rf test-workspace
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts src/cli.ts
git commit -m "feat: prsm init — scaffold new workspace from template"
```

---

## Task 16: `prsm list` and `prsm explain`

**Files:**
- Create: `src/commands/list.ts`
- Create: `src/commands/explain.ts`

- [ ] **Step 1: Create src/commands/list.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { logger } from "../utils/logger";
import chalk from "chalk";

export function listCommand(): Command {
  return new Command("list")
    .description("List installed skills, agents, and their runtime targets")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);

      console.log(chalk.bold("\nSkills:"));
      if (ws.skills.length === 0) {
        console.log("  (none)");
      } else {
        for (const s of ws.skills) {
          const runtimes = s.frontmatter.runtimes ?? ws.runtimes;
          console.log(`  ${chalk.cyan(s.name)} (${s.category}) — ${s.frontmatter.description}`);
          console.log(`    runtimes: ${runtimes.join(", ")}  origin: ${s.origin}`);
        }
      }

      console.log(chalk.bold("\nAgents:"));
      if (ws.agents.length === 0) {
        console.log("  (none)");
      } else {
        for (const a of ws.agents) {
          console.log(`  ${chalk.magenta(a.name)} — ${a.frontmatter.description}`);
          console.log(`    model: ${a.frontmatter.model ?? "default"}  origin: ${a.origin}`);
        }
      }

      console.log();
    });
}
```

- [ ] **Step 2: Create src/commands/explain.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { logger } from "../utils/logger";
import chalk from "chalk";

export function explainCommand(): Command {
  return new Command("explain")
    .description("Show resolved configuration for a skill or agent")
    .argument("<name>", "skill or agent name")
    .action(async (name: string) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);
      const skill = ws.skills.find((s) => s.name === name);
      const agent = ws.agents.find((a) => a.name === name);

      if (!skill && !agent) {
        logger.error(`No skill or agent named "${name}" found.`);
        process.exit(1);
      }

      if (skill) {
        console.log(chalk.bold(`\nSkill: ${skill.name}`));
        console.log(`  Description: ${skill.frontmatter.description}`);
        console.log(`  Category:    ${skill.category}`);
        console.log(`  Origin:      ${skill.origin} (${skill.originDetail})`);
        console.log(`  Triggers:    ${(skill.frontmatter.triggers ?? []).join(", ") || "(none)"}`);
        console.log(`  Tools:       ${(skill.frontmatter.tools ?? []).join(", ") || "(any)"}`);
        if (skill.frontmatter.dependencies) {
          console.log(`  Dependencies:`);
          for (const [dep, info] of Object.entries(skill.frontmatter.dependencies)) {
            console.log(`    ${dep}: ${info.type}/${info.source} required=${info.required}`);
          }
        }
      }

      if (agent) {
        console.log(chalk.bold(`\nAgent: ${agent.name}`));
        console.log(`  Description: ${agent.frontmatter.description}`);
        console.log(`  Model:       ${agent.frontmatter.model ?? "default"}`);
        console.log(`  Origin:      ${agent.origin} (${agent.originDetail})`);
        console.log(`  Tools:       ${(agent.frontmatter.tools ?? []).join(", ") || "(any)"}`);
      }

      console.log();
    });
}
```

- [ ] **Step 3: Wire into cli.ts**

```ts
import { listCommand } from "./commands/list";
import { explainCommand } from "./commands/explain";
// ...
program.addCommand(listCommand());
program.addCommand(explainCommand());
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/list.ts src/commands/explain.ts src/cli.ts
git commit -m "feat: prsm list and prsm explain commands"
```

---

## Task 17: `prsm doctor`

**Files:**
- Create: `src/commands/doctor.ts`

- [ ] **Step 1: Create src/commands/doctor.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { readLockFile } from "../core/lockfile";
import { validateDependencyPresence } from "../validators/dependencies";
import { logger } from "../utils/logger";
import { join } from "path";
import chalk from "chalk";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Diagnose workspace configuration issues")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      let issues = 0;

      // Check lockfile
      const lock = await readLockFile(join(root, "prsm.lock"));
      const ws = await loadWorkspace(root);

      if (ws.manifest.extends.length > 0 && !lock) {
        logger.warn(`prsm.lock missing — run prsm install to generate it`);
        issues++;
      } else if (lock) {
        logger.success(`prsm.lock found (resolved at ${lock.resolvedAt})`);
      }

      // Check dependency presence
      const depErrors = await validateDependencyPresence(ws.skills, root);
      for (const e of depErrors) {
        logger.warn(e);
        issues++;
      }

      // Check declared hook scripts exist
      const { fileExists } = await import("../utils/fs");
      for (const [event, scriptPath] of Object.entries(ws.hooks)) {
        if (!scriptPath) continue;
        const full = join(root, scriptPath);
        if (!(await fileExists(full))) {
          logger.warn(`Hook ${event}: script "${scriptPath}" not found`);
          issues++;
        } else {
          logger.success(`Hook ${event}: ${scriptPath}`);
        }
      }

      if (issues === 0) {
        logger.success("Workspace looks healthy.");
      } else {
        console.log(chalk.yellow(`\n${issues} issue(s) found.`));
        process.exit(1);
      }
    });
}
```

- [ ] **Step 2: Wire into cli.ts**

```ts
import { doctorCommand } from "./commands/doctor";
// ...
program.addCommand(doctorCommand());
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/doctor.ts src/cli.ts
git commit -m "feat: prsm doctor — workspace health diagnostics"
```

---

## Task 18: `prsm eject`

**Files:**
- Create: `src/commands/eject.ts`

- [ ] **Step 1: Create src/commands/eject.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { loadPresetAsLayer, parsePresetManifest } from "../core/preset";
import { readLockFile, writeLockFile } from "../core/lockfile";
import { readTextFile, writeTextFile, ensureDir, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join, dirname } from "path";
import { copyFile, readdir } from "fs/promises";
import matter from "gray-matter";

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const destPath = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await ensureDir(dirname(destPath));
      await copyFile(srcPath, destPath);
    }
  }
}

export function ejectCommand(): Command {
  return new Command("eject")
    .description("Copy preset contents into local workspace, removing preset dependency")
    .argument("[preset-name]", "preset to eject (ejects all if omitted)")
    .action(async (presetName: string | undefined) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);
      const manifest = ws.manifest;

      const toEject = presetName
        ? manifest.extends.filter((e) => e.includes(presetName ?? ""))
        : manifest.extends;

      if (toEject.length === 0) {
        logger.warn("No matching presets found in extends:.");
        process.exit(0);
      }

      const remainingExtends = manifest.extends.filter((e) => !toEject.includes(e));

      for (const presetRef of toEject) {
        const presetYamlPath = join(presetRef, "preset.yaml");
        if (!(await fileExists(presetYamlPath))) {
          logger.error(`Cannot find preset at ${presetRef}`);
          continue;
        }

        const presetContent = await readTextFile(presetYamlPath);
        const pm = parsePresetManifest(presetContent, presetYamlPath);

        logger.info(`Ejecting ${pm.name}@${pm.version}...`);

        const skillsSrc = join(presetRef, "skills");
        if (await fileExists(skillsSrc)) {
          await copyDir(skillsSrc, join(root, "skills"));
          logger.success(`Copied skills`);
        }

        const agentsSrc = join(presetRef, "agents");
        if (await fileExists(agentsSrc)) {
          await copyDir(agentsSrc, join(root, "agents"));
          logger.success(`Copied agents`);
        }

        const hooksSrc = join(presetRef, "hooks");
        if (await fileExists(hooksSrc)) {
          await copyDir(hooksSrc, join(root, "hooks"));
          logger.success(`Copied hooks`);
        }
      }

      // Update prsm.yaml — remove ejected extends entries
      const manifestContent = await readTextFile(join(root, "prsm.yaml"));
      // Simple line-based removal to preserve YAML formatting
      const lines = manifestContent.split("\n");
      const updatedLines = lines.filter((line) =>
        !toEject.some((ref) => line.includes(ref))
      );
      await writeTextFile(join(root, "prsm.yaml"), updatedLines.join("\n"));

      // Update lockfile
      const lock = await readLockFile(join(root, "prsm.lock"));
      if (lock) {
        for (const ref of toEject) {
          for (const [name] of Object.entries(lock.presets)) {
            if (ref.includes(name)) delete lock.presets[name];
          }
        }
        await writeLockFile(join(root, "prsm.lock"), lock);
      }

      logger.success(`Ejected ${toEject.length} preset(s). Workspace is now self-contained.`);
    });
}
```

- [ ] **Step 2: Wire into cli.ts**

```ts
import { ejectCommand } from "./commands/eject";
// ...
program.addCommand(ejectCommand());
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/eject.ts src/cli.ts
git commit -m "feat: prsm eject — copy preset contents into local workspace"
```

---

## Task 19: Repo-Mapping Commands

**Files:**
- Create: `src/core/repo-map.ts`
- Create: `src/commands/context.ts`
- Create: `src/commands/sync.ts`
- Create: `src/commands/diff.ts`

- [ ] **Step 1: Create src/core/repo-map.ts**

```ts
import type { RepoMap, RepoEntry } from "../types";

export function findRepo(repos: RepoMap, name: string): { entry: RepoEntry; category: string } | null {
  for (const [category, categoryRepos] of Object.entries(repos)) {
    if (name in categoryRepos) {
      return { entry: categoryRepos[name], category };
    }
  }
  return null;
}

export function listAllRepos(repos: RepoMap): Array<{ name: string; category: string; entry: RepoEntry }> {
  const result = [];
  for (const [category, categoryRepos] of Object.entries(repos)) {
    for (const [name, entry] of Object.entries(categoryRepos)) {
      result.push({ name, category, entry });
    }
  }
  return result;
}
```

- [ ] **Step 2: Create src/commands/context.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { findRepo } from "../core/repo-map";
import { fileExists, readTextFile } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";
import chalk from "chalk";

export function contextCommand(): Command {
  return new Command("context")
    .description("Load target repo AGENTS.md and presets into session context")
    .argument("<repo>", "repo name as declared in prsm.yaml repos:")
    .action(async (repoName: string) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);
      const found = findRepo(ws.repos, repoName);

      if (!found) {
        const available = Object.values(ws.repos).flatMap((cat) => Object.keys(cat));
        logger.error(`Repo "${repoName}" not found. Available: ${available.join(", ")}`);
        process.exit(1);
      }

      const { entry } = found;
      const repoPath = entry.path.replace(/^~/, process.env.HOME ?? "~");
      const agentsMdPath = join(repoPath, "AGENTS.md");

      console.log(chalk.bold(`\nContext for: ${repoName}`));
      console.log(`  Path:   ${repoPath}`);
      console.log(`  Org:    ${entry.org ?? "(not set)"}`);
      console.log(`  Branch: ${entry.default_branch ?? "main"}`);

      if (await fileExists(agentsMdPath)) {
        const content = await readTextFile(agentsMdPath);
        console.log(chalk.bold("\nAGENTS.md:"));
        console.log(content);
      } else {
        logger.warn(`No AGENTS.md found at ${agentsMdPath}`);
      }
    });
}
```

- [ ] **Step 3: Create src/commands/diff.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { listAllRepos } from "../core/repo-map";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";
import chalk from "chalk";

export function diffCommand(): Command {
  return new Command("diff")
    .description("Detect drift in skills/hooks/permissions")
    .option("--cross-repo", "detect drift across all mapped repos")
    .action(async (options: { crossRepo?: boolean }) => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);

      if (options.crossRepo) {
        const repos = listAllRepos(ws.repos);
        if (repos.length === 0) {
          logger.info("No repos mapped in prsm.yaml repos: block.");
          return;
        }

        for (const { name, entry } of repos) {
          const repoPath = entry.path.replace(/^~/, process.env.HOME ?? "~");
          const prsmYaml = join(repoPath, "prsm.yaml");
          const hasPrsm = await fileExists(prsmYaml);
          const agentsMd = join(repoPath, "AGENTS.md");
          const hasAgentsMd = await fileExists(agentsMd);

          const status = hasPrsm
            ? chalk.green("prsm workspace")
            : hasAgentsMd
            ? chalk.yellow("AGENTS.md only (not prsm)")
            : chalk.dim("no AI config");

          console.log(`  ${chalk.bold(name)}: ${status}`);
        }
      } else {
        logger.info("Local diff: comparing current workspace against last build output...");
        logger.info("Run prsm build to regenerate outputs and use git diff to see changes.");
      }
    });
}
```

- [ ] **Step 4: Create src/commands/sync.ts**

```ts
import { Command } from "commander";
import { loadWorkspace, findWorkspaceRoot } from "../core/workspace";
import { listAllRepos } from "../core/repo-map";
import { compile } from "../compiler/index";
import { fileExists } from "../utils/fs";
import { logger } from "../utils/logger";
import { join } from "path";

export function syncCommand(): Command {
  return new Command("sync")
    .description("Fan preset changes across all mapped repos")
    .action(async () => {
      const root = await findWorkspaceRoot(process.cwd());
      if (!root) { logger.error("No prsm.yaml found."); process.exit(1); }

      const ws = await loadWorkspace(root);
      const repos = listAllRepos(ws.repos);

      if (repos.length === 0) {
        logger.info("No repos mapped. Add repos: block to prsm.yaml.");
        return;
      }

      for (const { name, entry } of repos) {
        const repoPath = entry.path.replace(/^~/, process.env.HOME ?? "~");
        const prsmYaml = join(repoPath, "prsm.yaml");

        if (!(await fileExists(prsmYaml))) {
          logger.dim(`  ${name}: no prsm.yaml — skipping`);
          continue;
        }

        logger.info(`Syncing ${name}...`);
        try {
          await compile(repoPath);
          logger.success(`${name}: sync complete`);
        } catch (err) {
          logger.error(`${name}: ${String(err)}`);
        }
      }
    });
}
```

- [ ] **Step 5: Wire all into cli.ts**

```ts
import { contextCommand } from "./commands/context";
import { syncCommand } from "./commands/sync";
import { diffCommand } from "./commands/diff";
// ...
program.addCommand(contextCommand());
program.addCommand(syncCommand());
program.addCommand(diffCommand());
```

- [ ] **Step 6: Commit**

```bash
git add src/core/repo-map.ts src/commands/context.ts src/commands/sync.ts src/commands/diff.ts src/cli.ts
git commit -m "feat: repo-mapping commands — context, sync, diff --cross-repo"
```

---

## Task 20: Complete cli.ts and Dogfood prsm.yaml

**Files:**
- Modify: `src/cli.ts` (final wiring)
- Create: `prsm.yaml` (repo dogfoods itself)

- [ ] **Step 1: Final src/cli.ts**

```ts
import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { validateCommand } from "./commands/validate";
import { installCommand } from "./commands/install";
import { initCommand } from "./commands/init";
import { listCommand } from "./commands/list";
import { explainCommand } from "./commands/explain";
import { doctorCommand } from "./commands/doctor";
import { ejectCommand } from "./commands/eject";
import { contextCommand } from "./commands/context";
import { syncCommand } from "./commands/sync";
import { diffCommand } from "./commands/diff";

const program = new Command();

program
  .name("prsm")
  .description("Wire your AI stack once, deploy to any runtime.")
  .version("1.0.0");

program.addCommand(initCommand());
program.addCommand(buildCommand());
program.addCommand(installCommand());
program.addCommand(validateCommand());
program.addCommand(listCommand());
program.addCommand(explainCommand());
program.addCommand(doctorCommand());
program.addCommand(ejectCommand());
program.addCommand(contextCommand());
program.addCommand(syncCommand());
program.addCommand(diffCommand());

export async function main() {
  await program.parseAsync(process.argv);
}

main();
```

- [ ] **Step 2: Create prsm.yaml (dogfood)**

```yaml
name: prsm
version: 1.0.0
author: Eduardo Leal

runtimes:
  - claude-code

extends: []

dependencies: {}

skills: []

agents: []

hooks: {}

repos: {}

output:
  claude-code:
    skills: .claude/skills/
    agents: .claude/agents/
    settings: .claude/settings.json
```

- [ ] **Step 3: Run all tests**

```bash
bun test
```
Expected: all PASS

- [ ] **Step 4: Smoke-test the binary**

```bash
bun run src/cli.ts --help
bun run src/cli.ts validate
bun run src/cli.ts list
```

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts prsm.yaml
git commit -m "feat: complete CLI wiring + dogfood prsm.yaml"
```

---

## Self-Review

**Spec coverage check:**
- `prsm init` ✓ Task 15
- `prsm build` ✓ Tasks 10-12
- `prsm install` (preset lockfile) ✓ Task 14
- `prsm validate` (syntax + dep presence) ✓ Tasks 7, 13
- `prsm list` ✓ Task 16
- `prsm explain` ✓ Task 16
- `prsm doctor` ✓ Task 17
- `prsm eject` ✓ Task 18
- `prsm context` ✓ Task 19
- `prsm sync` ✓ Task 19
- `prsm diff --cross-repo` ✓ Task 19
- Byte-identical builds via lockfile ✓ Tasks 9, 14
- Codex hook silent-skip ✓ Task 10 (CodexAdapter.generateConfig)
- `@prsm/prsm` scoped package ✓ Task 1 (package.json)
- Dogfood prsm.yaml ✓ Task 20

**Missing from this plan (post-1.0 per spec):**
- `prsm init --from-claude-dir` migration (stub errors in Task 15)
- `prsm add` / `prsm search` / `prsm publish` (v2+ registry commands)
- Codex `agents/openai.yaml` generation
- Full preset extends-chain resolution with lockfile verification in `prsm build`
- GitHub Releases / Homebrew tap packaging
