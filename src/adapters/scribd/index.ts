import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { DownloadRequest } from "../../domain.js";
import { DownloaderError, errorMessage } from "../../errors.js";
import { defaultOutputFilename } from "../../filenames.js";
import type { ProgressCallback, SourceAdapter } from "../../ports.js";
import type { BrowserProvider } from "../browser.js";
import { CamoufoxProvider, profileDirectory } from "../camoufox.js";
import { finalizePdf, normalizePrintedPdf, waitForPdf } from "../pdf.js";
import { evaluateMainWorld } from "./evaluate.js";
import {
  type ExportLayout,
  parseDocumentUrl,
  prepareExportDom,
  renderDocument,
} from "./renderer.js";
import { PRINT_DOCUMENT_SCRIPT } from "./scripts.js";

export interface ScribdOptions {
  readonly profile?: string;
  readonly confirmLogin?: () => Promise<void>;
}

async function confirmLogin(): Promise<void> {
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    await reader.question("请在浏览器中完成 Scribd 登录，再回到终端按 Enter 保存会话：");
  } finally {
    reader.close();
  }
}

export class ScribdAdapter implements SourceAdapter {
  private readonly profile: string;
  private readonly confirm: () => Promise<void>;

  constructor(
    private readonly browsers: BrowserProvider = new CamoufoxProvider(),
    options: ScribdOptions = {},
  ) {
    this.profile = options.profile ?? profileDirectory();
    this.confirm = options.confirmLogin ?? confirmLogin;
  }

  private async prepareProfile(): Promise<void> {
    await mkdir(this.profile, { recursive: true, mode: 0o700 });
    await chmod(this.profile, 0o700);
  }

  async login(): Promise<void> {
    try {
      await this.prepareProfile();
      const session = await this.browsers.open({ headless: false, profile: this.profile });
      try {
        const page = session.context.pages()[0] ?? (await session.context.newPage());
        const response = await page.goto("https://www.scribd.com/login", {
          waitUntil: "domcontentloaded",
          timeout: 120_000,
        });
        if (!response || response.status() >= 400)
          throw new DownloaderError(`login: 登录页返回 ${response?.status() ?? "无响应"}`);
        await this.confirm();
      } finally {
        await session.close();
      }
    } catch (error) {
      if (error instanceof DownloaderError) throw error;
      throw new DownloaderError(`browser: 登录失败 (${errorMessage(error)})`, { cause: error });
    }
  }

  async download(request: DownloadRequest, progress?: ProgressCallback): Promise<string> {
    const ref = parseDocumentUrl(request.url);
    const requestedOutput = request.output
      ? resolve(request.output.replace(/^~\//, `${homedir()}/`))
      : undefined;
    const baseDir = requestedOutput ? dirname(requestedOutput) : process.cwd();
    let temporary: string | undefined;
    try {
      try {
        await mkdir(baseDir, { recursive: true });
        temporary = await mkdtemp(join(baseDir, ".scribddock-"));
      } catch (error) {
        throw new DownloaderError(
          `output: failed to prepare destination (${errorMessage(error)})`,
          { cause: error },
        );
      }
      const partial = join(temporary, "document.pdf");
      if (!request.guest) await this.prepareProfile();
      const session = await this.browsers.open({
        headless: true,
        printPath: partial,
        ...(request.guest ? {} : { profile: this.profile }),
      });
      let completion:
        | { output: string; pageCount: number; title: string; layout: ExportLayout }
        | undefined;
      try {
        const page = await session.context.newPage();
        const info = await renderDocument(page, ref, progress);
        const output =
          requestedOutput ?? resolve(baseDir, defaultOutputFilename(info.title, info.documentId));
        const layout = await prepareExportDom(page, info);
        await evaluateMainWorld(page, PRINT_DOCUMENT_SCRIPT);
        await waitForPdf(partial);
        completion = { output, pageCount: info.pageCount, title: info.title, layout };
      } finally {
        await session.close();
      }
      if (!completion) throw new DownloaderError("PDF: 没有完成的文档");
      await normalizePrintedPdf(partial, completion.layout, completion.title).catch(
        (error: unknown) => {
          if (error instanceof DownloaderError) throw error;
          throw new DownloaderError(`print: generated PDF is invalid (${errorMessage(error)})`, {
            cause: error,
          });
        },
      );
      await finalizePdf(partial, completion.output, completion.pageCount);
      return completion.output;
    } catch (error) {
      const message = errorMessage(error);
      const hint =
        request.guest && message.includes("initialization timed out")
          ? "; 请运行 scribddock login，再省略 --guest 重试"
          : "";
      if (error instanceof DownloaderError && !hint) throw error;
      throw new DownloaderError(`browser: 下载失败 (${message})${hint}`, { cause: error });
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}
