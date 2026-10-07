import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Camoufox } from "camoufox";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession, PaperRounding } from "../src/adapters/browser.js";
import { CamoufoxProvider } from "../src/adapters/camoufox.js";
import { printMarionettePdf, reserveMarionettePort } from "../src/adapters/marionette.js";
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
  "prints the intended tab through Firefox WebDriver with native fonts",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribddock-webdriver-print-"));
    try {
      const port = await reserveMarionettePort();
      const browser = await Camoufox({
        os:
          process.platform === "darwin"
            ? "macos"
            : process.platform === "win32"
              ? "windows"
              : "linux",
        headless: true,
        main_world_eval: true,
        locale: "en-US",
        args: ["--marionette"],
        firefox_user_prefs: { "marionette.port": port },
      });
      const output = join(directory, "native.pdf");
      try {
        const context = await browser.newContext({ viewport: null });
        const other = await context.newPage();
        await other.setContent("Unrelated tab");
        const page = await context.newPage();
        await page.setContent(
          "<style>@page{size:840px 600px;margin:0}body{margin:0}</style><div>Native target text</div>",
        );
        await printMarionettePdf(port, output, page, { width: 840, height: 600 });
        await waitForPdf(output);
      } finally {
        await browser.close();
      }
      // This tests explicit WebDriver paper geometry directly. Quartz recovery
      // belongs to the macOS window.print() path, tested separately below.
      await validatePdf(output, 1);
      const pdf = await PDFDocument.load(await readFile(output));
      expect(pdf.getPage(0).getSize()).toEqual({ width: 630, height: 450 });
      expect(
        pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.keys().length,
      ).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);

it.skipIf(process.env.SCRIBD_BROWSER !== "1")(
  "persists a synthetic session across restarts in a Unicode profile path",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribddock-profile-"));
    const profile = join(directory, "用户 profile");
    const provider = new CamoufoxProvider();
    try {
      const first = await provider.open({ headless: true, profile });
      try {
        await first.context.addCookies([
          {
            name: "profile-check",
            value: "synthetic-session",
            domain: "example.test",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ]);
      } finally {
        await first.close();
      }
      const reopened = await provider.open({ headless: true, profile });
      try {
        const cookies = await reopened.context.cookies("https://example.test/");
        expect(cookies.find((cookie) => cookie.name === "profile-check")?.value).toBe(
          "synthetic-session",
        );
      } finally {
        await reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);

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
        let paperRounding: PaperRounding = "exact";
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
          if (session.printPdf) ({ paperRounding } = await session.printPdf(page, layout));
          else await evaluateMainWorld(page, PRINT_DOCUMENT_SCRIPT);
          await waitForPdf(output);
          expect(layout).toEqual({ width, height });
        } finally {
          await session.close();
        }
        await normalizePrintedPdf(output, { width, height }, "Native print", paperRounding);
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
