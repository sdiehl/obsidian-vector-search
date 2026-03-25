#!/usr/bin/env node

// Usage: node scripts/release.mjs <version>
// Example: node scripts/release.mjs 0.3.0
//
// Bumps version in manifest.json, package.json, versions.json,
// commits, tags, and pushes. If the tag already exists on the
// remote it is replaced automatically.

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/release.mjs <version>");
  console.error("  e.g. node scripts/release.mjs 0.3.0");
  process.exit(1);
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit" });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// 1. Bump versions
console.log(`\nBumping to ${version}...\n`);

const manifest = readJson("manifest.json");
manifest.version = version;
writeJson("manifest.json", manifest);
console.log("  manifest.json");

const pkg = readJson("package.json");
pkg.version = version;
writeJson("package.json", pkg);
console.log("  package.json");

const versions = readJson("versions.json");
versions[version] = manifest.minAppVersion;
writeJson("versions.json", versions);
console.log("  versions.json");

// 2. Run checks
console.log("\nRunning checks...\n");
run("npm run check");

// 3. Commit
console.log("\nCommitting...\n");
run("git add manifest.json package.json versions.json");
run(`git commit -m "v${version}"`);

// 4. Tag (delete remote tag first if it exists)
console.log("\nTagging...\n");
try {
  execSync(`git tag -d ${version} 2>/dev/null`, { stdio: "ignore" });
} catch {
  // tag didn't exist locally
}
try {
  execSync(`git push origin :refs/tags/${version} 2>/dev/null`, { stdio: "ignore" });
} catch {
  // tag didn't exist on remote
}
run(`git tag -a ${version} -m "${version}"`);

// 5. Push
console.log("\nPushing...\n");
run("git push origin main --tags");

console.log(`\nDone! Release workflow will run for tag ${version}.`);
console.log(`Watch: https://github.com/sdiehl/obsidian-vector-search/actions`);
