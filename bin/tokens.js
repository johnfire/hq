#!/usr/bin/env node
"use strict";

/**
 * HQ Token collector (Layer 1).
 *
 * Derives real token spend from Claude Code's own session transcripts
 * (~/.claude/projects/<slug>/<session>.jsonl) — every assistant message records
 * a `usage` block with a timestamp. Nothing else feeds the governor, so without
 * this the fuel gauge always reads zero.
 *
 * Regenerates data/token-ledger.jsonl from scratch each run (idempotent — safe
 * on a cron). Only keeps entries inside a lookback window so the file stays lean.
 * Zero LLM tokens.
 *
 * Usage:  node bin/tokens.js collect [--lookback-hours N]   (default 12)
 *         node bin/tokens.js show
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");
const LEDGER_PATH = path.join(DATA_DIR, "token-ledger.jsonl");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// Total tokens that flowed through a request — the measure the 5h quota wall
// cares about. cache_read is cheaper in $ but still counts toward throughput.
function totalTokens(u) {
  if (!u) return 0;
  return (
    (u.input_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) +
    (u.output_tokens || 0)
  );
}

function projectName(cwd) {
  if (!cwd) return "unknown";
  return path.basename(cwd) || "unknown";
}

function listTranscripts(sinceMs) {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const slug of fs.readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, slug);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(dir, f);
      try {
        if (fs.statSync(fp).mtimeMs >= sinceMs) out.push(fp);
      } catch {}
    }
  }
  return out;
}

function collect(lookbackHours) {
  const now = Date.now();
  const cutoff = now - lookbackHours * 3600 * 1000;
  const files = listTranscripts(cutoff);
  const seen = new Set(); // dedupe by message uuid
  const entries = [];

  for (const fp of files) {
    let text;
    try {
      text = fs.readFileSync(fp, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim() || !line.includes('"usage"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type !== "assistant") continue;
      const msg = d.message || {};
      const tokens = totalTokens(msg.usage);
      if (!tokens) continue;
      const ts = Date.parse(d.timestamp);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const uuid = d.uuid || `${fp}:${ts}`;
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      entries.push({
        ts,
        project: projectName(d.cwd),
        label: msg.model || "",
        tokens,
        kind: "claude-code",
      });
    }
  }

  entries.sort((a, b) => a.ts - b.ts);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    LEDGER_PATH,
    entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""),
  );

  const total = entries.reduce((s, e) => s + e.tokens, 0);
  console.log(
    `Collected ${entries.length} assistant turns from ${files.length} transcripts ` +
      `(last ${lookbackHours}h): ${total.toLocaleString()} tokens.`,
  );
}

function show() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.error("No ledger. Run: node bin/tokens.js collect");
    process.exit(1);
  }
  const byProject = {};
  for (const line of fs.readFileSync(LEDGER_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    byProject[e.project] = (byProject[e.project] || 0) + e.tokens;
  }
  for (const [p, t] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
    console.log(`${t.toLocaleString().padStart(12)}  ${p}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const li = args.indexOf("--lookback-hours");
  const lookback = li >= 0 ? parseInt(args[li + 1], 10) || 12 : 12;
  switch (cmd) {
    case "collect":
      collect(lookback);
      break;
    case "show":
      show();
      break;
    default:
      console.error("Commands: collect [--lookback-hours N] | show");
      process.exit(1);
  }
}

main();
