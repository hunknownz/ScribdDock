import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from "pdf-lib";
import { expect, it } from "vitest";
import { validatePdf } from "../src/adapters/pdf.js";
import { createService } from "../src/composition.js";

it.skipIf(process.env.SCRIBD_LIVE !== "1")(
  "downloads a public Scribd sample",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribddock-live-"));
    try {
      const output = join(directory, "sample.pdf");
      let pages = 0;
      const path = await createService().download(
        {
          url: process.env.SCRIBD_TEST_URL ?? "https://www.scribd.com/document/990798737/AAGnet",
          guest: true,
          output,
        },
        (_loaded, total) => {
          pages = total;
        },
      );
      expect(path).toBe(output);
      expect(pages).toBeGreaterThan(0);
      if (process.env.SCRIBD_TEST_EXPECTED_PAGES)
        expect(pages).toBe(Number(process.env.SCRIBD_TEST_EXPECTED_PAGES));
      await validatePdf(output, pages);
      if (process.env.SCRIBD_TEST_REQUIRE_TEXT === "1") {
        const pdf = await PDFDocument.load(await readFile(output));
        for (const page of pdf.getPages()) {
          expect(
            page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.keys().length,
          ).toBeGreaterThan(0);
          const contents = page.node.Contents();
          const streams =
            contents instanceof PDFArray
              ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFStream))
              : contents
                ? [contents]
                : [];
          const text = streams
            .map((stream) =>
              Buffer.from(
                stream instanceof PDFRawStream
                  ? decodePDFRawStream(stream).decode()
                  : stream.getContents(),
              ).toString("latin1"),
            )
            .join("\n");
          expect(text).toMatch(/\bBT\b/);
          // PDF operand delimiters can touch the following operator without
          // whitespace; Cairo emits both string)Tj and array]TJ forms.
          expect(text).toMatch(/[\s\])>](?:Tj|TJ)\b/);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
