import { defineConfig } from "tsup";

const entryPoints = ["src/*.ts"];
const jsOptions = {
  entryPoints,
  bundle: false,
  sourcemap: true,
  clean: true,
  minify: false
};

export default defineConfig([
  {
    ...jsOptions,
    format: "cjs",
    outDir: "dist/cjs",
    publicDir: "build-assets/cjs"
  },
  {
    ...jsOptions,
    format: "esm",
    outExtension: () => ({ js: ".js" }),
    outDir: "dist/esm",
    publicDir: "build-assets/esm"
  },
  {
    entryPoints,
    bundle: false,
    format: ["cjs", "esm"],
    dts: { only: true },
    outDir: "dist/typings",
    clean: true
  }
]);
