#!/usr/bin/env node
"use strict";

/**
 * HQ Token Governor (Layer 1 — spine).
 *
 * Tracks token spend in a rolling window from an append-only ledger and reports
 * a fuel gauge against an *estimated* 5-hour quota.
 *
 * Honest limitation: the real 5-hour quota is NOT queryable. We only learn the
 * wall by hitting it. This tool tracks what we log (accurate) and compares it to
 * a configured estimate (tunable). Bias conservative.
 *
 * Zero dependencies. Path-portable: all state resolved relative to the HQ root,
 * so it travels with ~/ppp2/hq/ on a USB stick and runs on any machine with node.
 *
 * Usage:
 *   node bin/governor.js add --project X --label Y --tokens N [--kind agent|main|manual]
 *   node bin/governor.js status
 *   node bin/governor.js gauge          # one-line summary (for the dashboard)
 *   node bin/governor.js set-quota <tokens>
 */

const fs = require("fs");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(HQ_ROOT, "config.json");
const DATA_DIR = path.join(HQ_ROOT, "data");
const LEDGER_PATH = path.join(DATA_DIR, "token-ledger.jsonl");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function appendEntry(entry) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n");
}

function rollingSpend(entries, windowMs, now) {
  const cutoff = now - windowMs;
  return entries
    .filter((e) => e.ts >= cutoff)
    .reduce((sum, e) => sum + (e.tokens || 0), 0);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val =
        args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function bar(pct, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

function cmdAdd(flags) {
  const tokens = parseInt(flags.tokens, 10);
  if (!Number.isFinite(tokens)) {
    console.error("Error: --tokens <N> is required and must be a number.");
    process.exit(1);
  }
  const entry = {
    ts: Date.now(),
    project: flags.project || "unknown",
    label: flags.label || "",
    tokens,
    kind: flags.kind || "agent",
  };
  appendEntry(entry);
  console.log(
    `Logged ${fmt(tokens)} tokens · ${entry.project} · ${entry.label || entry.kind}`,
  );
}

function cmdSetQuota(value) {
  const tokens = parseInt(value, 10);
  if (!Number.isFinite(tokens)) {
    console.error("Error: set-quota <tokens> must be a number.");
    process.exit(1);
  }
  const cfg = loadConfig();
  cfg.estimated_quota_tokens = tokens;
  saveConfig(cfg);
  console.log(`Estimated 5-hour quota set to ${fmt(tokens)} tokens.`);
}

function computeState() {
  const cfg = loadConfig();
  const entries = loadLedger();
  const now = Date.now();
  const windowMs = (cfg.window_hours || 5) * 3600 * 1000;
  const spent = rollingSpend(entries, windowMs, now);
  const quota = cfg.estimated_quota_tokens;
  const pct = quota ? (spent / quota) * 100 : null;
  const remaining = quota ? quota - spent : null;
  const spendable = quota
    ? Math.max(0, remaining - (cfg.reserve_tokens || 0))
    : null;
  return {
    cfg,
    spent,
    quota,
    pct,
    remaining,
    spendable,
    windowHours: cfg.window_hours || 5,
  };
}

function statusLevel(s) {
  if (s.pct === null) return "UNKNOWN";
  if (s.pct >= s.cfg.halt_pct) return "HALT";
  if (s.pct >= s.cfg.soft_ceiling_pct) return "CAUTION";
  return "OK";
}

function cmdStatus() {
  const s = computeState();
  const level = statusLevel(s);
  console.log("HQ Token Governor");
  console.log("=================");
  console.log(`Window:        ${s.windowHours}h rolling`);
  console.log(`Spent (logged):${" "}${fmt(s.spent)} tokens`);
  if (s.quota === null) {
    console.log(
      "Quota:         not set (estimate unknown — quota is not queryable)",
    );
    console.log(
      "               → run `set-quota <tokens>` after you observe a real wall.",
    );
    console.log(
      `Reserve floor: ${fmt(s.cfg.reserve_tokens)} tokens (held for live human needs)`,
    );
  } else {
    console.log(`Est. quota:    ${fmt(s.quota)} tokens`);
    console.log(`Used:          ${s.pct.toFixed(1)}%  ${bar(s.pct)}`);
    console.log(`Remaining:     ${fmt(s.remaining)} tokens`);
    console.log(
      `Reserve floor: ${fmt(s.cfg.reserve_tokens)} (spendable for building: ${fmt(s.spendable)})`,
    );
    console.log(
      `Soft ceiling:  ${s.cfg.soft_ceiling_pct}%   Halt: ${s.cfg.halt_pct}%`,
    );
  }
  console.log(`Status:        ${level}`);
  if (level === "HALT") {
    console.log(
      "\n>>> HALT: pause supervised projects, persist state, check in with Chris.",
    );
  } else if (level === "CAUTION") {
    console.log(
      "\n>>> CAUTION: over soft ceiling — avoid new background building.",
    );
  }
}

function cmdGauge() {
  const s = computeState();
  const level = statusLevel(s);
  if (s.quota === null) {
    console.log(
      `⛽ ${fmt(s.spent)} tok / ${s.windowHours}h · quota est. unset · ${level}`,
    );
  } else {
    console.log(
      `⛽ ${s.pct.toFixed(0)}% ${bar(s.pct, 12)} ${fmt(s.remaining)} left · ${level}`,
    );
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "add":
      cmdAdd(parseFlags(rest));
      break;
    case "set-quota":
      cmdSetQuota(rest[0]);
      break;
    case "gauge":
      cmdGauge();
      break;
    case "status":
    case undefined:
      cmdStatus();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Commands: add | status | gauge | set-quota");
      process.exit(1);
  }
}

main();
