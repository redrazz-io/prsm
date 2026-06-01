import matter from "gray-matter";
import { z } from "zod";
import { readdir } from "fs/promises";
import { join, relative, sep } from "path";
import type { SkillFrontmatter, ResolvedSkill, SkillSupportFile } from "../types";

const SUPPORT_SKIP_FILENAMES = new Set([".DS_Store", "Thumbs.db"]);

/**
 * Collect every non-SKILL.md file under a skill's directory as a support file
 * (scripts, templates, assets — at any depth). Paths are returned relative to
 * the skill dir, POSIX-normalized, sorted for determinism.
 *
 * Symlinks are rejected for the same integrity reason as preset content
 * (src/core/preset.ts collectPresetFiles): a symlinked support file would be
 * copied by following its target at build time but is invisible to the content
 * hash, bypassing the checksum gate. The top-level SKILL.md is excluded — it is
 * emitted separately from the parsed frontmatter/content.
 */
export async function collectSkillSupportFiles(skillDir: string): Promise<SkillSupportFile[]> {
  const out: SkillSupportFile[] = [];
  await walkSupportFiles(skillDir, skillDir, out);
  return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

async function walkSupportFiles(dir: string, root: string, out: SkillSupportFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const relPath = relative(root, abs).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed inside a skill — found "${relPath}". ` +
          `Replace symlinks with real files (or remove them) before running prsm install.`,
      );
    }
    if (entry.isDirectory()) {
      await walkSupportFiles(abs, root, out);
    } else if (entry.isFile()) {
      if (SUPPORT_SKIP_FILENAMES.has(entry.name)) continue;
      if (relPath === "SKILL.md") continue; // emitted separately from frontmatter+content
      out.push({ relPath, absPath: abs });
    }
  }
}

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
  supportFiles: SkillSupportFile[] = [],
): ResolvedSkill {
  return {
    name: parsed.frontmatter.name,
    category: parsed.frontmatter.category ?? "general",
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    sourcePath: parsed.sourcePath,
    origin,
    originDetail,
    supportFiles,
  };
}
