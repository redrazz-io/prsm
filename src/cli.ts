import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { validateCommand } from "./commands/validate";
import { installCommand } from "./commands/install";
import { initCommand } from "./commands/init";
import { listCommand } from "./commands/list";
import { explainCommand } from "./commands/explain";

const program = new Command();

program
  .name("prsm")
  .description("Wire your AI stack once, deploy to any runtime.")
  .version("1.0.0");

program.addCommand(buildCommand());
program.addCommand(validateCommand());
program.addCommand(installCommand());
program.addCommand(initCommand());
program.addCommand(listCommand());
program.addCommand(explainCommand());

export async function main() {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  main();
}
