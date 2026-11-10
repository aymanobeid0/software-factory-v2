#!/usr/bin/env node
// Factory verifier: a script, not an agent. It runs every check itself and prints a verdict, so no
// agent's word is needed for PASS. Exit 0 = PASS, 1 = FAIL. Run from the project root.
//
//   node <factory>/verify.mjs red
//   node <factory>/verify.mjs ticket --ticket <t> --ticket-start <commit> [--tests-commit <c>] [--done a,b]
//   node <factory>/verify.mjs green  [--tests-commit <c>] [--plan-commit <c>]
//
// tests_commit, plan_commit and the done tickets default to what .factory/state.json records.
//
// red:    every ticket has its test file, every file loads, and every test fails (0 pass, 0 errors).
// ticket: the ticket's file and every earlier done ticket's file pass; typecheck clean; test files
//         unchanged since tests_commit; and the checkpoint evidence holds: every commit since
//         ticket_start is a referee commit (cycle/fix), the log matches git, those commits touch only
//         source files and the log, and no source change is left uncommitted.
// green:  every ticket's file passes, the full test command exits 0, typecheck clean, and neither the
//         test files nor the plan files changed since they were frozen.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadFrozenConfig, isSrcPath, isTestPath, listTickets, doneTickets } from "./lib/config.mjs";
import { runTicketTests, runCommand } from "./lib/junit.mjs";

const argv = process.argv.slice(2);
const mode = argv.shift();
const opt = {};
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
if (!["red", "ticket", "green"].includes(mode)) usage();

const root = process.cwd();
let cfg;
try {
  cfg = loadFrozenConfig(root);
} catch (e) {
  usage(e.message);
}
if (!cfg) usage("no .factory/config.json in this project");

let state = {};
try {
  state = JSON.parse(fs.readFileSync(path.join(root, ".factory", "state.json"), "utf8"));
} catch {}
const testsCommit = opt["tests-commit"] || state.tests_commit;
const planCommit = opt["plan-commit"] || state.plan_commit;
const tickets = listTickets(root);

const reasons = [];
const lines = [];
const no = (why) => reasons.push(why);

if (tickets.length === 0) no("no tickets in tickets/");

if (mode === "red") {
  let total = 0, passing = 0;
  for (const t of tickets) {
    const r = runTicketTests(cfg, root, t);
    if (r.problem) { no(`${t}: ${r.problem}`); continue; }
    total += r.all.length;
    passing += r.passing.length;
    if (r.errored.length) no(`${t}: ${r.errored.length} test(s) could not run (load or setup error), e.g. "${r.errored[0]}"`);
    if (r.passing.length) no(`${t}: ${r.passing.length} test(s) pass against the stub, e.g. "${r.passing[0]}"`);
  }
  lines.push(`tests: ${total} tests in ${tickets.length} files, ${passing} passing`);
}

if (mode === "ticket") {
  const ticket = opt.ticket;
  const start = opt["ticket-start"];
  if (!ticket || !start) usage("ticket mode needs --ticket and --ticket-start");
  if (!testsCommit) usage("no tests_commit (pass --tests-commit or record it in .factory/state.json)");
  const done = (opt.done ? opt.done.split(",").filter(Boolean) : doneTickets(root)).filter((t) => t !== ticket);

  const summaries = [];
  let mine = null;
  for (const t of [...done, ticket]) {
    const r = runTicketTests(cfg, root, t);
    if (t === ticket) mine = r;
    if (r.problem) { no(`${t}: ${r.problem}`); continue; }
    summaries.push(`${r.testFile} ${r.passing.length}/${r.all.length}`);
    const bad = r.all.filter((x) => !r.passing.includes(x));
    if (bad.length) no(`${t}: ${bad.length} test(s) not passing, e.g. "${bad[0]}"`);
  }
  lines.push(`done tickets: ${summaries.join(", ")}`);

  let early = 0, later = 0;
  for (const t of tickets.filter((t) => t !== ticket && !done.includes(t))) {
    const r = runTicketTests(cfg, root, t);
    if (r.problem) continue;
    later += r.all.length;
    early += r.passing.length;
  }
  lines.push(`later tickets passing early: ${early} of ${later}`);

  typecheck();
  testsUnchanged();

  // Checkpoint evidence.
  const problems = [];
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(path.join(root, ".factory", "cycles", `${ticket}.json`), "utf8")).cycles;
  } catch {
    problems.push("no cycle log");
  }
  const log = git(["log", "--format=%s", `${start}..HEAD`]);
  if (log.status !== 0) problems.push(`bad ticket_start ${start}`);
  const subjects = log.stdout.split("\n").filter(Boolean);
  const tag = new RegExp(`^(cycle|fix)\\(${ticket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) \\d+:`);
  const foreign = subjects.filter((s) => !tag.test(s));
  if (foreign.length) problems.push(`${foreign.length} commit(s) not made by the referee, e.g. "${foreign[0]}"`);
  if (subjects.length !== entries.length) problems.push(`${subjects.length} commits but ${entries.length} log entries`);
  if (mine && !mine.problem && entries.length) {
    const last = new Set(entries.at(-1).passing);
    if (mine.all.some((x) => !last.has(x))) problems.push("the last checkpoint does not cover every test in the ticket's file");
  }
  const logRel = `.factory/cycles/${ticket}.json`;
  const outside = git(["diff", "--name-only", start, "HEAD"]).stdout.split("\n").filter(Boolean).filter((f) => f !== logRel && !isSrcPath(cfg, f));
  if (outside.length) problems.push(`referee commits touch non-source files: ${outside.join(", ")}`);
  const dirty = uncommitted().filter((f) => isSrcPath(cfg, f));
  if (dirty.length) problems.push(`uncommitted source changes: ${dirty.join(", ")}`);
  const cycles = entries.filter((e) => e.kind !== "fix");
  const maxAlso = Math.max(0, ...cycles.map((e) => (e.alsoGreen || []).length));
  lines.push(`checkpoints: ${cycles.length} cycles, ${entries.length - cycles.length} fixes, max alsoGreen in one cycle: ${maxAlso}, log matches git: ${problems.length ? "no: " + problems.join("; ") : "yes"}`);
  if (problems.length) no(`checkpoint evidence: ${problems.join("; ")}`);
}

if (mode === "green") {
  if (!testsCommit) usage("no tests_commit (pass --tests-commit or record it in .factory/state.json)");
  if (!planCommit) usage("no plan_commit (pass --plan-commit or record it in .factory/state.json)");
  let total = 0, passing = 0;
  for (const t of tickets) {
    const r = runTicketTests(cfg, root, t);
    if (r.problem) { no(`${t}: ${r.problem}`); continue; }
    total += r.all.length;
    passing += r.passing.length;
    const bad = r.all.filter((x) => !r.passing.includes(x));
    if (bad.length) no(`${t}: ${bad.length} test(s) not passing, e.g. "${bad[0]}"`);
  }
  const full = runCommand(cfg, root, cfg.commands.test);
  if (!full.ok) no(`the full test command failed${full.timedOut ? " (timed out)" : ""}: ${cfg.commands.test}`);
  lines.push(`tests: ${passing}/${total} passing in ${tickets.length} files; full run: ${full.ok ? "ok" : "failed"}`);
  typecheck();
  testsUnchanged();
  const plan = changedSince(planCommit).filter((f) => f === "SPEC.md" || f === "GLOSSARY.md" || f === ".factory/config.json" || f.startsWith("docs/") || f.startsWith("tickets/"));
  lines.push(`plan changed since plan_commit: ${plan.length ? "yes: " + plan.join(", ") : "no"}`);
  if (plan.length) no(`plan files changed since ${planCommit}: ${plan.join(", ")}`);
}

console.log(`VERDICT: ${reasons.length ? "FAIL" : "PASS"}`);
for (const l of lines) console.log(l);
for (const r of reasons) console.log(`reason: ${r}`);
process.exit(reasons.length ? 1 : 0);

// --- helpers ---

function typecheck() {
  if (!cfg.commands.typecheck) return lines.push("typecheck: none for this project");
  const r = runCommand(cfg, root, cfg.commands.typecheck);
  lines.push(`typecheck: ${r.ok ? "clean" : r.timedOut ? "timed out" : "errors"}`);
  if (!r.ok) no(`typecheck not clean: ${cfg.commands.typecheck}`);
}
function testsUnchanged() {
  const changed = changedSince(testsCommit).filter((f) => isTestPath(cfg, f));
  lines.push(`tests changed since tests_commit: ${changed.length ? "yes: " + changed.join(", ") : "no"}`);
  if (changed.length) no(`test files changed since ${testsCommit}: ${changed.join(", ")}`);
}
// Files that differ from a commit: committed since, modified on disk, or untracked.
function changedSince(commit) {
  const d = git(["diff", "--name-only", commit]);
  if (d.status !== 0) { no(`bad commit ${commit}`); return []; }
  return [...new Set([...d.stdout.split("\n").filter(Boolean), ...uncommitted()])];
}
function uncommitted() {
  return git(["status", "--porcelain", "--untracked-files=all"]).stdout
    .split("\n").filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop().replace(/\\/g, "/"));
}
function git(a) {
  return spawnSync("git", a, { cwd: root, encoding: "utf8" });
}
function usage(m) {
  process.stderr.write(`${m ? m + "\n" : ""}usage: verify.mjs red | ticket --ticket <t> --ticket-start <commit> [--tests-commit <c>] [--done a,b] | green [--tests-commit <c>] [--plan-commit <c>]\n`);
  process.exit(2);
}
