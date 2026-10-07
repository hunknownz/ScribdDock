export { createService } from "./composition.js";
export { type DownloadRequest, type SourceId, type SourceSpec, sources } from "./domain.js";
export { DownloaderError } from "./errors.js";
export type { ProgressCallback, SourceAdapter } from "./ports.js";
export { DownloadService, normalizeUrl, resolveSource } from "./service.js";
