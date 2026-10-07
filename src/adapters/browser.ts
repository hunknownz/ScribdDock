import type { BrowserContext } from "playwright-core";

export interface BrowserSession {
  readonly context: BrowserContext;
  close(): Promise<void>;
}

export interface BrowserOptions {
  readonly headless: boolean;
  readonly profile?: string;
}

export interface BrowserProvider {
  open(options: BrowserOptions): Promise<BrowserSession>;
}
