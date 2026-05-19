import { Command } from "commander";

const program = new Command();

program
  .name("prsm")
  .description("Wire your AI stack once, deploy to any runtime.")
  .version("1.0.0");

export async function main() {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  main();
}
