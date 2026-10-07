import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
} from "pdf-lib";
import { DownloaderError, errorMessage } from "../errors.js";

export interface PrintedLayout {
  /** CSS pixels, before converting to PDF points. */
  readonly width: number;
  readonly height: number;
}

function decodedContents(stream: PDFStream): string {
  const bytes =
    stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString("latin1");
}

function contentStreams(contents: PDFStream | PDFArray | undefined): PDFStream[] {
  if (contents instanceof PDFStream) return [contents];
  if (contents instanceof PDFArray) {
    return Array.from({ length: contents.size() }, (_, i) => contents.lookup(i, PDFStream));
  }
  return [];
}

export async function waitForPdf(path: string, timeoutMs = 60_000, pollMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previousSize = -1;
  let stableSamples = 0;
  while (Date.now() < deadline) {
    try {
      const { size } = await stat(path);
      stableSamples = size > 0 && size === previousSize ? stableSamples + 1 : 0;
      previousSize = size;
      if (stableSamples >= 2) {
        const bytes = await readFile(path);
        if (
          Buffer.from(bytes.subarray(-1024))
            .toString("latin1")
            .replace(/[\t\n\v\f\r ]+$/g, "")
            .endsWith("%%EOF")
        )
          return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(pollMs);
  }
  throw new DownloaderError("print: PDF 未完成写入，已中止导出");
}

const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
const quartzClip = new RegExp(
  `^(?:\\s*(?:q|Q)\\b)*\\s*${number}\\s+${number}\\s+${number}\\s+${number}\\s+re\\s+W\\*?\\s+n\\b`,
);

function translateAnnotationPoints(annotation: PDFDict, x: number, y: number): void {
  const translate = (points: PDFArray): void => {
    if (points.size() % 2 !== 0) throw new DownloaderError("PDF: 注释坐标无效");
    for (let i = 0; i < points.size(); i++) {
      const value = points.lookup(i, PDFNumber).asNumber();
      points.set(i, PDFNumber.of(value - (i % 2 === 0 ? x : y)));
    }
  };
  for (const key of ["Rect", "QuadPoints", "Vertices", "L", "CL"]) {
    const points = annotation.lookupMaybe(PDFName.of(key), PDFArray);
    if (points) translate(points);
  }
  const ink = annotation.lookupMaybe(PDFName.of("InkList"), PDFArray);
  if (ink) for (let i = 0; i < ink.size(); i++) translate(ink.lookup(i, PDFArray));
}

export async function normalizePrintedPdf(
  path: string,
  layout: PrintedLayout,
  title: string,
): Promise<void> {
  const width = layout.width * 0.75;
  const height = layout.height * 0.75;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new DownloaderError("PDF: 打印布局尺寸无效");
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const quartz = document.getProducer()?.includes("Quartz PDFContext");
  let paperScale: number | undefined;
  for (const [index, page] of document.getPages().entries()) {
    if (quartz) {
      // Quartz can emit the correct CSS page clipping rectangle while retaining a Letter
      // MediaBox. Recover only the leading page clip. Firefox may uniformly scale the
      // entire paper; require the DOM aspect ratio and one common scale across all pages.
      // This keeps native text, fonts and vectors instead of replacing pages with screenshots.
      const stream = contentStreams(page.node.Contents())[0];
      const match = stream && quartzClip.exec(decodedContents(stream).slice(0, 4096));
      if (!match) throw new DownloaderError(`PDF: 第 ${index + 1} 页无法识别 Quartz 页面边界`);
      const [x, y, clipWidth, clipHeight] = match.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      const ratio = clipWidth / width;
      if (
        ![x, y, ratio].every(Number.isFinite) ||
        ratio < 0.5 ||
        ratio > 2 ||
        Math.abs(clipHeight - height * ratio) > 0.5
      )
        throw new DownloaderError(
          `PDF: 第 ${index + 1} 页打印边界与阅读器布局不匹配 ` +
            `(${clipWidth}x${clipHeight}pt; expected ${width}x${height}pt)`,
        );
      if (paperScale !== undefined && Math.abs(paperScale - ratio) > 0.001)
        throw new DownloaderError(`PDF: 第 ${index + 1} 页打印缩放与其他页不一致`);
      paperScale = ratio;
      const scale = 1 / ratio;
      page.translateContent(-x, -y);
      page.scaleContent(scale, scale);
      const annotations = page.node.Annots();
      if (annotations)
        for (let i = 0; i < annotations.size(); i++)
          translateAnnotationPoints(annotations.lookup(i, PDFDict), x, y);
      page.scaleAnnotations(scale, scale);
      page.setMediaBox(0, 0, width, height);
      page.setCropBox(0, 0, width, height);
    } else if (
      Math.abs(page.getWidth() - width) > 0.5 ||
      Math.abs(page.getHeight() - height) > 0.5
    ) {
      throw new DownloaderError(`PDF: 第 ${index + 1} 页打印纸张尺寸与阅读器布局不匹配`);
    }
  }
  document.setTitle(title);
  document.setCreator("ScribdDock");
  await writeFile(path, await document.save());
}

export async function validatePdf(path: string, expectedPages: number): Promise<void> {
  try {
    const bytes = await readFile(path);
    if (bytes.length === 0) throw new DownloaderError("PDF: 生成了空文件");
    const document = await PDFDocument.load(bytes);
    const pages = document.getPages();
    if (pages.length !== expectedPages)
      throw new DownloaderError(`PDF: 预期 ${expectedPages} 页，实际 ${pages.length} 页`);
    for (const [index, page] of pages.entries()) {
      const streams = contentStreams(page.node.Contents());
      if (!streams.some((stream) => decodedContents(stream).trim().length > 0))
        throw new DownloaderError(`PDF: 第 ${index + 1} 页没有内容流`);
    }
  } catch (error) {
    if (error instanceof DownloaderError) throw error;
    throw new DownloaderError(`PDF: 校验失败 (${errorMessage(error)})`, { cause: error });
  }
}

export async function finalizePdf(
  partial: string,
  output: string,
  expectedPages: number,
): Promise<void> {
  await validatePdf(partial, expectedPages);
  await rename(partial, output);
}
