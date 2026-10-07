import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../src/adapters/browser.js";
import { CamoufoxProvider } from "../src/adapters/camoufox.js";
import { evaluateMainWorld } from "../src/adapters/scribd/evaluate.js";
import { prepareExportDom } from "../src/adapters/scribd/renderer.js";

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
