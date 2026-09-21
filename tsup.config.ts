import { defineConfig } from "tsup";

export default defineConfig({
  entryPoints: ["src/*.ts"],
  bundle: false,
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  outDir: "dist",
  clean: true,
  minify: false,
  plugins: [
    {
      // With `bundle: false`, tsup/esbuild does not rewrite import specifiers,
      // so ESM output keeps the source `.js` extensions and ends up importing
      // the CommonJS files. Rewrite relative `.js` specifiers to `.mjs`.
      name: "rewrite-esm-relative-imports",
      renderChunk(code) {
        if (this.format !== "esm") return;
        return {
          code: code.replace(/(["'])(\.[^"']*?)\.js\1/g, "$1$2.mjs$1")
        };
      }
    }
  ]
});
