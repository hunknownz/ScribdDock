import type { Page } from "playwright-core";

export function mainWorldCall(script: string, argument?: unknown): string {
  if (!script.startsWith("mw:")) throw new Error("Expected a Camoufox main-world function");
  // JS Playwright treats string input as an expression. Invoke the function explicitly.
  return `mw:(${script.slice(3)})(${JSON.stringify(argument ?? null)})`;
}

export function evaluateMainWorld<T>(page: Page, script: string, argument?: unknown): Promise<T> {
  return page.evaluate<T>(mainWorldCall(script, argument));
}
