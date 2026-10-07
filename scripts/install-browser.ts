import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { INSTALL_DIR } from "camoufox";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("camoufox/package.json");
const manifest: { bin: string | Record<string, string> } = JSON.parse(
  readFileSync(manifestPath, "utf8"),
);
const binary = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.camoufox;
if (!binary) throw new Error("Camoufox SDK 没有提供安装命令");
console.log(`Camoufox 缓存目录：${INSTALL_DIR}`);
if (!process.argv.includes("--force")) {
  // Keep version compatibility checks in the pinned SDK instead of copying its constraints.
  const { camoufoxPath, launchPath } = await import("camoufox/dist/pkgman.js");
  try {
    camoufoxPath();
    accessSync(launchPath(), constants.X_OK);
    console.log("已安装兼容的 Camoufox；使用 pnpm browser:install --force 可重新安装。");
    process.exit(0);
  } catch {
    console.log("现有内核不兼容或不完整，重新安装。");
  }
}
const child = spawn(process.execPath, [resolve(dirname(manifestPath), binary), "fetch"], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", async (code, signal) => {
  if (code !== 0 || signal) {
    process.exitCode = code ?? 1;
    return;
  }
  try {
    const { camoufoxPath, launchPath } = await import("camoufox/dist/pkgman.js");
    camoufoxPath();
    accessSync(launchPath(), constants.X_OK);
  } catch {
    console.error("没有找到兼容的 Camoufox 内核。请检查上面的网络错误，再重新运行安装命令。");
    process.exitCode = 1;
  }
});
