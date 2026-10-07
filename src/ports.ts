import type { DownloadRequest } from "./domain.js";

export type ProgressCallback = (loadedPages: number, totalPages: number) => void;

export interface SourceAdapter {
  login(): Promise<void>;
  download(request: DownloadRequest, progress?: ProgressCallback): Promise<string>;
}
