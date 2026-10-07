import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BrowserOptions, BrowserProvider, BrowserSession } from "./browser.js";

export function profileDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SCRIBDDOCK_PROFILE_DIR ?? "~/.scribddock/profiles/scribd";
  return resolve(configured === "~" ? homedir() : configured.replace(/^~\//, `${homedir()}/`));
}

export class CamoufoxProvider implements BrowserProvider {
  async open(options: BrowserOptions): Promise<BrowserSession> {
    const { Camoufox } = await import("camoufox");
    const os =
      process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
    const settings = {
      os,
      headless: options.headless,
      main_world_eval: true,
      enable_cache: true,
      locale: "en-US",
      ...(options.headless ? {} : { window: [1280, 900] as [number, number] }),
    } as const;
    if (options.profile) {
      const context = await Camoufox({
        ...settings,
        persistent_context: true,
        user_data_dir: options.profile,
      });
      return { context, close: () => context.close() };
    }
    const browser = await Camoufox(settings);
    try {
      const context = await browser.newContext({ viewport: null });
      return { context, close: () => browser.close() };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }
}
