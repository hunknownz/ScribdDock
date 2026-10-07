import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = {
  browser: { flag: "SCRIBD_BROWSER", file: "tests/browser.test.ts" },
  live: { flag: "SCRIBD_LIVE", file: "tests/live-scribd.test.ts" },
} as const;
const name = process.argv[2];
if (name !== "browser" && name !== "live") throw new Error("Expected browser or live test target");
const target = targets[name];
const require = createRequire(import.meta.url);
const manifestPath = require.resolve("vitest/package.json");
const manifest: { bin: { vitest: string } } = JSON.parse(readFileSync(manifestPath, "utf8"));
const child = spawn(
  process.execPath,
  [resolve(dirname(manifestPath), manifest.bin.vitest), "run", target.file],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
    env: { ...process.env, [target.flag]: "1" },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
