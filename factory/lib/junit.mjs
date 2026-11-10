// Run a ticket's test file through the project's JUnit command and read the per-test results.
// Shared by the referee (checkpoint.mjs) and the verifier (verify.mjs), so both judge the same way.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fill, ticketVars, testFileFor, envPath } from "./config.mjs";

// Seconds one project command (tests, typecheck) may run before it is killed. A hung test must not hang the line.
export const timeoutMs = (cfg) => (Number(cfg.timeoutSeconds) > 0 ? Number(cfg.timeoutSeconds) : 600) * 1000;

let seq = 0;

// -> { testFile, all, passing, failed, errored } or { testFile, problem: "<why there are no results>" }
export function runTicketTests(cfg, root, ticket) {
  const testFile = testFileFor(cfg, ticket);
  if (!fs.existsSync(path.join(root, testFile))) return { testFile, problem: `no test file ${testFile} for ticket ${ticket}` };
  if (!cfg.commands.junit) return { testFile, problem: "config.commands.junit is missing: a command that writes JUnit XML to {out} is required" };
  const out = path.join(root, ".factory", `.junit-${process.pid}-${seq++}.xml`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  const q = (s) => `"${s}"`;
  const cmd = fill(cfg.commands.junit, { ...ticketVars(ticket), file: q(testFile), out: q(out) });
  const r = spawnSync(cmd, { cwd: root, stdio: "ignore", shell: true, timeout: timeoutMs(cfg), env: { ...process.env, PATH: envPath(cfg, root) } });
  if (r.error && r.error.code === "ETIMEDOUT") {
    fs.rmSync(out, { force: true });
    return { testFile, problem: `the test command timed out after ${timeoutMs(cfg) / 1000}s. Command: ${cmd}` };
  }
  if (!fs.existsSync(out)) return { testFile, problem: `the test command wrote no JUnit report. Command: ${cmd}` };
  const xml = fs.readFileSync(out, "utf8");
  fs.rmSync(out, { force: true });
  const cases = parseJUnit(xml);
  if (cases.length === 0) return { testFile, problem: `${testFile} produced no test results (did it load?)` };
  const pick = (st) => cases.filter((c) => c.status === st).map((c) => c.name);
  return { testFile, all: cases.map((c) => c.name), passing: pick("passed"), failed: pick("failed"), errored: pick("errored") };
}

// Run a plain project command (typecheck, the full test run). -> { ok, timedOut }
export function runCommand(cfg, root, cmd) {
  const r = spawnSync(cmd, { cwd: root, stdio: "ignore", shell: true, timeout: timeoutMs(cfg), env: { ...process.env, PATH: envPath(cfg, root) } });
  return { ok: r.status === 0, timedOut: !!(r.error && r.error.code === "ETIMEDOUT") };
}

// Minimal JUnit XML reader: <testcase name=".." classname=".."> with optional <failure>/<error>/<skipped>.
// <error> is kept apart from <failure>: runners use it when a test could not run at all (collection, setup).
export function parseJUnit(xml) {
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
    const status = /<error\b/.test(body) ? "errored" : /<failure\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    cases.push({ name: attr(m[1], "name"), classname: attr(m[1], "classname"), status });
  }
  // Make names unique when two suites share a test name.
  const count = {};
  for (const c of cases) count[c.name] = (count[c.name] || 0) + 1;
  for (const c of cases) if (count[c.name] > 1) c.name = `${c.classname} > ${c.name}`;
  return cases;
}
