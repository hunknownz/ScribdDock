import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { DownloaderError, errorMessage } from "../../errors.js";
import type { ProgressCallback } from "../../ports.js";
import { normalizeUrl } from "../../service.js";
import { evaluateMainWorld } from "./evaluate.js";
import {
  BATCH_READY_SCRIPT,
  LOAD_BATCH_SCRIPT,
  LOAD_DOCUMENT_FONTS_SCRIPT,
  MANAGER_STATE_SCRIPT,
  PREPARE_EXPORT_SCRIPT,
} from "./scripts.js";

export interface DocumentRef {
  readonly documentId: string;
  readonly embedUrl: string;
}

export interface DocumentInfo {
  readonly documentId: string;
  readonly title: string;
  readonly pageCount: number;
  readonly width: number;
  readonly height: number;
}

export interface ManagerState {
  readonly title?: string;
  readonly pageCount?: number;
  readonly sizes?: readonly (readonly number[])[];
  readonly missing?: readonly string[];
}

export function parseDocumentUrl(input: string): DocumentRef {
  const url = new URL(normalizeUrl(input));
  const match = /^\/(?:document|embeds)\/(\d+)(?:\/.*)?$/.exec(url.pathname);
  if (!["scribd.com", "www.scribd.com"].includes(url.hostname) || !match?.[1])
    throw new DownloaderError("URL: 只支持 Scribd 文档和嵌入链接");
  const documentId = match[1];
  return {
    documentId,
    embedUrl: `https://www.scribd.com/embeds/${documentId}/content?start_page=1&view_mode=scroll`,
  };
}

export function validateDocumentState(documentId: string, state: ManagerState): DocumentInfo {
  if (state.missing?.length)
    throw new DownloaderError(`render: 阅读器接口缺失 ${state.missing.join(", ")}`);
  const count = state.pageCount ?? 0;
  const sizes = state.sizes ?? [];
  if (!Number.isInteger(count) || count < 1 || sizes.length !== count)
    throw new DownloaderError("render: 文档页数不完整");
  if (sizes.some((size) => size.length !== 2 || size.some((n) => !Number.isFinite(n) || n <= 0)))
    throw new DownloaderError("render: 文档页面尺寸无效");
  const readerTitle = state.title?.trim();
  const title = !readerTitle || /^Scribd$/i.test(readerTitle) ? documentId : readerTitle;
  if (/^(?:error|page not found|access denied|404)(?:\b|$)/i.test(title))
    throw new DownloaderError("render: 阅读器返回错误页面");
  return {
    documentId,
    title,
    pageCount: count,
    width: sizes[0]?.[0] ?? 0,
    height: sizes[0]?.[1] ?? 0,
  };
}

export class ResourceMonitor {
  readonly failures: { kind: string; url: string; detail: string }[] = [];

  classify(rawUrl: string, resourceType: string): string | undefined {
    const url = new URL(rawUrl);
    if (!(url.hostname === "scribdassets.com" || url.hostname.endsWith(".scribdassets.com")))
      return;
    const path = url.pathname.toLowerCase();
    if (path.endsWith(".jsonp") || (path.includes("/pages/") && !path.includes("/images/")))
      return "page";
    if (resourceType === "font" || /\.(?:woff2?|ttf|otf)$/.test(path)) return "font";
    if (resourceType === "image" && path.includes("/images/")) return "image";
  }

  record(rawUrl: string, resourceType: string, detail: string): void {
    const kind = this.classify(rawUrl, resourceType);
    if (kind) {
      const url = new URL(rawUrl);
      this.failures.push({ kind, url: `${url.hostname}${url.pathname}`, detail });
    }
  }

  attach(page: Page): void {
    page.on("response", (response) => {
      if (response.status() >= 400)
        this.record(response.url(), response.request().resourceType(), `HTTP ${response.status()}`);
    });
    page.on("requestfailed", (request) =>
      this.record(
        request.url(),
        request.resourceType(),
        request.failure()?.errorText ?? "request failed",
      ),
    );
  }
}

export async function waitForManager(page: Page, timeoutMs = 60_000): Promise<ManagerState> {
  const deadline = Date.now() + timeoutMs;
  let state: ManagerState = {};
  while (Date.now() < deadline) {
    try {
      state = await evaluateMainWorld(page, MANAGER_STATE_SCRIPT);
    } catch (error) {
      if (!/execution context.*destroyed|cannot find context/i.test(errorMessage(error)))
        throw new DownloaderError(`render: 阅读器读取失败 (${errorMessage(error)})`, {
          cause: error,
        });
    }
    if (
      (state.pageCount ?? 0) > 0 &&
      state.sizes?.length === state.pageCount &&
      !state.missing?.length
    )
      return state;
    await delay(250);
  }
  throw new DownloaderError(
    `render: Scribd initialization timed out (${state.missing?.join(", ") || "文档页面未就绪"})`,
  );
}

export async function waitForBatch(
  page: Page,
  start: number,
  end: number,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateMainWorld(page, BATCH_READY_SCRIPT, { start, end })) return;
    await delay(250);
  }
  throw new DownloaderError(`render: 第 ${start + 1}-${end} 页未完成加载`);
}

export async function renderDocument(
  page: Page,
  ref: DocumentRef,
  progress?: ProgressCallback,
): Promise<DocumentInfo> {
  const monitor = new ResourceMonitor();
  monitor.attach(page);
  const response = await page.goto(ref.embedUrl, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  if (!response || response.status() >= 400)
    throw new DownloaderError(`navigation: Scribd 返回 ${response?.status() ?? "无响应"}`);
  const info = validateDocumentState(ref.documentId, await waitForManager(page));
  try {
    await evaluateMainWorld(page, LOAD_DOCUMENT_FONTS_SCRIPT);
  } catch (error) {
    throw new DownloaderError(`fonts: 专用字体加载失败 (${errorMessage(error)})`, { cause: error });
  }
  for (let start = 0; start < info.pageCount; start += 8) {
    const end = Math.min(start + 8, info.pageCount);
    await evaluateMainWorld(page, LOAD_BATCH_SCRIPT, { start, end });
    await waitForBatch(page, start, end);
    progress?.(end, info.pageCount);
  }
  await evaluateMainWorld(page, "mw:async () => { await document.fonts.ready; return true; }");
  const failure = monitor.failures[0];
  if (failure)
    throw new DownloaderError(`resources: ${failure.kind} ${failure.detail} (${failure.url})`);
  return info;
}

export async function prepareExportDom(page: Page, info: DocumentInfo): Promise<void> {
  const result: { renderedPages: number; layoutFailures?: string[] } = await evaluateMainWorld(
    page,
    PREPARE_EXPORT_SCRIPT,
    { pageCount: info.pageCount },
  );
  if (result.renderedPages !== info.pageCount)
    throw new DownloaderError("export DOM: 页面数量不匹配");
  if (result.layoutFailures?.length)
    throw new DownloaderError(`export DOM: ${result.layoutFailures[0]}`);
}
