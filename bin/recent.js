#!/usr/bin/env node
"use strict";

/**
 * HQ Recent Documents collector (Layer 1).
 *
 * Parses the freedesktop recent-files registry (~/.local/share/recently-used.xbel)
 * — populated by file managers, LibreOffice, PDF/image viewers, etc. — into a
 * "last opened" list for the dashboard. Zero LLM tokens.
 *
 * Usage:  node bin/recent.js collect [--limit N]
 *         node bin/recent.js show
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");
const OUT_PATH = path.join(DATA_DIR, "recent.json");
const HOME = os.homedir();
const XBEL = path.join(HOME, ".local/share/recently-used.xbel");

function homeRel(abs) {
  return abs.startsWith(HOME + path.sep) ? abs.slice(HOME.length + 1) : abs;
}

function collect(limit) {
  if (!fs.existsSync(XBEL)) {
    console.error(`No recent-files registry at ${XBEL}`);
    process.exit(1);
  }
  const xml = fs.readFileSync(XBEL, "utf8");
  const re =
    /<bookmark\s+href="([^"]+)"\s+added="([^"]*)"\s+modified="([^"]*)"\s+visited="([^"]*)"/g;
  const items = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const href = m[1];
    if (!href.startsWith("file://")) continue;
    let abs;
    try {
      abs = decodeURIComponent(href.replace(/^file:\/\//, ""));
    } catch {
      continue;
    }
    const opened = [m[3], m[4], m[2]].filter(Boolean).sort().pop() || null; // latest of modified/visited/added
    items.push({
      path: homeRel(abs),
      name: path.basename(abs),
      opened,
      openedDate: opened ? opened.slice(0, 10) : null,
      exists: fs.existsSync(abs),
    });
  }
  items.sort((a, b) => (b.opened || "").localeCompare(a.opened || ""));
  const top = items.slice(0, limit);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { generated: new Date().toISOString(), items: top },
      null,
      0,
    ) + "\n",
  );
  console.log(
    `Collected ${top.length} recently-opened docs (of ${items.length} in registry).`,
  );
}

function show() {
  if (!fs.existsSync(OUT_PATH)) {
    console.error("No recent data. Run: node bin/recent.js collect");
    process.exit(1);
  }
  const d = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
  for (const it of d.items) {
    console.log(
      `${it.openedDate || "?"}  ${it.exists ? " " : "✗"} ~/${it.path}`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? parseInt(args[li + 1], 10) || 25 : 25;
  switch (cmd) {
    case "collect":
      collect(limit);
      break;
    case "show":
    case undefined:
      show();
      break;
    default:
      console.error("Commands: collect [--limit N] | show");
      process.exit(1);
  }
}

main();
