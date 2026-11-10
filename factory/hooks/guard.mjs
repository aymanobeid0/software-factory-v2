#!/usr/bin/env node
// Factory guard: PreToolUse hook that enforces each role's least-privilege rules.
// Usage (in the role settings run-role.sh generates): node <factory>/hooks/guard.mjs <role> [<config snapshot>]
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
//
// Nothing here is tied to a machine or a language. The project is the session cwd, and the rules come
// from the project's config: the snapshot run-role.sh took from git when the role started (so nothing
// the role runs can loosen its own rules), or else the config frozen in git.
//
// The guard judges tool calls. It is not a sandbox: code a role is allowed to run (its tests) runs with
// the role's OS permissions. verify.mjs is what catches the result of that (changed tests, plan or
// config; un-refereed commits).
import fs from "node:fs";
import path from "node:path";
import { FACTORY_HOME, loadConfigFile, loadFrozenConfig, isSrcPath, isTestPath } from "../lib/config.mjs";

const role = process.argv[2];
const snapshot = process.argv[3];
const ROLES = ["tester", "test-reviewer", "implementer", "reviewer"];

// Which project commands (from config.commands) each role may run.
const ROLE_COMMANDS = {
  tester: ["test", "testFile", "testOne"],
  "test-reviewer": [],
  implementer: ["test", "testFile", "testOne", "typecheck"],
  reviewer: [],
};
const GIT_READ = /^git (status|diff|log|show)(\s|$)/;
// Options that make a read-only git command write a file, read outside the repo, or run a program.
const GIT_UNSAFE = /^(--output(=|$)|--no-index$|--ext-diff$)/;
// The referee, put on PATH by run-role.sh. A cycle or a --fix, never --start (the orchestrator owns that).
const CHECKPOINT = /^factory-checkpoint (?:--fix )?(?!-)[0-9A-Za-z_-]+ \S/;

const READ_OUTSIDE_OK = [path.join(FACTORY_HOME, "matt-skills")].map(norm);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const ALWAYS_OK = new Set(["Skill", "TodoWrite", "ToolSearch"]);
// A newline separates commands just as ; does.
const SHELL_META = /[;&|<>`\n\r]|\$\(/;
const READ_CMDS = new Set(["cat", "ls", "head", "tail", "rg", "grep", "find", "wc", "pwd", "stat", "file", "tree", "sed",
  "get-content", "gc", "get-childitem", "gci", "dir", "type", "select-string", "sls", "test-path", "get-location"]);
// Options that turn a read-only command into one that writes a file or runs a program.
const READ_UNSAFE = {
  find: /^-(exec|execdir|delete|ok|okdir|fprint|fprint0|fprintf|fls)$/,
  rg: /^--(pre|pre-glob|hostname-bin)(=|$)/,
  tree: /^(-o|--output)/,
  file: /^(-C|--compile)$/,
};

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
  cfg = snapshot ? loadConfigFile(snapshot) : loadFrozenConfig(cwd);
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
  // Glob's pattern can itself point outside the project (an absolute path, or ../).
  const pat = tool === "Glob" ? String(ti.pattern || "") : "";
  if (pat && (path.isAbsolute(pat) || /^[A-Za-z]:/.test(pat) || pat.startsWith("~") || pat.split(/[\\/]/).includes(".."))) {
    const literal = pat.split(/[*?[{]/)[0];
    if (!insideAllowed(literal || pat)) block(`reading outside the project is not allowed (${pat})`);
  }
  const p = ti.file_path || ti.path;
  if (!p) process.exit(0);
  if (insideAllowed(p)) process.exit(0);
  block(`reading outside the project is not allowed (${p})`);
}

if (tool === "Bash" || tool === "exec_command" || tool === "shell") {
  const cmd = unwrapShell(ti.command ?? ti.cmd ?? "");
  if (SHELL_META.test(cmd)) block(`shell operators (; & | < > \` $( and line breaks) are not allowed: ${cmd}`);
  const words = tokens(cmd);
  const templates = [...new Set(ROLE_COMMANDS[role].map((k) => cfg.commands[k]).filter(Boolean))];
  const allowed =
    (GIT_READ.test(cmd) && !words.some((w) => GIT_UNSAFE.test(w))) ||
    templates.some((t) => matchesTemplate(t, words)) ||
    (role === "implementer" && CHECKPOINT.test(cmd)) ||
    isReadOnlyInsideProject(words);
  if (!allowed) {
    const list = templates.concat("git status/diff/log/show", "read-only file commands inside the project (cat, ls, rg, grep, head, tail, find, wc, Get-Content…)", role === "implementer" ? ["factory-checkpoint [--fix] <ticket> <words>"] : []);
    block(`role "${role}" may not run: ${cmd}. Allowed, exactly in these forms with no extra options: ${list.join(" | ")}`);
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

// Split a command into words, dropping one layer of quotes around a whole word.
function tokens(cmd) {
  return (cmd.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^(['"])([\s\S]*)\1$/, "$2"));
}

// A project command is allowed only in the exact shape of its template from the config: the fixed
// words must match, {file} must be a path inside the project, and {name} (a test name, when it is the
// last word) may be several words. No value may start with "-", so no extra option can be slipped in
// (an option like --outputFile=<path> would let a read-only role write files).
function matchesTemplate(template, words) {
  const tt = template.trim().split(/\s+/);
  let i = 0;
  for (let k = 0; k < tt.length; k++) {
    const t = tt[k];
    if (!t.includes("{")) {
      if (words[i] !== t) return false;
      i++;
      continue;
    }
    if (t === "{name}" && k === tt.length - 1) {
      const rest = words.slice(i);
      if (rest.length === 0 || rest.some((w) => w.startsWith("-"))) return false;
      i = words.length;
      continue;
    }
    if (i >= words.length) return false;
    const names = [];
    const re = new RegExp("^" + t.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, (m, n) => (names.push(n), "(.+)")) + "$");
    const m = re.exec(words[i]);
    if (!m) return false;
    for (let j = 0; j < names.length; j++) {
      const v = m[j + 1];
      if (v.startsWith("-")) return false;
      if (names[j] === "file" && relToProject(v) === null) return false;
    }
    i++;
  }
  return i === words.length;
}

// Read-only file commands are how Codex reads (it has no Read tool). Allowed when every path they
// name stays inside the project (or the pinned skills), and they carry no writing or executing options.
function isReadOnlyInsideProject(words) {
  if (!words.length) return false;
  const exe = words[0].toLowerCase();
  if (!READ_CMDS.has(exe)) return false;
  const args = words.slice(1);
  if (READ_UNSAFE[exe] && args.some((w) => READ_UNSAFE[exe].test(w))) return false;
  let pathArgs = args;
  if (exe === "sed") {
    // sed only for printing a line range: sed -n '<N>p' | '<N>,<M>p' <files>. Its w, e and r commands
    // and -i would write or execute, so no other script is accepted.
    if (args[0] !== "-n" || !/^(\d+|\$)(,(\d+|\$))?p$/.test(args[1] || "")) return false;
    pathArgs = args.slice(2);
    if (pathArgs.some((w) => w.startsWith("-"))) return false;
  }
  for (const w of pathArgs) {
    if (w.startsWith("-")) continue;
    const looksLikePath = /[\\/]/.test(w) || w.startsWith(".") || w.startsWith("~") || /^[A-Za-z]:/.test(w);
    if (!looksLikePath) continue;
    if (w.startsWith("~")) return false;
    if (!insideAllowed(w)) return false;
  }
  return true;
}

function insideAllowed(p) {
  if (relToProject(p) !== null) return true;
  const abs = norm(path.resolve(cwd, p)).toLowerCase();
  return READ_OUTSIDE_OK.some((ok) => abs.startsWith(ok.toLowerCase()));
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
