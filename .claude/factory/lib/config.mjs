// Shared helpers for the factory: project config, globs, command templates.
// No paths are hard-coded: the factory locates itself from this file, the project is the cwd.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FACTORY_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(root) {
  const p = path.join(root, ".factory", "config.json");
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const k of ["paths", "testFile", "commands"]) {
    if (!c[k]) throw new Error(`.factory/config.json is missing "${k}"`);
  }
  return c;
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
