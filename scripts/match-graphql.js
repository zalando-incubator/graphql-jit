const { writeFileSync } = require("fs");
const { resolve } = require("path");
const { argv, cwd } = require("process");

const pkgPath = resolve(cwd(), "./package.json");

const pkg = require(pkgPath);

const version = argv[2];

if (pkg.devDependencies.graphql.startsWith(version)) {
  console.info(`GraphQL v${version} is match! Skipping.`);
  return;
}

// If it is not stable version, use pinned version
const npmVersion = version.includes("-") ? version : `^${version}`;
pkg.devDependencies.graphql = npmVersion;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
