import { defineConfig } from "tsup";

export default defineConfig({
  entryPoints: ["src/*.ts"],
  bundle: false,
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  outDir: "dist",
  clean: true,
  minify: false
});
