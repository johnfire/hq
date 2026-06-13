#!/usr/bin/env node
"use strict";

/**
 * HQ Project Index (Layer 1 — the map).
 *
 * Walks the configured work roots and builds a searchable catalog of folders and
 * documents: what exists, where, what state (active/inactive/archived), last touched.
 *
 * Index, do NOT reorganize. This only reads + records. Nothing is moved.
 * The index points to files; it never replaces them. Files stay the source of truth.
 *
 * Zero dependencies. Path-portable: roots are stored home-relative and resolved
 * against the current machine's home dir, so it works the same on desktop + laptop.
 *
 * Usage:
 *   node bin/index.js build              # crawl roots, write data/index.json
 *   node bin/index.js find <keywords>    # keyword search (zero tokens)
 *   node bin/index.js find --type doc <keywords>
 *   node bin/index.js stats              # counts by root / status / type
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(HQ_ROOT, "index-config.json");
const DATA_DIR = path.join(HQ_ROOT, "data");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const HOME = os.homedir();

const DEFAULT_CONFIG = {
  roots: ["ppp2", "ai-workzone", "Documents", "Downloads", "Art World"],
  skip_dirs: [
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    "vendor",
    "coverage",
    "Pods",
    "__pycache__",
    "venv",
    "env",
  ],
  skip_hidden: true,
  doc_exts: [
    ".md",
    ".pdf",
    ".docx",
    ".doc",
    ".txt",
    ".odt",
    ".pptx",
    ".xlsx",
    ".csv",
    ".key",
    ".pages",
  ],
  archived_segments: ["archived", "archive"],
  inactive_segments: ["a-inactive", "inactive", "deprecated"],
  max_items: 50000,
};

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return Object.assign(
      {},
      DEFAULT_CONFIG,
      JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")),
    );
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  return DEFAULT_CONFIG;
}

function homeRel(abs) {
  return abs.startsWith(HOME + path.sep) ? abs.slice(HOME.length + 1) : abs;
}

function statusOf(relPath, cfg) {
  const segs = relPath.toLowerCase().split(path.sep);
  for (const s of segs) {
    if (cfg.archived_segments.includes(s)) return "archived";
    if (cfg.inactive_segments.includes(s)) return "inactive";
  }
  return "active";
}

function build() {
  const cfg = loadConfig();
  const items = [];
  let pruned = 0;
  let truncated = false;

  function walk(absDir, rootName, depth) {
    if (items.length >= cfg.max_items) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (cfg.skip_hidden && ent.name.startsWith(".")) {
          pruned++;
          continue;
        }
        if (cfg.skip_dirs.includes(ent.name)) {
          pruned++;
          continue;
        }
        const rel = homeRel(abs);
        let mtime = null;
        try {
          mtime = fs.statSync(abs).mtime.toISOString().slice(0, 10);
        } catch {}
        items.push({
          path: rel,
          name: ent.name,
          type: depth === 1 ? "project" : "dir",
          root: rootName,
          depth,
          status: statusOf(rel, cfg),
          mtime,
        });
        walk(abs, rootName, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!cfg.doc_exts.includes(ext)) continue;
        const rel = homeRel(abs);
        let mtime = null;
        try {
          mtime = fs.statSync(abs).mtime.toISOString().slice(0, 10);
        } catch {}
        items.push({
          path: rel,
          name: ent.name,
          type: "doc",
          root: rootName,
          depth,
          status: statusOf(rel, cfg),
          mtime,
          ext,
        });
      }
    }
  }

  for (const root of cfg.roots) {
    const abs = path.join(HOME, root);
    if (!fs.existsSync(abs)) {
      console.warn(`! root not found, skipping: ~/${root}`);
      continue;
    }
    items.push({
      path: root,
      name: root,
      type: "root",
      root,
      depth: 0,
      status: "active",
      mtime: null,
    });
    walk(abs, root, 1);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {
    generated: new Date().toISOString(),
    machine: os.hostname(),
    home: HOME,
    roots: cfg.roots,
    counts: summarize(items),
    pruned_dirs: pruned,
    truncated,
    items,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(out, null, 0) + "\n");

  console.log(
    `Indexed ${items.length} items across ${cfg.roots.length} roots (pruned ${pruned} junk dirs).`,
  );
  printCounts(out.counts);
  if (truncated)
    console.log(
      `! Hit max_items cap (${cfg.max_items}) — index is incomplete. Raise the cap.`,
    );
  console.log(`\nWritten: ${homeRel(INDEX_PATH)}`);
}

function summarize(items) {
  const byRoot = {},
    byStatus = {},
    byType = {};
  for (const it of items) {
    byRoot[it.root] = (byRoot[it.root] || 0) + 1;
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    byType[it.type] = (byType[it.type] || 0) + 1;
  }
  return { byRoot, byStatus, byType };
}

function printCounts(c) {
  const fmtObj = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
  console.log(`  type:   ${fmtObj(c.byType)}`);
  console.log(`  status: ${fmtObj(c.byStatus)}`);
  console.log(`  root:   ${fmtObj(c.byRoot)}`);
}

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error("No index yet. Run: node bin/index.js build");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}

function find(args) {
  let typeFilter = null;
  const tokens = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type") {
      typeFilter = args[++i];
    } else tokens.push(args[i].toLowerCase());
  }
  if (!tokens.length) {
    console.error(
      "Usage: node bin/index.js find [--type doc|project|dir] <keywords>",
    );
    process.exit(1);
  }
  const idx = loadIndex();
  const descMap = loadDescriptions();
  const pool = typeFilter
    ? idx.items.filter((it) => it.type === typeFilter)
    : idx.items;

  const scored = [];
  for (const it of pool) {
    const name = it.name.toLowerCase();
    const p = it.path.toLowerCase();
    const descObj = descMap[it.path];
    const desc = descObj && descObj.desc ? descObj.desc : "";
    const d = desc.toLowerCase();
    let allMatched = true,
      score = 0;
    for (const t of tokens) {
      const inName = name.includes(t);
      const inPath = p.includes(t);
      const inDesc = d.includes(t);
      if (!inName && !inPath && !inDesc) allMatched = false;
      score += (inName ? 3 : 0) + (inPath ? 1 : 0) + (inDesc ? 2 : 0);
    }
    if (allMatched) {
      scored.push({ it, score, desc });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || (b.it.mtime || "").localeCompare(a.it.mtime || ""),
  );

  if (!scored.length) {
    console.log(`No matches for: ${tokens.join(" ")}`);
    return;
  }
  const top = scored.slice(0, 20);
  console.log(
    `${scored.length} match(es) for "${tokens.join(" ")}" — top ${top.length}:\n`,
  );
  for (const { it, desc } of top) {
    const badge =
      it.type === "doc"
        ? "📄"
        : it.type === "project"
          ? "📦"
          : it.type === "root"
            ? "🏠"
            : "📁";
    const stat = it.status === "active" ? "" : ` (${it.status})`;
    const when = it.mtime ? `  ${it.mtime}` : "";
    console.log(`${badge} ~/${it.path}${stat}${when}`);
    if (desc) console.log(`     ${desc}`);
  }
}

function loadDescriptions() {
  const p = path.join(DATA_DIR, "descriptions.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function stats() {
  const idx = loadIndex();
  console.log(
    `HQ Project Index — generated ${idx.generated.slice(0, 16).replace("T", " ")} on ${idx.machine}`,
  );
  console.log(
    `Total items: ${idx.items.length}  (pruned ${idx.pruned_dirs} junk dirs)`,
  );
  printCounts(idx.counts);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "build":
      build();
      break;
    case "find":
      find(rest);
      break;
    case "stats":
    case undefined:
      stats();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Commands: build | find | stats");
      process.exit(1);
  }
}

main();
