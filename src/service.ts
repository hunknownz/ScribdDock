import { type DownloadRequest, type SourceId, type SourceSpec, sources } from "./domain.js";
import { DownloaderError } from "./errors.js";
import type { ProgressCallback, SourceAdapter } from "./ports.js";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const markdown = /^\[[^\]]*\]\((https?:\/\/.+)\)$/.exec(trimmed);
  const raw = markdown?.[1] ?? trimmed;
  try {
    if (!/^https?:\/\//i.test(raw) || /\s/.test(raw)) throw new Error("Invalid URL");
    const url = new URL(raw);
    if (url.username || url.password || url.port) throw new Error("Invalid authority");
    return url.href;
  } catch {
    throw new DownloaderError("URL: 请提供完整的 HTTP/HTTPS 链接，不含账号密码或非标准端口");
  }
}

export function resolveSource(input: string): SourceSpec {
  const hostname = new URL(normalizeUrl(input)).hostname;
  const source = sources.find((candidate) => candidate.hosts.includes(hostname));
  if (!source) throw new DownloaderError(`URL: 未支持的来源 ${hostname}`);
  return source;
}

export class DownloadService {
  constructor(private readonly adapters: ReadonlyMap<SourceId, SourceAdapter>) {}

  private adapter(source: SourceSpec, operation: "login" | "download"): SourceAdapter {
    const enabled = operation === "login" ? source.canLogin : source.canDownload;
    if (!enabled) throw new DownloaderError(`${source.name}: 尚未实现 ${operation}`);
    const adapter = this.adapters.get(source.id);
    if (!adapter) throw new DownloaderError(`${source.name}: 未绑定适配器`);
    return adapter;
  }

  async login(sourceId: SourceId = "scribd"): Promise<void> {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new DownloaderError(`未知来源 ${sourceId}`);
    await this.adapter(source, "login").login();
  }

  async download(request: DownloadRequest, progress?: ProgressCallback): Promise<string> {
    const url = normalizeUrl(request.url);
    const source = resolveSource(url);
    return this.adapter(source, "download").download({ ...request, url }, progress);
  }
}
