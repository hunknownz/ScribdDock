import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assemblePdf, finalizePdf, validatePdf } from "../src/adapters/pdf.js";

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

describe("page image assembly", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+NocAAAAASUVORK5CYII=",
    "base64",
  );

  it("embeds every page at its CSS pixel size and records the title", async () => {
    const output = join(directory, "images.pdf");
    await assemblePdf([png, png], output, "Sample document");
    const document = await PDFDocument.load(await readFile(output));
    expect(document.getPageCount()).toBe(2);
    expect(document.getTitle()).toBe("Sample document");
    expect(document.getCreator()).toBe("ScribdDock");
    for (const page of document.getPages()) {
      expect(page.getSize()).toEqual({ width: 0.75, height: 0.75 });
      expect(
        page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys(),
      ).toHaveLength(1);
    }
    await expect(validatePdf(output, 2)).resolves.toBeUndefined();
  });

  it.each([
    { images: [] },
    { images: [Buffer.from("invalid PNG")] },
    { images: [png, Buffer.from("invalid PNG")] },
  ])("preserves an existing file if images cannot be assembled (%#)", async ({ images }) => {
    const output = join(directory, "images.pdf");
    await writeFile(output, "existing");
    await expect(assemblePdf(images, output, "Sample")).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("existing");
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
