import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { buildCommand } from "./commands/build";
import { contextCommand } from "./commands/context";
import { diffCommand } from "./commands/diff";
import { doctorCommand } from "./commands/doctor";
import { ejectCommand } from "./commands/eject";
import { explainCommand } from "./commands/explain";
import { initCommand } from "./commands/init";
import { installCommand } from "./commands/install";
import { listCommand } from "./commands/list";
import { syncCommand } from "./commands/sync";
import { validateCommand } from "./commands/validate";

const program = new Command();

program
	.name("prsm")
	.description("Wire your AI stack once, deploy to any runtime.")
	.version(pkg.version);

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
