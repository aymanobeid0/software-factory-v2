#!/usr/bin/env node
// Factory guard: PreToolUse hook that enforces each role's least-privilege rules.
// Usage (in the role settings run-role.sh generates): node <factory>/hooks/guard.mjs <role>
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
//
// Nothing here is tied to a machine or a language. The project is the session cwd, the rules come from
// the project's .factory/config.json (paths, test commands), and the factory locates itself from this file.
import fs from "node:fs";
import path from "node:path";
import { FACTORY_HOME, loadConfig, isSrcPath, isTestPath, commandPrefix } from "../lib/config.mjs";

const role = process.argv[2];
const ROLES = ["tester", "implementer", "verifier", "reviewer"];

// Which project commands (from config.commands) each role may run.
const ROLE_COMMANDS = {
  tester: ["test", "testFile", "testOne"],
  implementer: ["test", "testFile", "testOne", "typecheck"],
  verifier: ["test", "testFile", "testOne", "typecheck"],
  reviewer: [],
};
const GIT_READ = /^git (status|diff|log|show)(\s|$)/;
// The referee, put on PATH by run-role.sh. Never --start (the orchestrator owns that).
const CHECKPOINT = /^factory-checkpoint (?!--)[0-9A-Za-z_-]+ \S/;

const READ_OUTSIDE_OK = [path.join(FACTORY_HOME, "matt-skills")].map(norm);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const ALWAYS_OK = new Set(["Skill", "TodoWrite", "ToolSearch"]);
const SHELL_META = /[;&|<>`]|\$\(/;

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  block("could not read hook input");
}
const cwd = norm(input.cwd || process.cwd());
const tool = input.tool_name;
const ti = input.tool_input || {};
if (!ROLES.includes(role)) block(`unknown role "${role}"`);

let cfg;
try {
  cfg = loadConfig(cwd);
} catch (e) {
  block(`bad .factory/config.json: ${e.message}`);
}
if (!cfg) block("this project has no .factory/config.json, so the factory can't run here. Run /factory-plan first.");

if (ALWAYS_OK.has(tool)) process.exit(0);

if (WRITE_TOOLS.has(tool)) {
  const rel = relToProject(ti.file_path || ti.notebook_path || "");
  if (rel === null) block(`writing outside the project is not allowed (${ti.file_path})`);
  const ok =
    (role === "tester" && isTestPath(cfg, rel)) ||
    (role === "implementer" && isSrcPath(cfg, rel));
  if (!ok) {
    const allowed = role === "tester" ? cfg.paths.tests : role === "implementer" ? cfg.paths.src : [];
    block(`role "${role}" may not write ${rel}. Allowed: ${allowed.join(", ") || "nothing"}${role === "implementer" ? " (test files excluded)" : ""}`);
  }
  process.exit(0);
}

if (READ_TOOLS.has(tool)) {
  const p = ti.file_path || ti.path;
  if (!p) process.exit(0);
  if (relToProject(p) !== null) process.exit(0);
  const abs = norm(path.resolve(cwd, p)).toLowerCase();
  if (READ_OUTSIDE_OK.some((ok) => abs.startsWith(ok.toLowerCase()))) process.exit(0);
  block(`reading outside the project is not allowed (${p})`);
}

if (tool === "Bash") {
  const cmd = String(ti.command || "").trim();
  if (SHELL_META.test(cmd)) block(`shell operators (; & | < > \` $( ) are not allowed: ${cmd}`);
  const prefixes = ROLE_COMMANDS[role].map((k) => commandPrefix(cfg.commands[k])).filter(Boolean);
  const allowed =
    GIT_READ.test(cmd) ||
    prefixes.some((pre) => cmd === pre || cmd.startsWith(pre + " ")) ||
    (role === "implementer" && CHECKPOINT.test(cmd));
  if (!allowed) {
    const list = [...new Set(prefixes)].concat("git status/diff/log/show", role === "implementer" ? ["factory-checkpoint <ticket> <words>"] : []);
    block(`role "${role}" may not run: ${cmd}. Allowed commands start with: ${list.join(" | ")}`);
  }
  process.exit(0);
}

block(`tool ${tool} is not available to role "${role}"`);

function norm(p) {
  return String(p).replace(/\\/g, "/");
}
function relToProject(p) {
  if (!p) return null;
  const abs = path.resolve(cwd, p);
  const rel = norm(path.relative(cwd, abs));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}
function block(reason) {
  try {
    const dir = path.join(input?.cwd || process.cwd(), ".factory");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "violations.log"), `${new Date().toISOString()}\t${role}\t${input?.tool_name}\t${reason}\n`);
  } catch {}
  process.stderr.write(
    `BLOCKED by factory guard: ${reason}\n` +
      `Do not look for a workaround. If you genuinely need this, stop now and end your reply with one line:\n` +
      `NEEDS_HUMAN: <what you need> | <why> | <what is blocked>\n`,
  );
  process.exit(2);
}
