import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
  ],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  platform: "browser",
  sourcemap: "inline",
  treeShaking: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
