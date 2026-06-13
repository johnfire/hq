#!/usr/bin/env node
"use strict";

/**
 * HQ KPI Collector (Layer 1).
 *
 * Walks git repos under the configured project roots and records cheap, universal
 * health signals: branch, last commit, uncommitted changes, ahead/behind, and
 * (optionally, with --ci) the latest GitHub Actions run.
 *
 * Local git is free + fast. --ci makes network calls (gh) and is opt-in so the
 * default refresh stays instant. Zero LLM tokens either way.
 *
 * Usage:
 *   node bin/kpi.js collect          # git only (fast, local)
 *   node bin/kpi.js collect --ci     # also fetch latest CI run per repo (network)
 *   node bin/kpi.js show
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const HQ_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(HQ_ROOT, "data");
const KPI_PATH = path.join(DATA_DIR, "kpi.json");
const HOME = os.homedir();

// Where to look for git repos (immediate children scanned for a .git dir).
const SCAN_ROOTS = ["ppp2", "ppp2/euroart"];

function sh(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function discoverRepos() {
  const repos = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(HOME, root);
    if (!fs.existsSync(absRoot)) continue;
    for (const ent of fs.readdirSync(absRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const abs = path.join(absRoot, ent.name);
      if (fs.existsSync(path.join(abs, ".git"))) repos.push(abs);
    }
  }
  return repos;
}

function collect(withCi) {
  const repos = discoverRepos();
  const projects = [];

  for (const abs of repos) {
    const rel = abs.startsWith(HOME + path.sep)
      ? abs.slice(HOME.length + 1)
      : abs;
    const branch = sh("git rev-parse --abbrev-ref HEAD", abs);
    const lastCommit = sh("git log -1 --format=%cd%x09%s --date=short", abs);
    const dirtyRaw = sh("git status --porcelain", abs);
    const dirty =
      dirtyRaw === null ? null : dirtyRaw ? dirtyRaw.split("\n").length : 0;
    const aheadBehind = sh(
      "git rev-list --count --left-right @{u}...HEAD",
      abs,
    ); // "behind\tahead"

    let commitDate = null,
      commitMsg = null;
    if (lastCommit) {
      const i = lastCommit.indexOf("\t");
      commitDate = lastCommit.slice(0, i);
      commitMsg = lastCommit.slice(i + 1);
    }
    let behind = null,
      ahead = null;
    if (aheadBehind && aheadBehind.includes("\t")) {
      [behind, ahead] = aheadBehind.split("\t").map((n) => parseInt(n, 10));
    }

    const proj = {
      name: path.basename(abs),
      path: rel,
      branch,
      commitDate,
      commitMsg,
      uncommitted: dirty,
      ahead,
      behind,
      ci: null,
    };

    if (withCi) {
      const ciRaw = sh(
        "gh run list --limit 1 --json status,conclusion,displayTitle,createdAt",
        abs,
      );
      if (ciRaw) {
        try {
          const arr = JSON.parse(ciRaw);
          if (arr.length) {
            proj.ci = {
              status: arr[0].status,
              conclusion: arr[0].conclusion,
              title: arr[0].displayTitle,
              at: (arr[0].createdAt || "").slice(0, 10),
            };
          }
        } catch {}
      }
    }
    projects.push(proj);
  }

  projects.sort((a, b) =>
    (b.commitDate || "").localeCompare(a.commitDate || ""),
  );

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {
    generated: new Date().toISOString(),
    machine: os.hostname(),
    withCi,
    projects,
  };
  fs.writeFileSync(KPI_PATH, JSON.stringify(out, null, 0) + "\n");

  console.log(
    `Collected KPIs for ${projects.length} repos${withCi ? " (with CI)" : ""}.`,
  );
  show();
}

function show() {
  if (!fs.existsSync(KPI_PATH)) {
    console.error("No KPI data yet. Run: node bin/kpi.js collect");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(KPI_PATH, "utf8"));
  for (const p of data.projects) {
    const dirty = p.uncommitted ? `±${p.uncommitted}` : "clean";
    const sync =
      p.ahead || p.behind ? ` ↑${p.ahead || 0}↓${p.behind || 0}` : "";
    const ci = p.ci ? `  CI:${p.ci.conclusion || p.ci.status}` : "";
    console.log(
      `${(p.name + " ").padEnd(20, ".")} ${p.branch || "?"}  ${p.commitDate || "?"}  ${dirty}${sync}${ci}`,
    );
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "collect":
      collect(rest.includes("--ci"));
      break;
    case "show":
    case undefined:
      show();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Commands: collect [--ci] | show");
      process.exit(1);
  }
}

main();
