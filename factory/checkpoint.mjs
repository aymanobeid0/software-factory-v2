#!/usr/bin/env node
// Factory checkpoint: external proof of tdd's red -> green loop, one test at a time.
// Works with any language: the test command comes from .factory/config.json (commands.junit) and
// results are read as JUnit XML, which vitest, jest, pytest, go (gotestsum), cargo-nextest and others emit.
//
// Orchestrator, before the implementer starts a ticket (records which tests already pass):
//   factory-checkpoint --start <ticket>
// Implementer, after making ONE more test pass:
//   factory-checkpoint <ticket> <words from the test name>
// Implementer, for a change no red test asks for (a typecheck error, a regression in an earlier ticket,
// a safeguard, a refactor the verifier or reviewer sent back):
//   factory-checkpoint --fix <ticket> <what was fixed>
//
// A cycle is accepted only if: the named test now passes, it was NOT passing at the previous checkpoint
// (it really was red), the source paths changed since then, no previously passing test in the ticket's
// file broke, and every earlier done ticket's file still passes.
// A fix is accepted only if: the source paths changed, nothing that passed before broke, it turned NO red
// test green (that needs a cycle), every earlier done ticket's file passes, and the typecheck is clean.
// Either way it commits the source paths and the log, so git history shows the order.
// Log: .factory/cycles/<ticket>.json
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadFrozenConfig, isSrcPath, doneTickets } from "./lib/config.mjs";
import { runTicketTests, runCommand } from "./lib/junit.mjs";

const args = process.argv.slice(2);
const mode = args[0] === "--start" ? "start" : args[0] === "--fix" ? "fix" : "cycle";
if (mode !== "cycle") args.shift();
const ticket = args.shift();
// Names are compared normalized: case-folded, and every run of non-alphanumerics becomes one space.
// So "empty cart" matches vitest's "prices an empty cart" and pytest's "test_empty_cart_prices".
const normName = (s) => ` ${s.toLowerCase().replace(/[^0-9a-z]+/g, " ").trim()} `;
const query = normName(args.join(" ")).trim();
if (!ticket || (mode !== "start" && !query)) fail("usage: factory-checkpoint [--start | --fix] <ticket> <test name words | what was fixed>");

const root = process.cwd();
let cfg;
try {
  cfg = loadFrozenConfig(root);
} catch (e) {
  fail(e.message);
}
if (!cfg) fail("no .factory/config.json in this project");

const logDir = path.join(root, ".factory", "cycles");
const logPath = path.join(logDir, `${ticket}.json`);

const now = runTicketTests(cfg, root, ticket);
if (now.problem) fail(now.problem);

if (mode === "start") {
  fs.mkdirSync(logDir, { recursive: true });
  const log = { ticket, testFile: now.testFile, baseline: now.passing, total: now.all.length, cycles: [] };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
  console.log(`checkpoint start: ${ticket}: ${now.passing.length}/${now.all.length} already passing`);
  process.exit(0);
}

if (!fs.existsSync(logPath)) fail(`ticket ${ticket} was not started (no ${path.relative(root, logPath)})`);
const log = JSON.parse(fs.readFileSync(logPath, "utf8"));
const before = new Set(log.cycles.length ? log.cycles.at(-1).passing : log.baseline);

const broke = [...before].filter((t) => !now.passing.includes(t));
if (broke.length) fail(`these tests passed before and now fail:\n  ${broke.join("\n  ")}`);
const newly = now.passing.filter((t) => !before.has(t));

const srcChanged = changedFiles().filter((f) => isSrcPath(cfg, f.replace(/\\/g, "/")));
if (srcChanged.length === 0) fail("no source file changed since the previous checkpoint.");

let entry, msg;
if (mode === "fix") {
  if (newly.length) fail(`a fix may not turn a red test green (${newly.length} did). Use a normal checkpoint for:\n  ${newly.join("\n  ")}`);
  if (cfg.commands.typecheck) {
    const tc = runCommand(cfg, root, cfg.commands.typecheck);
    if (!tc.ok) fail(`the typecheck is not clean${tc.timedOut ? " (it timed out)" : ""}: ${cfg.commands.typecheck}`);
  }
  entry = { n: log.cycles.length + 1, kind: "fix", note: args.join(" "), passing: now.passing };
  msg = `fix(${ticket}) ${entry.n}: ${args.join(" ")}`;
} else {
  // A test matches when all the query's words appear in its name as whole words, in order.
  const words = query.split(" ");
  const hasInOrder = (name) => {
    const w = normName(name).trim().split(" ");
    let i = 0;
    for (const x of w) if (x === words[i]) i++;
    return i === words.length;
  };
  const exact = now.all.filter((t) => normName(t).trim() === query);
  const matches = exact.length === 1 ? exact : now.all.filter(hasInOrder);
  if (matches.length === 0) fail(`no test in ${now.testFile} matches "${query}"`);
  if (matches.length > 1) fail(`"${query}" matches ${matches.length} tests, be more specific:\n  ${matches.join("\n  ")}`);
  const target = matches[0];
  if (!now.passing.includes(target)) fail(`"${target}" does not pass yet. Make it pass, then checkpoint.`);
  if (before.has(target)) fail(`"${target}" was already passing at the previous checkpoint: it was never red for you. Pick a test that is still failing. (For a change no red test asks for, use: factory-checkpoint --fix ${ticket} <what was fixed>)`);
  entry = { n: log.cycles.length + 1, kind: "cycle", test: target, alsoGreen: newly.filter((t) => t !== target), passing: now.passing };
  const extra = entry.alsoGreen.length ? ` (+${entry.alsoGreen.length} more)` : "";
  msg = `cycle(${ticket}) ${entry.n}: ${target}${extra}`;
}

// Earlier done tickets must stay green at every checkpoint, so a regression shows at once, not at the end.
for (const t of doneTickets(root).filter((t) => t !== ticket)) {
  const r = runTicketTests(cfg, root, t);
  if (r.problem) fail(`earlier ticket ${t}: ${r.problem}`);
  const bad = r.all.filter((x) => !r.passing.includes(x));
  if (bad.length) fail(`this change breaks earlier ticket ${t} (${r.testFile}):\n  ${bad.join("\n  ")}`);
}

log.cycles.push(entry);
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");

// Commit exactly these paths: anything else that happens to be staged stays out of the commit.
const paths = [...srcChanged, path.relative(root, logPath)];
must(git(["add", "--", ...paths]));
must(git(["commit", "-q", "-m", msg, "--", ...paths]));
const sha = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
console.log(`checkpoint ok ${sha}: ${msg}. Ticket: ${now.passing.length}/${now.all.length} passing.`);

// --- helpers ---

// Modified, added and untracked files, relative to the project root.
function changedFiles() {
  const r = git(["status", "--porcelain", "--untracked-files=all"]);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop());
}
function git(a) {
  return spawnSync("git", a, { cwd: root, encoding: "utf8" });
}
function must(r) {
  if (r.status !== 0) fail(`git failed: ${r.stderr}`);
}
function fail(m) {
  process.stderr.write(`CHECKPOINT REJECTED: ${m}\n`);
  process.exit(1);
}
