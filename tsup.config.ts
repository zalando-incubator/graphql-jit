import { defineConfig } from "tsup";

const entryPoints = ["src/*.ts"];

export default defineConfig([
  {
    entryPoints,
    bundle: false,
    format: ["cjs", "esm"],
    outExtension: () => ({ js: ".js" }),
    esbuildOptions(options, { format }) {
      options.entryNames = `${format}/[name]`;
    },
    sourcemap: true,
    outDir: "dist",
    clean: ["!typings/**"],
    minify: false,
    publicDir: "build-assets"
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
