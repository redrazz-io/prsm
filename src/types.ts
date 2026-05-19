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
  output: Record<string, OutputConfig>;
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
