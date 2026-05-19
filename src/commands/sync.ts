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
      if (!root) {
        logger.error("No prsm.yaml found.");
        process.exit(1);
      }
      const ws = await loadWorkspace(root);
      const repos = listAllRepos(ws.repos as any);

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
