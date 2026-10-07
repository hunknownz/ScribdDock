import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BrowserOptions, BrowserProvider, BrowserSession } from "./browser.js";

export function profileDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SCRIBDDOCK_PROFILE_DIR ?? "~/.scribddock/profiles/scribd";
  return resolve(configured === "~" ? homedir() : configured.replace(/^~\//, `${homedir()}/`));
}

export function printPreferences(path: string): Record<string, boolean | string> {
  const filename = resolve(path);
  const preferences: Record<string, boolean | string> = {
    "print.always_print_silent": true,
    print_printer: "Mozilla Save to PDF",
    "print.print_to_file": true,
    "print.print_to_filename": filename,
    "print.save_as_pdf.use_page_rule_size_as_paper_size.enabled": true,
  };
  const printer = "print.printer_Mozilla_Save_to_PDF";
  for (const [key, value] of Object.entries({
    print_to_file: true,
    print_to_filename: filename,
    print_bgcolor: true,
    print_bgimages: true,
    print_margin_top: "0",
    print_margin_bottom: "0",
    print_margin_left: "0",
    print_margin_right: "0",
    print_headerleft: "",
    print_headercenter: "",
    print_headerright: "",
    print_footerleft: "",
    print_footercenter: "",
    print_footerright: "",
    print_shrink_to_fit: true,
    print_scaling: "1",
  }))
    preferences[`${printer}.${key}`] = value;
  return preferences;
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
      ...(options.printPath ? { firefox_user_prefs: printPreferences(options.printPath) } : {}),
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
