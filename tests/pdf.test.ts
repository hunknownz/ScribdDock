import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clip,
  decodePDFRawStream,
  endPath,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
} from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizePdf, normalizePrintedPdf, validatePdf, waitForPdf } from "../src/adapters/pdf.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "scribddock-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture(pages = 1, blank = false): Promise<string> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = document.addPage([600, 800]);
    if (!blank) page.drawText(`Page ${i + 1}`, { x: 20, y: 700 });
  }
  const file = join(directory, "partial.pdf");
  await writeFile(file, await document.save());
  return file;
}

async function quartzFixture(width = 751.5, withClip = true): Promise<string> {
  const document = await PDFDocument.create();
  document.setProducer("macOS Quartz PDFContext");
  const page = document.addPage([612, 792]);
  if (withClip)
    page.pushOperators(
      pushGraphicsState(),
      rectangle(0, 918.75, width, 1001.25),
      clip(),
      endPath(),
    );
  page.drawText("Heading", { x: 20, y: 1800 });
  if (withClip) page.pushOperators(popGraphicsState());
  const output = join(directory, "quartz.pdf");
  await writeFile(output, await document.save());
  return output;
}

describe("native printing", () => {
  it("repairs the Quartz page box while retaining native text and font resources", async () => {
    const file = await quartzFixture();
    await normalizePrintedPdf(file, { width: 1002, height: 1335 }, "Document title");
    const document = await PDFDocument.load(await readFile(file));
    const page = document.getPages()[0];
    if (!page) throw new Error("No page");
    expect(page.getMediaBox()).toEqual({ x: 0, y: 0, width: 751.5, height: 1001.25 });
    expect(page.getCropBox()).toEqual(page.getMediaBox());
    expect(document.getTitle()).toBe("Document title");
    expect(
      page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.keys().length,
    ).toBeGreaterThan(0);
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) throw new Error("Expected preserved streams");
    const decoded = Array.from({ length: contents.size() }, (_, i) =>
      Buffer.from(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode()).toString("latin1"),
    ).join("\n");
    expect(decoded).toContain("-918.75 cm");
    expect(decoded).toContain("48656164696E67");
    expect(decoded).toContain("BT");
    await expect(validatePdf(file, 1)).resolves.toBeUndefined();
  });

  it.each([
    { width: 700, withClip: true },
    { width: 751.5, withClip: false },
  ])(
    "rejects unknown or mismatched Quartz page boundaries ($width, $withClip)",
    async ({ width, withClip }) => {
      const file = await quartzFixture(width, withClip);
      const before = await readFile(file);
      await expect(
        normalizePrintedPdf(file, { width: 1002, height: 1335 }, "Sample"),
      ).rejects.toThrow("边界");
      expect(await readFile(file)).toEqual(before);
    },
  );

  it("retains ordinary native PDF dimensions", async () => {
    const file = await fixture();
    await normalizePrintedPdf(file, { width: 800, height: 800 / 0.75 }, "Sample");
    expect((await PDFDocument.load(await readFile(file))).getPage(0).getSize()).toEqual({
      width: 600,
      height: 800,
    });
  });

  it("rejects ordinary PDFs printed at the wrong paper size", async () => {
    const file = await fixture();
    const before = await readFile(file);
    await expect(
      normalizePrintedPdf(file, { width: 1002, height: 1335 }, "Sample"),
    ).rejects.toThrow("纸张尺寸");
    expect(await readFile(file)).toEqual(before);
  });

  it("waits for a complete and stable browser output", async () => {
    await expect(waitForPdf(await fixture(), 300, 2)).resolves.toBeUndefined();
  });

  it.each(["missing", "empty", "truncated"])("times out on %s browser output", async (kind) => {
    const file = join(directory, "incomplete.pdf");
    if (kind !== "missing") await writeFile(file, kind === "empty" ? "" : "%PDF-1.7\npartial");
    await expect(waitForPdf(file, 25, 2)).rejects.toThrow("未完成写入");
  });
});

describe("PDF output protection", () => {
  it("accepts complete PDFs with drawing operations", async () =>
    await expect(validatePdf(await fixture(2), 2)).resolves.toBeUndefined());
  it("replaces existing output only after successful validation", async () => {
    const partial = await fixture(2);
    const output = join(directory, "output.pdf");
    await writeFile(output, "existing");
    await finalizePdf(partial, output, 2);
    expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(2);
    await expect(readFile(partial)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["count", "blank", "invalid", "empty"])(
    "preserves existing output when %s validation fails",
    async (kind) => {
      const partial = await fixture(1, kind === "blank");
      if (kind === "invalid") await writeFile(partial, "not a PDF");
      if (kind === "empty") await writeFile(partial, "");
      const output = join(directory, "output.pdf");
      await writeFile(output, "existing");
      await expect(finalizePdf(partial, output, kind === "count" ? 2 : 1)).rejects.toThrow();
      expect(await readFile(output, "utf8")).toBe("existing");
    },
  );
});
