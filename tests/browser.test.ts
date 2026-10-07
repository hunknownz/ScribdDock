import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../src/adapters/browser.js";
import { CamoufoxProvider } from "../src/adapters/camoufox.js";
import { normalizePrintedPdf, validatePdf, waitForPdf } from "../src/adapters/pdf.js";
import { evaluateMainWorld } from "../src/adapters/scribd/evaluate.js";
import { prepareExportDom } from "../src/adapters/scribd/renderer.js";
import { PRINT_DOCUMENT_SCRIPT } from "../src/adapters/scribd/scripts.js";

describe.skipIf(process.env.SCRIBD_BROWSER !== "1")("local Camoufox integration", () => {
  let session: BrowserSession;
  let page: Page;
  beforeAll(async () => {
    session = await new CamoufoxProvider().open({ headless: true });
    page = await session.context.newPage();
  }, 30_000);
  afterAll(async () => {
    await session?.close();
  });

  it("returns main-world function results with arguments", async () => {
    await expect(
      evaluateMainWorld(page, "mw:({value}) => ({value})", { value: 42 }),
    ).resolves.toEqual({ value: 42 });
  });

  async function documentFixture(childWidth: string): Promise<void> {
    await page.setContent(`<style>
      .paper { width:1000px; height:800px; border:1px solid black; }
      .ink { width:${childWidth}; height:900px; background:gray; }
    </style><div class="paper"><div class="ink">Test content</div></div>`);
    await evaluateMainWorld(
      page,
      `mw:() => {
      window.docManager = {pages:{one:{pageNum:1,containerElem:document.querySelector('.paper')}}};
      return true;
    }`,
    );
  }

  it("expands paper to fit existing content without clipping", async () => {
    await documentFixture("1020px");
    await prepareExportDom(page, {
      documentId: "1",
      title: "Fixture",
      pageCount: 1,
      width: 1000,
      height: 800,
    });
    const layout: { width: number; height: number; scrollWidth: number; scrollHeight: number } =
      await evaluateMainWorld(
        page,
        `mw:() => {
      const e=document.querySelector('#scribddock-pages > *');
      return {width:e.clientWidth,height:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight};
    }`,
      );
    expect(layout.width).toBeGreaterThanOrEqual(1020);
    expect(layout.height).toBeGreaterThanOrEqual(900);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
  });

  it("still rejects content that grows beyond the repaired paper", async () => {
    await documentFixture("110%");
    await expect(
      prepareExportDom(page, {
        documentId: "1",
        title: "Fixture",
        pageCount: 1,
        width: 1000,
        height: 800,
      }),
    ).rejects.toThrow("exceeds visible box");
  });
});

it.skipIf(process.env.SCRIBD_BROWSER !== "1")(
  "prints successive paper sizes with native fonts and correct page boxes",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribddock-native-print-"));
    try {
      for (const [width, height] of [
        [750, 1000],
        [840, 600],
      ] as const) {
        const output = join(directory, `${width}-${height}.pdf`);
        const session = await new CamoufoxProvider().open({ headless: true, printPath: output });
        try {
          const page = await session.context.newPage();
          await page.setContent(
            `<div id="paper" style="width:${width}px;height:${height}px">Selectable native text</div>`,
          );
          await evaluateMainWorld(
            page,
            `mw:() => {
            window.docManager = {pages:{one:{pageNum:1,containerElem:document.getElementById('paper')}}};
            return true;
          }`,
          );
          const layout = await prepareExportDom(page, {
            documentId: "1",
            title: "Native print",
            pageCount: 1,
            width,
            height,
          });
          await evaluateMainWorld(page, PRINT_DOCUMENT_SCRIPT);
          await waitForPdf(output);
          expect(layout).toEqual({ width, height });
        } finally {
          await session.close();
        }
        await normalizePrintedPdf(output, { width, height }, "Native print");
        await validatePdf(output, 1);
        const pdf = await PDFDocument.load(await readFile(output));
        const page = pdf.getPage(0);
        expect(page.getSize()).toEqual({ width: width * 0.75, height: height * 0.75 });
        expect(
          page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.keys().length,
        ).toBeGreaterThan(0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
