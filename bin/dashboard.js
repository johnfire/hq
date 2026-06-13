#!/usr/bin/env node
"use strict";

/**
 * HQ Dashboard renderer (Layer 2).
 *
 * Reads the Layer-1 data files (governor ledger, project index, KPIs) and emits a
 * single self-contained dashboard.html — no server, no deps. Open it in a browser
 * (file://) or later serve it behind auth on the VPS for phone access.
 *
 * Re-run after any refresh. Zero LLM tokens.
 *
 * Usage:  node bin/dashboard.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");
const OUT_PATH = path.join(HQ_ROOT, "dashboard.html");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function governorState() {
  const cfg = readJson(path.join(HQ_ROOT, "config.json"), {});
  const ledgerPath = path.join(DATA_DIR, "token-ledger.jsonl");
  let spent = 0;
  if (fs.existsSync(ledgerPath)) {
    const windowMs = (cfg.window_hours || 5) * 3600 * 1000;
    const cutoff = Date.now() - windowMs;
    for (const line of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.ts >= cutoff) spent += e.tokens || 0;
      } catch {}
    }
  }
  const quota = cfg.estimated_quota_tokens || null;
  const pct = quota ? (spent / quota) * 100 : null;
  let level = "UNKNOWN";
  if (pct !== null)
    level =
      pct >= (cfg.halt_pct || 85)
        ? "HALT"
        : pct >= (cfg.soft_ceiling_pct || 70)
          ? "CAUTION"
          : "OK";
  return {
    cfg,
    spent,
    quota,
    pct,
    remaining: quota ? quota - spent : null,
    level,
    windowHours: cfg.window_hours || 5,
  };
}

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function render() {
  const gov = governorState();
  const index = readJson(path.join(DATA_DIR, "index.json"), {
    items: [],
    counts: {},
    generated: null,
  });
  const kpi = readJson(path.join(DATA_DIR, "kpi.json"), {
    projects: [],
    generated: null,
  });
  const descMap = readJson(path.join(DATA_DIR, "descriptions.json"), {});

  const searchItems = index.items
    .filter((it) => it.type !== "root")
    .map((it) => {
      const d = descMap[it.path];
      return {
        p: it.path,
        n: it.name,
        t: it.type,
        s: it.status,
        m: it.mtime,
        d: d && d.desc ? d.desc : "",
      };
    });

  const gaugePct = gov.pct === null ? 0 : Math.min(100, gov.pct);
  const levelColor = {
    OK: "#3fb950",
    CAUTION: "#d29922",
    HALT: "#f85149",
    UNKNOWN: "#8b949e",
  }[gov.level];

  const kpiRows = kpi.projects
    .map((p) => {
      const dirty = p.uncommitted
        ? `<span class="warn">±${p.uncommitted}</span>`
        : `<span class="ok">clean</span>`;
      const sync =
        p.ahead || p.behind ? ` ↑${p.ahead || 0}↓${p.behind || 0}` : "";
      const ci = p.ci
        ? `<span class="${p.ci.conclusion === "success" ? "ok" : "warn"}">${esc(p.ci.conclusion || p.ci.status)}</span>`
        : "—";
      return `<tr><td>${esc(p.name)}</td><td>${esc(p.branch)}</td><td>${esc(p.commitDate)}</td><td>${dirty}${sync}</td><td>${ci}</td></tr>`;
    })
    .join("");

  const c = index.counts || {};
  const fmtCounts = (o) =>
    Object.entries(o || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HQ — ${esc(os.hostname())}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9;
         padding: 1.5rem; max-width: 60rem; margin-inline: auto; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .sub { color: #8b949e; font-size: .85rem; margin-bottom: 1.5rem; }
  .card { background: #161b22; border: 0.0625rem solid #30363d; border-radius: .5rem;
          padding: 1.25rem; margin-bottom: 1.25rem; }
  .card h2 { font-size: 1rem; margin: 0 0 .9rem; color: #e6edf3; }
  .gauge-track { background: #21262d; border-radius: .5rem; height: 1.4rem; overflow: hidden; }
  .gauge-fill { height: 100%; border-radius: .5rem; transition: width .3s; }
  .stat { display: flex; justify-content: space-between; font-size: .9rem; padding: .15rem 0; }
  .stat b { color: #e6edf3; font-variant-numeric: tabular-nums; }
  .level { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 0.0625rem solid #21262d; }
  th { color: #8b949e; font-weight: 600; }
  .ok { color: #3fb950; } .warn { color: #d29922; }
  input { width: 100%; padding: .6rem .8rem; font-size: 1rem; background: #0d1117;
          border: 0.0625rem solid #30363d; border-radius: .4rem; color: #c9d1d9; }
  #results { margin-top: .8rem; font-size: .85rem; max-height: 22rem; overflow: auto; }
  .hit { padding: .3rem 0; border-bottom: 0.0625rem solid #21262d; }
  .hit .badge { display: inline-block; width: 1.4rem; }
  .hit .meta { color: #8b949e; }
  .arch { opacity: .6; }
</style></head><body>
<h1>HQ</h1>
<div class="sub">${esc(os.hostname())} · rendered ${new Date().toISOString().slice(0, 16).replace("T", " ")}</div>

<div class="card">
  <h2>⛽ Token Governor</h2>
  <div class="gauge-track"><div class="gauge-fill" style="width:${gaugePct}%;background:${levelColor}"></div></div>
  <div style="margin-top:.8rem">
    <div class="stat"><span>Spent (${gov.windowHours}h window)</span><b>${gov.spent.toLocaleString()}</b></div>
    ${
      gov.quota
        ? `<div class="stat"><span>Used</span><b>${gov.pct.toFixed(1)}%</b></div>
         <div class="stat"><span>Remaining</span><b>${gov.remaining.toLocaleString()}</b></div>`
        : `<div class="stat"><span>Quota estimate</span><b>not set</b></div>`
    }
    <div class="stat"><span>Reserve floor</span><b>${(gov.cfg.reserve_tokens || 0).toLocaleString()}</b></div>
    <div class="stat"><span>Status</span><b class="level" style="color:${levelColor}">${gov.level}</b></div>
  </div>
</div>

<div class="card">
  <h2>📦 Projects (${kpi.projects.length})</h2>
  ${
    kpi.projects.length
      ? `<table><thead><tr><th>Project</th><th>Branch</th><th>Last commit</th><th>Changes</th><th>CI</th></tr></thead><tbody>${kpiRows}</tbody></table>`
      : `<div class="sub">No KPI data — run <code>node bin/kpi.js collect</code></div>`
  }
</div>

<div class="card">
  <h2>🔎 Find anything</h2>
  <input id="q" type="search" placeholder="Search ${searchItems.length} folders & docs… (e.g. art marketing, taxes)" autofocus>
  <div id="results"></div>
  <div class="sub" style="margin-top:.8rem">${esc(fmtCounts(c.byType))} — ${esc(fmtCounts(c.byStatus))}</div>
</div>

<script>
const ITEMS = ${JSON.stringify(searchItems)};
const BADGE = { doc: "📄", project: "📦", dir: "📁" };
const q = document.getElementById("q"), out = document.getElementById("results");
function search() {
  const toks = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
  if (!toks.length) { out.innerHTML = ""; return; }
  const scored = [];
  for (const it of ITEMS) {
    const name = it.n.toLowerCase(), p = it.p.toLowerCase(), d = (it.d || "").toLowerCase();
    let ok = true, score = 0;
    for (const t of toks) {
      const inN = name.includes(t), inP = p.includes(t), inD = d.includes(t);
      if (!inN && !inP && !inD) { ok = false; break; }
      score += (inN ? 3 : 0) + (inP ? 1 : 0) + (inD ? 2 : 0);
    }
    if (ok) scored.push([score, it]);
  }
  scored.sort((a, b) => b[0] - a[0] || (b[1].m || "").localeCompare(a[1].m || ""));
  out.innerHTML = scored.slice(0, 40).map(([, it]) =>
    '<div class="hit ' + (it.s !== "active" ? "arch" : "") + '"><span class="badge">' +
    (BADGE[it.t] || "📁") + '</span>~/' + it.p +
    (it.s !== "active" ? " (" + it.s + ")" : "") +
    '<span class="meta">' + (it.m ? "  " + it.m : "") + "</span>" +
    (it.d ? '<div class="meta" style="margin-left:1.4rem">' + it.d.replace(/</g,"&lt;") + "</div>" : "") +
    "</div>"
  ).join("") || "<div class='sub'>No matches.</div>";
}
q.addEventListener("input", search);
</script>
</body></html>`;

  fs.writeFileSync(OUT_PATH, html);
  console.log(`Dashboard written: ${OUT_PATH.replace(os.homedir(), "~")}`);
  console.log(`Open it: xdg-open ${OUT_PATH.replace(os.homedir(), "~")}`);
}

render();
