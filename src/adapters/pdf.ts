import { readFile, rename, writeFile } from "node:fs/promises";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, PDFStream } from "pdf-lib";
import { DownloaderError, errorMessage } from "../errors.js";

export async function assemblePdf(
  images: readonly Uint8Array[],
  path: string,
  title: string,
): Promise<void> {
  if (!images.length) throw new DownloaderError("PDF: 没有可导出的页面");
  const document = await PDFDocument.create();
  document.setTitle(title);
  document.setCreator("ScribdDock");
  for (const image of images) {
    const embedded = await document.embedPng(image);
    const width = embedded.width * 0.75;
    const height = embedded.height * 0.75;
    const page = document.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }
  await writeFile(path, await document.save());
}

function hasDrawingOperations(stream: PDFStream): boolean {
  const bytes =
    stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString("latin1").trim().length > 0;
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
      const contents = page.node.Contents();
      const streams: PDFStream[] = [];
      if (contents instanceof PDFStream) streams.push(contents);
      else if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i, PDFStream));
      }
      if (!streams.some(hasDrawingOperations))
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
