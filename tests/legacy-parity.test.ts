import { describe, expect, it, vi } from "vitest";
import { printPreferences } from "../src/adapters/camoufox.js";
import {
  parseDocumentUrl,
  ResourceMonitor,
  validateDocumentState,
} from "../src/adapters/scribd/renderer.js";
import { LOAD_BATCH_SCRIPT } from "../src/adapters/scribd/scripts.js";
import { runCli } from "../src/cli.js";
import { defaultOutputFilename, sanitizeFilename } from "../src/filenames.js";
import type { SourceAdapter } from "../src/ports.js";
import { DownloadService } from "../src/service.js";
import contracts from "./fixtures/legacy-contracts.json" with { type: "json" };

describe("Python reference contracts", () => {
  it.each(contracts.filenames)(
    "matches filename behavior for $input",
    ({ input, sanitized, output }) => {
      expect(sanitizeFilename(input)).toBe(sanitized);
      expect(defaultOutputFilename(input, "884183779")).toBe(output);
    },
  );

  it.each(contracts.urls)(
    "matches document routing for $input",
    ({ input, rejected, documentId, embedUrl }) => {
      if (rejected) expect(() => parseDocumentUrl(input)).toThrow();
      else expect(parseDocumentUrl(input)).toEqual({ documentId, embedUrl });
    },
  );

  it.each(contracts.resources)(
    "matches resource classification for $url",
    ({ url, type, kind }) => {
      expect(new ResourceMonitor().classify(url, type)).toBe(kind ?? undefined);
    },
  );

  it.each(contracts.states)("matches metadata for $input.title", ({ input, expected }) => {
    expect(validateDocumentState("884183779", input)).toEqual(expected);
  });

  it.each(contracts.parser)("matches parser exit code for $args", async ({ args, exitCode }) => {
    const adapter: SourceAdapter = {
      login: vi.fn(async () => {}),
      download: vi.fn(async () => "/tmp/book.pdf"),
    };
    const service = new DownloadService(new Map([["scribd", adapter]]));
    const io = { out: vi.fn(), err: vi.fn() };
    expect(await runCli(args, service, io)).toBe(exitCode);
    expect(adapter.login).not.toHaveBeenCalled();
    expect(adapter.download).not.toHaveBeenCalled();
  });

  it("keeps stdout machine readable and batch progress on stderr", async () => {
    const adapter: SourceAdapter = {
      login: vi.fn(async () => {}),
      download: async (_request, progress) => {
        progress?.(5, 5);
        return "/tmp/book.pdf";
      },
    };
    const service = new DownloadService(new Map([["scribd", adapter]]));
    const io = { out: vi.fn(), err: vi.fn() };
    expect(await runCli(["download", contracts.urls[0]?.input ?? ""], service, io)).toBe(0);
    expect(io.out.mock.calls).toEqual([["/tmp/book.pdf\n"]]);
    expect(io.err.mock.calls).toEqual([["render: 5/5 pages\n"]]);
  });

  it("awaits fonts before displaying prestarted pages and turning images on", async () => {
    const calls: string[] = [];
    const page = {
      pageNum: 1,
      innerPageElem: { isConnected: true },
      loadHasStarted: true,
      load: () => calls.push("load"),
      loadFonts: async () => {
        calls.push("fonts-start");
        await Promise.resolve();
        calls.push("fonts-done");
      },
      display: () => calls.push("display"),
      turnOnImages: () => calls.push("images"),
    };
    const manager = { pages: { one: page } };
    const invoke = new Function(
      "window",
      `return (${LOAD_BATCH_SCRIPT.slice(3)})({start:0,end:1});`,
    );
    await invoke({ docManager: manager });
    expect(calls).toEqual(["fonts-start", "fonts-done", "display", "images"]);
  });

  it("targets the temporary PDF and preserves native print settings", () => {
    const output = join(tmpdir(), ".book.partial.pdf");
    const preferences = printPreferences(output);
    expect(preferences["print.always_print_silent"]).toBe(true);
    expect(preferences.print_printer).toBe("Mozilla Save to PDF");
    expect(preferences["print.print_to_filename"]).toBe(output);
    expect(preferences["print.printer_Mozilla_Save_to_PDF.print_to_filename"]).toBe(output);
    expect(preferences["print.save_as_pdf.use_page_rule_size_as_paper_size.enabled"]).toBe(true);
  });
});

import { tmpdir } from "node:os";
import { join } from "node:path";
