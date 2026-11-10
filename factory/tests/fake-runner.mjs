// A stand-in test runner for the factory's own tests. A "test file" is JSON: [{ "name": "...", "needs": "TOKEN" }].
// A test passes when src/impl.txt contains its token. needs "!" = always errors (as if the file can't load).
//   node fake-runner.mjs <test file> <junit out>     writes JUnit XML
//   node fake-runner.mjs --all                       exit 1 if any test in tests/ fails
//   node fake-runner.mjs --typecheck                 exit 1 if src/impl.txt contains TYPEERROR
import fs from "node:fs";
const impl = fs.existsSync("src/impl.txt") ? fs.readFileSync("src/impl.txt", "utf8") : "";
const run = (f) => JSON.parse(fs.readFileSync(f, "utf8")).map((t) => ({ name: t.name, st: t.needs === "!" ? "error" : impl.includes(t.needs) ? "pass" : "fail" }));
const [a, b] = process.argv.slice(2);
if (a === "--typecheck") process.exit(impl.includes("TYPEERROR") ? 1 : 0);
if (a === "--all") {
  const bad = fs.readdirSync("tests").flatMap((f) => run(`tests/${f}`)).some((t) => t.st !== "pass");
  process.exit(bad ? 1 : 0);
}
const xml = run(a).map((t) => `<testcase classname="s" name="${t.name}">${t.st === "fail" ? '<failure message="x"/>' : t.st === "error" ? '<error message="x"/>' : ""}</testcase>`).join("");
fs.writeFileSync(b, `<testsuites><testsuite>${xml}</testsuite></testsuites>`);
