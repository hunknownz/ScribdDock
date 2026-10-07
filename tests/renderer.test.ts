import { describe, expect, it } from "vitest";
import {
  parseDocumentUrl,
  ResourceMonitor,
  validateDocumentState,
} from "../src/adapters/scribd/renderer.js";
import {
  BATCH_READY_SCRIPT,
  LOAD_BATCH_SCRIPT,
  LOAD_DOCUMENT_FONTS_SCRIPT,
  MANAGER_STATE_SCRIPT,
  PREPARE_EXPORT_SCRIPT,
  PRINT_DOCUMENT_SCRIPT,
} from "../src/adapters/scribd/scripts.js";
import { defaultOutputFilename, sanitizeFilename } from "../src/filenames.js";

describe("reader contracts", () => {
  it.each([
    "https://scribd.com/document/123/Title",
    "https://www.scribd.com/embeds/123/content?view_mode=scroll",
  ])("parses %s", (url) => {
    expect(parseDocumentUrl(url)).toEqual({
      documentId: "123",
      embedUrl: "https://www.scribd.com/embeds/123/content?start_page=1&view_mode=scroll",
    });
  });
  it.each([
    "https://scribd.com/book/123",
    "https://scribd.com/document/not-an-id",
    "https://everand.com/document/123",
  ])("rejects %s", (url) => expect(() => parseDocumentUrl(url)).toThrow());
  it("validates full page inventory", () => {
    expect(
      validateDocumentState("123", {
        title: "Title",
        pageCount: 2,
        sizes: [
          [600, 800],
          [600, 800],
        ],
        missing: [],
      }),
    ).toEqual({ documentId: "123", title: "Title", pageCount: 2, width: 600, height: 800 });
  });
  it("clears a generic site title so output naming can use the document ID", () => {
    expect(
      validateDocumentState("123", { title: "Scribd", pageCount: 1, sizes: [[600, 800]] }).title,
    ).toBe("");
  });
  it.each([
    { missing: ["window.docManager"] },
    { pageCount: 0, sizes: [] },
    { pageCount: 2, sizes: [[600, 800]] },
    { pageCount: 1, sizes: [[0, 800]] },
    { pageCount: 1, sizes: [[600, Number.NaN]] },
    { pageCount: 1, sizes: [[600]] },
    { title: "Access denied", pageCount: 1, sizes: [[600, 800]] },
  ])("rejects incomplete reader state %j", (state) =>
    expect(() => validateDocumentState("123", state)).toThrow(),
  );

  it("tracks required assets without recording signed query strings", () => {
    const monitor = new ResourceMonitor();
    monitor.record(
      "https://html.scribdassets.com/pages/1.jsonp?token=private",
      "script",
      "HTTP 403",
    );
    expect(monitor.failures).toEqual([
      { kind: "page", url: "html.scribdassets.com/pages/1.jsonp", detail: "HTTP 403" },
    ]);
    expect(monitor.classify("https://fonts.scribdassets.com/a.woff2", "font")).toBe("font");
    expect(monitor.classify("https://html.scribdassets.com/abc/images/a.jpg", "image")).toBe(
      "image",
    );
    expect(
      monitor.classify("https://evil-scribdassets.com/pages/1.jsonp", "script"),
    ).toBeUndefined();
    expect(monitor.classify("https://scribd.com/analytics", "script")).toBeUndefined();
  });

  it.each([
    MANAGER_STATE_SCRIPT,
    LOAD_BATCH_SCRIPT,
    LOAD_DOCUMENT_FONTS_SCRIPT,
    BATCH_READY_SCRIPT,
    PREPARE_EXPORT_SCRIPT,
    PRINT_DOCUMENT_SCRIPT,
  ])("ships syntactically valid main-world scripts", (script) => {
    expect(script.startsWith("mw:")).toBe(true);
    expect(() => new Function(`return (${script.slice(3)});`)).not.toThrow();
  });
});

describe("filenames", () => {
  it("removes path and control characters", () =>
    expect(sanitizeFilename(" ../A:B/C\\D\u0000? ")).toBe("_A_B_C_D__"));
  it("preserves Chinese names", () =>
    expect(defaultOutputFilename(" 工艺 文档 ", "123")).toBe("工艺 文档.pdf"));
  it("uses the document ID for empty titles", () =>
    expect(defaultOutputFilename("... ", "123")).toBe("123.pdf"));
});
