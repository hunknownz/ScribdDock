import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  PDFString,
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

async function quartzFixture(width = 751.5, withClip = true, height = 1001.25): Promise<string> {
  const document = await PDFDocument.create();
  document.setProducer("macOS Quartz PDFContext");
  const page = document.addPage([612, 792]);
  if (withClip)
    page.pushOperators(pushGraphicsState(), rectangle(0, 918.75, width, height), clip(), endPath());
  const scale = width / 751.5;
  page.drawText("Heading", { x: 20 * scale, y: 918.75 + 881.25 * scale, size: 24 * scale });
  if (withClip) page.pushOperators(popGraphicsState());
  const annotation = document.context.register(
    document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [20 * scale, 918.75 + 831.25 * scale, 200 * scale, 918.75 + 851.25 * scale],
      QuadPoints: [
        20 * scale,
        918.75 + 851.25 * scale,
        200 * scale,
        918.75 + 851.25 * scale,
        20 * scale,
        918.75 + 831.25 * scale,
        200 * scale,
        918.75 + 831.25 * scale,
      ],
      A: { S: "URI", URI: PDFString.of("https://example.com") },
    }),
  );
  page.node.set(PDFName.of("Annots"), document.context.obj([annotation]));
  const output = join(directory, "quartz.pdf");
  await writeFile(output, await document.save());
  return output;
}

describe("native printing", () => {
  it.each([1, 0.98, 0.8982035928])(
    "restores uniform Quartz scaling %s and link coordinates",
    async (scale) => {
      const file = await quartzFixture(751.5 * scale, true, 1001.25 * scale);
      await normalizePrintedPdf(file, { width: 1002, height: 1335 }, "Native text");
      const pdf = await PDFDocument.load(await readFile(file));
      const page = pdf.getPage(0);
      expect(page.getSize()).toEqual({ width: 751.5, height: 1001.25 });
      const annotation = page.node.Annots()?.lookup(0, PDFDict);
      if (!annotation) throw new Error("Missing link");
      const rectangle = annotation.lookup(PDFName.of("Rect"), PDFArray).asRectangle();
      expect(rectangle.x).toBeCloseTo(20);
      expect(rectangle.y).toBeCloseTo(831.25);
      expect(rectangle.width).toBeCloseTo(180);
      expect(rectangle.height).toBeCloseTo(20);
      const points = annotation.lookup(PDFName.of("QuadPoints"), PDFArray).asArray();
      expect(points.map((point) => Number(String(point)))).toEqual([
        expect.closeTo(20),
        expect.closeTo(851.25),
        expect.closeTo(200),
        expect.closeTo(851.25),
        expect.closeTo(20),
        expect.closeTo(831.25),
        expect.closeTo(200),
        expect.closeTo(831.25),
      ]);
      expect(
        annotation
          .lookup(PDFName.of("A"), PDFDict)
          .lookup(PDFName.of("URI"), PDFString)
          .decodeText(),
      ).toBe("https://example.com");
      await expect(validatePdf(file, 1)).resolves.toBeUndefined();
    },
  );

  it("rejects a different print scale on another page without rewriting the file", async () => {
    const file = await quartzFixture();
    const pdf = await PDFDocument.load(await readFile(file), { updateMetadata: false });
    const other = await PDFDocument.load(
      await readFile(await quartzFixture(751.5 * 0.98, true, 1001.25 * 0.98)),
    );
    const [page] = await pdf.copyPages(other, [0]);
    if (!page) throw new Error("No page");
    pdf.addPage(page);
    await writeFile(file, await pdf.save());
    const before = await readFile(file);
    await expect(
      normalizePrintedPdf(file, { width: 1002, height: 1335 }, "Mismatch"),
    ).rejects.toThrow("缩放");
    expect(await readFile(file)).toEqual(before);
  });
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

  it("waits while the browser appends the end marker", async () => {
    const file = join(directory, "printing.pdf");
    await writeFile(file, "%PDF-1.7\npartial");
    const completion = waitForPdf(file, 500, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await appendFile(file, "\n%%EOF\n");
    await expect(completion).resolves.toBeUndefined();
  });

  it.each(["missing", "empty", "truncated", "marker-inside-file"])(
    "times out on %s browser output",
    async (kind) => {
      const file = join(directory, "incomplete.pdf");
      if (kind !== "missing")
        await writeFile(
          file,
          kind === "empty"
            ? ""
            : kind === "marker-inside-file"
              ? "%PDF-1.7\n%%EOF\npartial"
              : "%PDF-1.7\npartial",
        );
      await expect(waitForPdf(file, 25, 2)).rejects.toThrow("未完成写入");
    },
  );
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
