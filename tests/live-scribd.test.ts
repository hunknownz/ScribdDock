import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      await validatePdf(output, pages);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  240_000,
);
