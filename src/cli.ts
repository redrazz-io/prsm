#!/usr/bin/env bun
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
import { diffCommand } from "./commands/diff";
import { syncCommand } from "./commands/sync";

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
program.addCommand(doctorCommand());
program.addCommand(ejectCommand());
program.addCommand(contextCommand());
program.addCommand(diffCommand());
program.addCommand(syncCommand());

export async function main() {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  main();
}
