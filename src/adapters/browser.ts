import type { BrowserContext, Page } from "playwright-core";

export type PaperRounding = "exact" | "ceil";

export interface BrowserSession {
  readonly context: BrowserContext;
  printPdf?(
    page: Page,
    layout: { width: number; height: number },
  ): Promise<{ paperRounding: PaperRounding }>;
  close(): Promise<void>;
}

export interface BrowserOptions {
  readonly headless: boolean;
  readonly profile?: string;
  readonly printPath?: string;
}

export interface BrowserProvider {
  open(options: BrowserOptions): Promise<BrowserSession>;
}
