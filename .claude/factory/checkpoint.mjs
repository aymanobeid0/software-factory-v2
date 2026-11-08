#!/usr/bin/env node
// Factory checkpoint: external proof of tdd's red -> green loop, one test at a time.
// Works with any language: the test command comes from .factory/config.json (commands.junit) and
// results are read as JUnit XML, which vitest, jest, pytest, go (gotestsum), cargo-nextest and others emit.
//
// Orchestrator, before the implementer starts a ticket (records which tests already pass):
//   factory-checkpoint --start <ticket>
// Implementer, after making ONE more test pass:
//   factory-checkpoint <ticket> <words from the test name>
//
// A checkpoint is accepted only if: the named test now passes, it was NOT passing at the previous
// checkpoint (it really was red), the source paths changed since then, and no previously passing test
// in the ticket's file broke. Then it commits the source paths and the cycle log, so git history shows the order.
// Log: .factory/cycles/<ticket>.json
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, fill, ticketVars, testFileFor, envPath, globToRegExp } from "./lib/config.mjs";

const args = process.argv.slice(2);
const start = args[0] === "--start";
if (start) args.shift();
const ticket = args.shift();
// Names are compared normalized: case-folded, and every run of non-alphanumerics becomes one space.
// So "empty cart" matches vitest's "prices an empty cart" and pytest's "test_empty_cart_prices".
const normName = (s) => ` ${s.toLowerCase().replace(/[^0-9a-z]+/g, " ").trim()} `;
const query = normName(args.join(" ")).trim();
if (!ticket || (!start && !query)) fail("usage: factory-checkpoint [--start] <ticket> <test name words>");

const root = process.cwd();
let cfg;
try {
  cfg = loadConfig(root);
} catch (e) {
  fail(e.message);
}
if (!cfg) fail("no .factory/config.json in this project");
if (!cfg.commands.junit) fail('config.commands.junit is missing: the referee needs a command that writes JUnit XML to {out}');

const testFile = testFileFor(cfg, ticket);
if (!fs.existsSync(path.join(root, testFile))) fail(`no test file ${testFile} for ticket ${ticket}`);
const logDir = path.join(root, ".factory", "cycles");
const logPath = path.join(logDir, `${ticket}.json`);

const now = runTests();

if (start) {
  fs.mkdirSync(logDir, { recursive: true });
  const log = { ticket, testFile, baseline: now.passing, total: now.all.length, cycles: [] };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
  console.log(`checkpoint start: ${ticket}: ${now.passing.length}/${now.all.length} already passing`);
  process.exit(0);
}

if (!fs.existsSync(logPath)) fail(`ticket ${ticket} was not started (no ${path.relative(root, logPath)})`);
const log = JSON.parse(fs.readFileSync(logPath, "utf8"));
const before = new Set(log.cycles.length ? log.cycles.at(-1).passing : log.baseline);

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
if (matches.length === 0) fail(`no test in ${testFile} matches "${query}"`);
if (matches.length > 1) fail(`"${query}" matches ${matches.length} tests, be more specific:\n  ${matches.join("\n  ")}`);
const target = matches[0];

if (!now.passing.includes(target)) fail(`"${target}" does not pass yet. Make it pass, then checkpoint.`);
if (before.has(target)) fail(`"${target}" was already passing at the previous checkpoint: it was never red for you. Pick a test that is still failing.`);
const broke = [...before].filter((t) => !now.passing.includes(t));
if (broke.length) fail(`these tests passed before and now fail:\n  ${broke.join("\n  ")}`);

const srcChanged = changedFiles().filter(isSrc);
if (srcChanged.length === 0) fail("no source file changed since the previous checkpoint.");

const newly = now.passing.filter((t) => !before.has(t));
const cycle = { n: log.cycles.length + 1, test: target, alsoGreen: newly.filter((t) => t !== target), passing: now.passing };
log.cycles.push(cycle);
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");

const extra = cycle.alsoGreen.length ? ` (+${cycle.alsoGreen.length} more)` : "";
const msg = `cycle(${ticket}) ${cycle.n}: ${target}${extra}`;
must(git(["add", "--", ...srcChanged, path.relative(root, logPath)]));
must(git(["commit", "-q", "-m", msg]));
const sha = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
console.log(`checkpoint ok ${sha}: ${msg}. Ticket: ${now.passing.length}/${now.all.length} passing.`);

// --- helpers ---

function isSrc(rel) {
  const r = rel.replace(/\\/g, "/");
  const test = cfg.paths.tests.some((g) => globToRegExp(g).test(r));
  return !test && cfg.paths.src.some((g) => globToRegExp(g).test(r));
}

// Modified, added and untracked files, relative to the project root.
function changedFiles() {
  const r = git(["status", "--porcelain", "--untracked-files=all"]);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop());
}

function runTests() {
  const out = path.join(root, ".factory", `.junit-${process.pid}.xml`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  const q = (s) => `"${s}"`;
  const cmd = fill(cfg.commands.junit, { ...ticketVars(ticket), file: q(testFile), out: q(out) });
  spawnSync(cmd, { cwd: root, stdio: "ignore", shell: true, env: { ...process.env, PATH: envPath(cfg, root) } });
  if (!fs.existsSync(out)) fail(`the test command wrote no JUnit report. Command: ${cmd}`);
  const xml = fs.readFileSync(out, "utf8");
  fs.rmSync(out, { force: true });
  const cases = parseJUnit(xml);
  if (cases.length === 0) fail(`${testFile} produced no test results (did it load?)`);
  const all = cases.map((c) => c.name);
  const passing = cases.filter((c) => c.status === "passed").map((c) => c.name);
  return { all, passing };
}

// Minimal JUnit XML reader: <testcase name=".." classname=".."> with optional <failure>/<error>/<skipped>.
function parseJUnit(xml) {
  const decode = (s) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const attr = (tag, n) => {
    const m = tag.match(new RegExp(`\\s${n}="([^"]*)"`));
    return m ? decode(m[1]) : "";
  };
  const cases = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[3] || "";
    const status = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    cases.push({ name: attr(m[1], "name"), classname: attr(m[1], "classname"), status });
  }
  // Make names unique when two suites share a test name.
  const count = {};
  for (const c of cases) count[c.name] = (count[c.name] || 0) + 1;
  for (const c of cases) if (count[c.name] > 1) c.name = `${c.classname} > ${c.name}`;
  return cases;
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
