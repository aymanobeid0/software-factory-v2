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
const READ_CMDS = new Set(["cat", "ls", "head", "tail", "rg", "grep", "find", "wc", "pwd", "stat", "file", "tree", "sed",
  "get-content", "gc", "get-childitem", "gci", "dir", "type", "select-string", "sls", "test-path", "get-location"]);

// Any crash must block, never allow: an uncaught error exits 1, which hook runners treat as "allow".
process.on("uncaughtException", (e) => {
  try { process.stderr.write(`BLOCKED by factory guard: internal error (${e && e.message})\n`); } catch {}
  process.exit(2);
});

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

// Codex edits files with apply_patch (also matchable as Edit/Write): tool_input.command holds the patch,
// whose "*** Add/Update/Delete File:" and "*** Move to:" lines name every file it touches.
const isCodexPatch = tool === "apply_patch" || (WRITE_TOOLS.has(tool) && !ti.file_path && !ti.notebook_path && ti.command);
if (isCodexPatch) {
  const text = Array.isArray(ti.command) ? ti.command.join("\n") : String(ti.command || ti.patch || ti.input || "");
  const files = [...text.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm)].map((m) => m[1]);
  if (files.length === 0) block("could not find which files this patch touches");
  for (const f of files) checkWrite(f);
  process.exit(0);
}

if (WRITE_TOOLS.has(tool)) {
  checkWrite(ti.file_path || ti.notebook_path || "");
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

if (tool === "Bash" || tool === "exec_command" || tool === "shell") {
  const cmd = unwrapShell(ti.command ?? ti.cmd ?? "");
  if (SHELL_META.test(cmd)) block(`shell operators (; & | < > \` $( ) are not allowed: ${cmd}`);
  const prefixes = ROLE_COMMANDS[role].map((k) => commandPrefix(cfg.commands[k])).filter(Boolean);
  const allowed =
    GIT_READ.test(cmd) ||
    prefixes.some((pre) => cmd === pre || cmd.startsWith(pre + " ")) ||
    (role === "implementer" && CHECKPOINT.test(cmd)) ||
    isReadOnlyInsideProject(cmd);
  if (!allowed) {
    const list = [...new Set(prefixes)].concat("git status/diff/log/show", "read-only file commands inside the project (cat, ls, rg, grep, head, tail, find, wc, Get-Content…)", role === "implementer" ? ["factory-checkpoint <ticket> <words>"] : []);
    block(`role "${role}" may not run: ${cmd}. Allowed commands start with: ${list.join(" | ")}`);
  }
  process.exit(0);
}

block(`tool ${tool} is not available to role "${role}"`);

function checkWrite(file) {
  const rel = relToProject(file);
  if (rel === null) block(`writing outside the project is not allowed (${file})`);
  const ok = (role === "tester" && isTestPath(cfg, rel)) || (role === "implementer" && isSrcPath(cfg, rel));
  if (!ok) {
    const allowed = role === "tester" ? cfg.paths.tests : role === "implementer" ? cfg.paths.src : [];
    block(`role "${role}" may not write ${rel}. Allowed: ${allowed.join(", ") || "nothing"}${role === "implementer" ? " (test files excluded)" : ""}`);
  }
}

// Codex may hand the command as an argv array or wrapped in a shell launcher
// (["bash","-lc","git status"], "powershell.exe -Command 'git status'"). Judge the inner command.
function unwrapShell(c) {
  let s = Array.isArray(c) ? c : null;
  if (s) {
    const launcher = /^(?:.*[\\/])?(bash|sh|zsh|pwsh|powershell)(?:\.exe)?$/i.test(s[0] || "");
    if (launcher && s.length >= 3 && /^-(?:lc|c|Command|NoProfile)$/i.test(s[s.length - 2])) return String(s[s.length - 1]).trim();
    return s.join(" ").trim();
  }
  let str = String(c).trim();
  const m = str.match(/^(?:\S*[\\/])?(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+(?:-NoProfile\s+)?(?:-lc|-c|-Command)\s+(['"])([\s\S]*)\1$/i);
  return m ? m[2].trim() : str;
}

// Read-only file commands are how Codex reads (it has no Read tool). Allowed when every path they
// name stays inside the project (or the pinned skills), and they carry no writing options.
function isReadOnlyInsideProject(cmd) {
  const words = cmd.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (!words.length) return false;
  const exe = words[0].toLowerCase();
  if (!READ_CMDS.has(exe)) return false;
  if (exe === "sed" && !words.includes("-n")) return false;               // sed only for printing
  if (words.some((w) => /^-(i|-in-place)/.test(w) && exe === "sed")) return false;
  if (exe === "find" && words.some((w) => /^-(exec|execdir|delete|ok|okdir|fprint|fprintf|fls)$/.test(w))) return false;
  for (const raw of words.slice(1)) {
    const w = raw.replace(/^['"]|['"]$/g, "");
    if (w.startsWith("-")) continue;
    const looksLikePath = /[\\/]/.test(w) || w.startsWith(".") || w.startsWith("~") || /^[A-Za-z]:/.test(w);
    if (!looksLikePath) continue;
    if (w.startsWith("~")) return false;
    if (relToProject(w) !== null) continue;
    const abs = norm(path.resolve(cwd, w)).toLowerCase();
    if (READ_OUTSIDE_OK.some((ok) => abs.startsWith(ok.toLowerCase()))) continue;
    return false;
  }
  return true;
}

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
