const { cpSync, mkdirSync, rmSync } = require("node:fs");

rmSync("dist", { recursive: true, force: true });

for (const [source, destination] of [
  ["build-assets/cjs/package.json", "dist/cjs/package.json"],
  ["build-assets/esm/package.json", "dist/esm/package.json"]
]) {
  mkdirSync(destination.slice(0, destination.lastIndexOf("/")), {
    recursive: true
  });
  cpSync(source, destination);
}
