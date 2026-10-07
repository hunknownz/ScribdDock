import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserOptions, BrowserProvider } from "../src/adapters/browser.js";
import { mainWorldCall } from "../src/adapters/scribd/evaluate.js";
import { ScribdAdapter } from "../src/adapters/scribd/index.js";
import {
  BATCH_READY_SCRIPT,
  LOAD_BATCH_SCRIPT,
  LOAD_DOCUMENT_FONTS_SCRIPT,
  MANAGER_STATE_SCRIPT,
  PREPARE_EXPORT_SCRIPT,
} from "../src/adapters/scribd/scripts.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "scribddock-adapter-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function browserFixture({ status = 200, validPdf = true } = {}) {
  const page = {
    on: vi.fn(),
    locator: vi.fn(() => ({
      nth: () => ({
        screenshot: async () =>
          validPdf
            ? Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+NocAAAAASUVORK5CYII=",
                "base64",
              )
            : Buffer.from("invalid PNG"),
      }),
    })),
    goto: vi.fn(async () => ({ status: () => status })),
    evaluate: vi.fn(async (script: string) => {
      if (script === mainWorldCall(LOAD_DOCUMENT_FONTS_SCRIPT)) return { loaded: 1 };
      if (script === mainWorldCall(MANAGER_STATE_SCRIPT))
        return { title: "Sample", pageCount: 1, sizes: [[600, 800]], missing: [] };
      if (script === mainWorldCall(LOAD_BATCH_SCRIPT, { start: 0, end: 1 })) return [1];
      if (script === mainWorldCall(BATCH_READY_SCRIPT, { start: 0, end: 1 })) return true;
      if (script === mainWorldCall(PREPARE_EXPORT_SCRIPT, { pageCount: 1 }))
        return { renderedPages: 1, layoutFailures: [] };
      return true;
    }),
  };
  const context = { pages: () => [page], newPage: vi.fn(async () => page as unknown as Page) };
  const close = vi.fn(async () => {});
  const open = vi.fn(async (_options: BrowserOptions) => {
    return { context: context as unknown as BrowserContext, close };
  });
  const provider: BrowserProvider = { open };
  return { provider, open, page, context, close };
}

describe("Scribd adapter with a simulated browser", () => {
  it("navigates before confirming login and closes the session", async () => {
    const browser = browserFixture();
    const profile = join(directory, "profile");
    const confirm = vi.fn(async () => {
      expect(browser.page.goto).toHaveBeenCalledWith(
        "https://www.scribd.com/login",
        expect.any(Object),
      );
      expect(browser.close).not.toHaveBeenCalled();
    });
    await new ScribdAdapter(browser.provider, { profile, confirmLogin: confirm }).login();
    expect(browser.open).toHaveBeenCalledWith({ headless: false, profile });
    expect(browser.context.newPage).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect((await stat(profile)).mode & 0o777).toBe(0o700);
  });

  it("rejects a failed login page before prompting", async () => {
    const browser = browserFixture({ status: 403 });
    const confirm = vi.fn(async () => {});
    await expect(
      new ScribdAdapter(browser.provider, {
        profile: join(directory, "profile"),
        confirmLogin: confirm,
      }).login(),
    ).rejects.toThrow("403");
    expect(confirm).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("runs the reader, prints and validates while forwarding progress", async () => {
    const browser = browserFixture();
    const output = join(directory, "output.pdf");
    const progress = vi.fn();
    await expect(
      new ScribdAdapter(browser.provider).download(
        { url: "https://scribd.com/document/123", guest: true, output },
        progress,
      ),
    ).resolves.toBe(output);
    expect(browser.open).toHaveBeenCalledWith({ headless: true });
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(1);
    expect(await readdir(directory)).toEqual(["output.pdf"]);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("uses the saved profile outside guest mode", async () => {
    const browser = browserFixture();
    const profile = join(directory, "profile");
    await new ScribdAdapter(browser.provider, { profile }).download({
      url: "https://scribd.com/document/123",
      guest: false,
      output: join(directory, "doc.pdf"),
    });
    expect(browser.open).toHaveBeenCalledWith({
      headless: true,
      profile,
    });
  });

  it("preserves an existing output and removes temporary files on validation failure", async () => {
    const browser = browserFixture({ validPdf: false });
    const output = join(directory, "output.pdf");
    await writeFile(output, "existing");
    await expect(
      new ScribdAdapter(browser.provider).download({
        url: "https://scribd.com/document/123",
        guest: true,
        output,
      }),
    ).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("existing");
    expect(await readdir(directory)).toEqual(["output.pdf"]);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid document paths before opening a browser", async () => {
    const browser = browserFixture();
    await expect(
      new ScribdAdapter(browser.provider).download({
        url: "https://scribd.com/book/123",
        guest: true,
      }),
    ).rejects.toThrow("只支持");
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("preserves the existing output if closing the browser fails", async () => {
    const browser = browserFixture();
    browser.close.mockRejectedValueOnce(new Error("close failed"));
    const output = join(directory, "output.pdf");
    await writeFile(output, "existing");
    await expect(
      new ScribdAdapter(browser.provider).download({
        url: "https://scribd.com/document/123",
        guest: true,
        output,
      }),
    ).rejects.toThrow("close failed");
    expect(await readFile(output, "utf8")).toBe("existing");
    expect(await readdir(directory)).toEqual(["output.pdf"]);
  });
});
