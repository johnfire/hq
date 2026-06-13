#!/usr/bin/env node
"use strict";

/**
 * HQ Daily Brief (Layer 1 — deterministic heads-up).
 *
 * Assembles a "what matters right now" summary from the data files: fuel gauge,
 * repos needing attention (uncommitted / unpushed / stale), and index freshness.
 *
 * Zero LLM tokens — this is the cheap, always-on brief. An optional LLM salience
 * pass can narrate it later, but the facts are gathered here for free.
 *
 * Usage:  node bin/brief.js          # print to stdout (cron can log / pipe to Telegram)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");

function readJson(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - then) / 86400000);
}

function governorLine() {
  const cfg = readJson(path.join(HQ_ROOT, "config.json"), {});
  const ledgerPath = path.join(DATA_DIR, "token-ledger.jsonl");
  let spent = 0;
  if (fs.existsSync(ledgerPath)) {
    const cutoff = Date.now() - (cfg.window_hours || 5) * 3600 * 1000;
    for (const l of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        if (e.ts >= cutoff) spent += e.tokens || 0;
      } catch {}
    }
  }
  const q = cfg.estimated_quota_tokens;
  if (!q)
    return `⛽ Tokens: ${spent.toLocaleString()} spent in ${cfg.window_hours || 5}h window (quota estimate unset).`;
  const pct = ((spent / q) * 100).toFixed(0);
  const level =
    pct >= (cfg.halt_pct || 85)
      ? "HALT"
      : pct >= (cfg.soft_ceiling_pct || 70)
        ? "CAUTION"
        : "OK";
  return `⛽ Tokens: ${pct}% of estimated quota used · ${(q - spent).toLocaleString()} left · ${level}`;
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const kpi = readJson(path.join(DATA_DIR, "kpi.json"), { projects: [] });
  const index = readJson(path.join(DATA_DIR, "index.json"), {
    items: [],
    generated: null,
  });

  const lines = [];
  lines.push(`# HQ Brief — ${today} · ${os.hostname()}`);
  lines.push("");
  lines.push(governorLine());
  lines.push("");

  // Repos needing attention
  const dirty = kpi.projects.filter((p) => p.uncommitted > 0);
  const unpushed = kpi.projects.filter((p) => p.ahead > 0);
  const stale = kpi.projects.filter((p) => {
    const d = daysAgo(p.commitDate);
    return d !== null && d > 21;
  });

  if (dirty.length) {
    lines.push(`## ✏️  Uncommitted changes (${dirty.length})`);
    for (const p of dirty)
      lines.push(
        `- ${p.name}: ${p.uncommitted} files uncommitted (branch ${p.branch})`,
      );
    lines.push("");
  }
  if (unpushed.length) {
    lines.push(`## ⬆️  Unpushed commits (${unpushed.length})`);
    for (const p of unpushed)
      lines.push(`- ${p.name}: ${p.ahead} commit(s) ahead of remote`);
    lines.push("");
  }
  if (stale.length) {
    lines.push(`## 💤 Untouched >3 weeks (${stale.length})`);
    for (const p of stale)
      lines.push(
        `- ${p.name}: last commit ${p.commitDate} (${daysAgo(p.commitDate)}d ago)`,
      );
    lines.push("");
  }
  if (!dirty.length && !unpushed.length) {
    lines.push("✅ All tracked repos clean and pushed.");
    lines.push("");
  }

  // Open GitHub issues (populated by `refresh.sh --ci`)
  const withIssues = kpi.projects
    .filter((p) => p.issues && p.issues.length)
    .sort((a, b) => b.issues.length - a.issues.length);
  const totalIssues = kpi.projects.reduce(
    (s, p) => s + (p.issues ? p.issues.length : 0),
    0,
  );
  if (totalIssues > 0) {
    lines.push(
      `## 🐛 Open issues (${totalIssues} across ${withIssues.length} repo${withIssues.length === 1 ? "" : "s"})`,
    );
    for (const p of withIssues) lines.push(`- ${p.name}: ${p.issues.length}`);
    lines.push("");
  }

  // Index freshness
  const idxAge = index.generated
    ? Math.floor((Date.now() - new Date(index.generated).getTime()) / 86400000)
    : null;
  lines.push(
    `🗂️  Index: ${index.items.length} items` +
      (idxAge !== null ? `, built ${idxAge}d ago` : "") +
      ".",
  );

  console.log(lines.join("\n"));
}

main();
