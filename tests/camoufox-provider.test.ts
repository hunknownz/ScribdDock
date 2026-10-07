import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CamoufoxProvider } from "../src/adapters/camoufox.js";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("camoufox", () => ({ Camoufox: launch }));
afterEach(() => vi.resetAllMocks());

describe("Camoufox guest and persistent options", () => {
  it("uses a fresh context for guest downloads and targets a temporary PDF", async () => {
    const context = { close: vi.fn() };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
    launch.mockResolvedValue(browser);
    const printPath = join(tmpdir(), "partial.pdf");
    const session = await new CamoufoxProvider().open({
      headless: true,
      printPath,
    });
    const options = launch.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      headless: true,
      main_world_eval: true,
      enable_cache: true,
      locale: "en-US",
    });
    expect(options).not.toHaveProperty("user_data_dir");
    expect(options.firefox_user_prefs["print.print_to_filename"]).toBe(printPath);
    if (process.platform === "win32") expect(options.os).toBe("windows");
    await session.close();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("opens a visible persistent context for manual login", async () => {
    const context = { close: vi.fn(async () => {}) };
    launch.mockResolvedValue(context);
    const session = await new CamoufoxProvider().open({
      headless: false,
      profile: "/tmp/fixture-profile",
    });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
        persistent_context: true,
        user_data_dir: "/tmp/fixture-profile",
        window: [1280, 900],
      }),
    );
    await session.close();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("reports the TS browser installation command when the kernel is missing", async () => {
    launch.mockRejectedValue(
      new Error("official/stable is not installed. Please run `camoufox fetch` to install."),
    );
    await expect(new CamoufoxProvider().open({ headless: true })).rejects.toThrow(
      "pnpm browser:install",
    );
  });

  it("closes the launched browser when creating its context fails", async () => {
    const browser = {
      newContext: vi.fn(async () => {
        throw new Error("context failed");
      }),
      close: vi.fn(async () => {}),
    };
    launch.mockResolvedValue(browser);
    await expect(new CamoufoxProvider().open({ headless: true })).rejects.toThrow("context failed");
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
