const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");

const entrypoints = readdirSync("src", { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => entry.name.slice(0, -3));

const result = spawnSync(
  "attw",
  [
    "--pack",
    ".",
    "--profile",
    "node16",
    "--no-summary",
    "--include-entrypoints",
    ...entrypoints
  ],
  {
    stdio: "inherit"
  }
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
