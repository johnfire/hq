#!/usr/bin/env node
"use strict";

/**
 * HQ Index Enrichment — one-line descriptions per project.
 *
 * Deterministic-first (ZERO tokens): pulls a description from package.json or the
 * project's README before ever considering the LLM. Reports how many projects still
 * lack a description so the LLM pass is bounded and its cost is visible — never a
 * silent token spend (governor philosophy).
 *
 * Writes data/descriptions.json: { "<home-rel path>": { desc, source } }.
 * `index.js find` and the dashboard merge these in.
 *
 * Usage:
 *   node bin/enrich.js auto      # deterministic extraction, report gaps
 *   node bin/enrich.js gaps      # list projects still missing a description
 *   node bin/enrich.js set <path> <description...>   # set one manually / from LLM
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const DESC_PATH = path.join(DATA_DIR, "descriptions.json");
const HOME = os.homedir();

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error("No index. Run: node bin/index.js build");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}
function loadDesc() {
  return fs.existsSync(DESC_PATH)
    ? JSON.parse(fs.readFileSync(DESC_PATH, "utf8"))
    : {};
}
function saveDesc(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DESC_PATH, JSON.stringify(d, null, 2) + "\n");
}

function fromPackageJson(abs) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(abs, "package.json"), "utf8"),
    );
    if (pkg.description && pkg.description.trim())
      return pkg.description.trim();
  } catch {}
  return null;
}

function fromReadme(abs) {
  for (const name of [
    "README.md",
    "readme.md",
    "Readme.md",
    "README.txt",
    "README",
  ]) {
    const p = path.join(abs, name);
    if (!fs.existsSync(p)) continue;
    let lines;
    try {
      lines = fs.readFileSync(p, "utf8").split("\n");
    } catch {
      continue;
    }
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (
        line.startsWith("<!--") ||
        line.startsWith("![") ||
        /^[-=*_]{3,}$/.test(line)
      )
        continue;
      if (/^\[!\[/.test(line)) continue; // badge links
      line = line.replace(/^#+\s*/, "").trim(); // strip heading markers
      if (!line) continue;
      return line.slice(0, 160);
    }
  }
  return null;
}

function auto() {
  const index = loadIndex();
  const desc = loadDesc();
  const projects = index.items.filter((it) => it.type === "project");
  let added = 0,
    kept = 0,
    missing = 0;

  for (const it of projects) {
    if (desc[it.path] && desc[it.path].source !== "auto-miss") {
      kept++;
      continue;
    }
    const abs = path.join(HOME, it.path);
    const fromPkg = fromPackageJson(abs);
    const fromRd = fromPkg ? null : fromReadme(abs);
    const text = fromPkg || fromRd;
    if (text) {
      desc[it.path] = {
        desc: text,
        source: fromPkg ? "package.json" : "readme",
      };
      added++;
    } else {
      desc[it.path] = { desc: null, source: "auto-miss" };
      missing++;
    }
  }
  saveDesc(desc);
  console.log(
    `Projects: ${projects.length}  ·  described now: ${added}  ·  already set: ${kept}  ·  still missing: ${missing}`,
  );
  console.log(
    `\nDeterministic pass used ZERO tokens. For the ${missing} missing ones:`,
  );
  console.log(`  node bin/enrich.js gaps              # see them`);
  console.log(
    `  node bin/enrich.js set <path> "..."  # fill (manually or from an LLM batch)`,
  );
}

function gaps() {
  const desc = loadDesc();
  const missing = Object.entries(desc).filter(([, v]) => !v.desc);
  if (!missing.length) {
    console.log("No gaps — every project has a description.");
    return;
  }
  console.log(`${missing.length} project(s) without a description:\n`);
  for (const [p] of missing) {
    const abs = path.join(HOME, p);
    let sample = "";
    try {
      sample = fs
        .readdirSync(abs)
        .filter((f) => !f.startsWith("."))
        .slice(0, 6)
        .join(", ");
    } catch {}
    console.log(`~/${p}\n   contents: ${sample}\n`);
  }
}

function set(args) {
  const p = args[0];
  const text = args.slice(1).join(" ").trim();
  if (!p || !text) {
    console.error(
      'Usage: node bin/enrich.js set <home-rel-path> "<description>"',
    );
    process.exit(1);
  }
  const desc = loadDesc();
  desc[p] = { desc: text.slice(0, 200), source: "manual" };
  saveDesc(desc);
  console.log(`Set: ~/${p}\n   → ${text}`);
}

function gapsJson() {
  const desc = loadDesc();
  const missing = Object.entries(desc)
    .filter(([, v]) => !v.desc)
    .map(([p]) => p);
  const out = missing.map((p) => {
    const abs = path.join(HOME, p);
    let contents = [];
    try {
      contents = fs
        .readdirSync(abs)
        .filter((f) => !f.startsWith("."))
        .slice(0, 14);
    } catch {}
    return { path: p, contents };
  });
  process.stdout.write(JSON.stringify(out) + "\n");
}

function setBatch(args) {
  const file = args[0];
  if (!file) {
    console.error("Usage: node bin/enrich.js set-batch <json-file>");
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(file, "utf8"));
  const desc = loadDesc();
  let n = 0;
  for (const [p, text] of Object.entries(batch)) {
    if (text && String(text).trim()) {
      desc[p] = { desc: String(text).trim().slice(0, 200), source: "llm" };
      n++;
    }
  }
  saveDesc(desc);
  console.log(`Batch set ${n} description(s).`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "auto":
      auto();
      break;
    case "gaps":
      gaps();
      break;
    case "gaps-json":
      gapsJson();
      break;
    case "set":
      set(rest);
      break;
    case "set-batch":
      setBatch(rest);
      break;
    default:
      console.error(
        "Commands: auto | gaps | gaps-json | set <path> <desc> | set-batch <file>",
      );
      process.exit(1);
  }
}

main();
