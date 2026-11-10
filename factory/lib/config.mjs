// Shared helpers for the factory: project config, globs, command templates.
// No paths are hard-coded: the factory locates itself from this file, the project is the cwd.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const FACTORY_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function check(c) {
  for (const k of ["paths", "testFile", "commands"]) {
    if (!c[k]) throw new Error(`.factory/config.json is missing "${k}"`);
  }
  return c;
}

export function loadConfigFile(p) {
  if (!fs.existsSync(p)) return null;
  return check(JSON.parse(fs.readFileSync(p, "utf8")));
}

export function loadConfig(root) {
  return loadConfigFile(path.join(root, ".factory", "config.json"));
}

// The config as frozen in git (HEAD), not the copy on disk: code a role runs (its tests) could rewrite
// the file on disk, but it cannot change what the plan commit holds. Falls back to disk when the file
// isn't committed yet (the planner checking its commands before the freeze).
export function loadFrozenConfig(root) {
  const r = spawnSync("git", ["show", "HEAD:.factory/config.json"], { cwd: root, encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return check(JSON.parse(r.stdout));
  return loadConfig(root);
}

// Ticket stems from tickets/*.md, in order.
export function listTickets(root) {
  const dir = path.join(root, "tickets");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
}

// Tickets the orchestrator has already marked done in .factory/state.json.
export function doneTickets(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, ".factory", "state.json"), "utf8"));
    return Object.entries(s.tickets || {}).filter(([, st]) => st === "green" || st === "reviewed").map(([t]) => t).sort();
  } catch {
    return [];
  }
}

// Glob -> RegExp. ** = any depth (including none), * = within one folder, ? = one char.
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}
export const matchesAny = (rel, globs = []) => globs.some((g) => globToRegExp(g).test(rel));
export const isTestPath = (cfg, rel) => matchesAny(rel, cfg.paths.tests);
export const isSrcPath = (cfg, rel) => matchesAny(rel, cfg.paths.src) && !isTestPath(cfg, rel);

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
export const ticketVars = (ticket) => ({ ticket, ticket_snake: ticket.replace(/[^0-9A-Za-z]+/g, "_") });
export const testFileFor = (cfg, ticket) => fill(cfg.testFile, ticketVars(ticket));

// The fixed part of a command template, before its first placeholder: what the guard allows as a prefix.
export function commandPrefix(template) {
  if (!template) return null;
  const cut = template.indexOf("{");
  return (cut === -1 ? template : template.slice(0, cut)).trim();
}

// Directories (relative) to prepend to PATH for project commands, e.g. a Python venv.
export function envPath(cfg, root) {
  const extra = (cfg.env?.pathPrepend || []).map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  return [...extra, process.env.PATH || process.env.Path || ""].join(path.delimiter);
}
