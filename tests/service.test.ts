import { describe, expect, it, vi } from "vitest";
import type { DownloadRequest, SourceId } from "../src/domain.js";
import type { ProgressCallback, SourceAdapter } from "../src/ports.js";
import { DownloadService, normalizeUrl, resolveSource } from "../src/service.js";

class RecordingAdapter implements SourceAdapter {
  readonly login = vi.fn(async () => {});
  readonly download = vi.fn(async (_request: DownloadRequest, progress?: ProgressCallback) => {
    progress?.(2, 2);
    return "/tmp/document.pdf";
  });
}

describe("source routing", () => {
  it.each([
    ["https://scribd.com/document/123/Title", "scribd"],
    ["https://www.scribd.com/embeds/123/content", "scribd"],
    ["https://www.slideshare.net/a/b", "slideshare"],
    ["https://everand.com/book/123/title", "everand"],
    ["https://www.fable.co/book/123", "fable"],
    ["https://SCRIBD.COM/document/123", "scribd"],
  ])("routes %s to %s", (url, source) => expect(resolveSource(url).id).toBe(source));

  it.each([
    "https://scribd.com.example.org/document/123",
    "https://not-scribd.com/document/123",
    "https://scribd.com@evil.example/document/123",
    "https://user:secret@scribd.com/document/123",
    "https://scribd.com:9000/document/123",
    "file:///etc/passwd",
    "ftp://scribd.com/document/123",
    "scribd.com/document/123",
    "https://other.example/document/123",
    "https://scribd.com/ doc",
  ])("rejects %s", (url) => expect(() => resolveSource(url)).toThrow());

  it("accepts complete Markdown links", () => {
    expect(normalizeUrl("  [文档](https://www.scribd.com/document/123/AAGnet)  ")).toBe(
      "https://www.scribd.com/document/123/AAGnet",
    );
  });

  it("forwards the normalized request and progress", async () => {
    const adapter = new RecordingAdapter();
    const service = new DownloadService(new Map([["scribd", adapter]]));
    const progress = vi.fn();
    await expect(
      service.download(
        { url: "[A](https://scribd.com/document/123)", output: "doc.pdf", guest: true },
        progress,
      ),
    ).resolves.toBe("/tmp/document.pdf");
    expect(adapter.download).toHaveBeenCalledWith(
      { url: "https://scribd.com/document/123", output: "doc.pdf", guest: true },
      progress,
    );
    expect(progress).toHaveBeenCalledWith(2, 2);
  });

  it.each([
    ["slideshare", "https://slideshare.net/a/b"],
    ["everand", "https://everand.com/book/123"],
    ["fable", "https://fable.co/book/123"],
  ] as const)("rejects planned %s even if bound", async (id, url) => {
    const adapter = new RecordingAdapter();
    const adapters = new Map<SourceId, SourceAdapter>([
      ["scribd", adapter],
      [id, adapter],
    ]);
    const service = new DownloadService(adapters);
    await expect(service.download({ url, guest: false })).rejects.toThrow("尚未实现");
    await expect(service.login(id)).rejects.toThrow("尚未实现");
    expect(adapter.download).not.toHaveBeenCalled();
    expect(adapter.login).not.toHaveBeenCalled();
  });

  it("rejects missing bindings", async () => {
    const service = new DownloadService(new Map());
    await expect(
      service.download({ url: "https://scribd.com/document/123", guest: true }),
    ).rejects.toThrow("未绑定");
  });

  it("logs in to Scribd by default", async () => {
    const adapter = new RecordingAdapter();
    await new DownloadService(new Map([["scribd", adapter]])).login();
    expect(adapter.login).toHaveBeenCalledOnce();
  });
});
