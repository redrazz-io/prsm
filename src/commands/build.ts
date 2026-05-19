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
