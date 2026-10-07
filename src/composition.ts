import { ScribdAdapter } from "./adapters/scribd/index.js";
import { DownloadService } from "./service.js";

export function createService(): DownloadService {
  return new DownloadService(new Map([["scribd", new ScribdAdapter()]]));
}
