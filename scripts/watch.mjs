#!/usr/bin/env node

import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexScript = join(__dirname, "index.mjs");

const args = process.argv.slice(2);
const vaultIdx = args.indexOf("--vault");
if (vaultIdx === -1 || !args[vaultIdx + 1]) {
  console.error("Usage: node scripts/watch.mjs --vault <path-to-vault>");
  process.exit(1);
}
const vaultPath = args[vaultIdx + 1];

const INTERVAL_MS = 60_000;

console.log(`Watching vault: ${vaultPath}`);
console.log(`Re-indexing every ${INTERVAL_MS / 1000}s (incremental, skips unchanged files)`);
console.log("Press Ctrl+C to stop.\n");

async function run() {
  try {
    execFileSync(process.execPath, [indexScript, "--vault", vaultPath], {
      stdio: "inherit",
    });
  } catch (e) {
    console.error("Indexing failed:", e.message);
  }
}

await run();
setInterval(run, INTERVAL_MS);
