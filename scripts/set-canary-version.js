#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");
const { compareVersions } = require("compare-versions");

const ROOT_DIR = path.join(__dirname, "..");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function main() {
  const pkg = require(path.join(ROOT_DIR, "package.json"));
  const { name, version } = pkg;
  const canaryVersion = getCanaryVersion(name);

  const versionCompare = compareVersions(version, canaryVersion);

  if (versionCompare > 0) {
    console.info(
      `${name} v${version} is greater than the published canary v${canaryVersion}! Creating new canary version.`
    );

    createNewCanaryVersion();
    return;
  } else {
    console.info(
      `${name} v${version} is less than the published canary v${canaryVersion}! Creating the next canary version.`
    );

    // set the current version to package.json
    setPackageVersion(canaryVersion);

    // create the next canary version
    createNewCanaryVersion();
  }
}

function getCanaryVersion(name) {
  const manifestStr = execSync(`npm show ${name} dist-tags --json`).toString();
  const manifest = JSON.parse(manifestStr);
  return manifest.canary;
}

function createNewCanaryVersion() {
  execSync(`yarn version --prerelease --preid=canary --no-git-tag-version`);
}

function setPackageVersion(version) {
  execSync(`npm pkg set version=${version}`);
}
