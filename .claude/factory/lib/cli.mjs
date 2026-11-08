#!/usr/bin/env node
// Small CLI over the project config, for shell scripts. Run from the project root.
//   node <factory>/lib/cli.mjs testfile <ticket>   -> the ticket's test file path
//   node <factory>/lib/cli.mjs home               -> the factory folder
import { loadConfig, testFileFor, FACTORY_HOME } from "./config.mjs";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "home") console.log(FACTORY_HOME);
else if (cmd === "testfile") {
  const cfg = loadConfig(process.cwd());
  if (!cfg) { console.error("no .factory/config.json"); process.exit(1); }
  console.log(testFileFor(cfg, arg));
} else {
  console.error("usage: cli.mjs testfile <ticket> | home");
  process.exit(1);
}
