import type { Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainWorldCall } from "../src/adapters/scribd/evaluate.js";
import {
  parseDocumentUrl,
  prepareExportDom,
  renderDocument,
  waitForBatch,
  waitForManager,
} from "../src/adapters/scribd/renderer.js";
import {
  BATCH_READY_SCRIPT,
  LOAD_BATCH_SCRIPT,
  LOAD_DOCUMENT_FONTS_SCRIPT,
  MANAGER_STATE_SCRIPT,
} from "../src/adapters/scribd/scripts.js";

const state = { title: "Sample", pageCount: 1, sizes: [[612, 792]], missing: [] };
afterEach(() => vi.useRealTimers());

describe("reference renderer failure and retry behavior", () => {
  it("retries a destroyed context and returns the new page inventory", async () => {
    vi.useFakeTimers();
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Execution context was destroyed"))
      .mockResolvedValueOnce(state);
    const result = waitForManager({ evaluate } as unknown as Page);
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual(state);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("waits until all pages have registered", async () => {
    vi.useFakeTimers();
    const complete = { ...state, pageCount: 5, sizes: Array.from({ length: 5 }, () => [612, 792]) };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ ...state, pageCount: 5 })
      .mockResolvedValueOnce(complete);
    const result = waitForManager({ evaluate } as unknown as Page);
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual(complete);
  });

  it("reports incomplete registration at initialization timeout", async () => {
    vi.useFakeTimers();
    const result = expect(
      waitForManager(
        { evaluate: async () => ({ ...state, pageCount: 5 }) } as unknown as Page,
        500,
      ),
    ).rejects.toThrow("registered 1/5 pages");
    await vi.advanceTimersByTimeAsync(500);
    await result;
  });

  it("preserves navigation failure stage and browser detail", async () => {
    const page = {
      on: vi.fn(),
      goto: async () => {
        throw new Error("NS_ERROR_NET_TIMEOUT");
      },
    } as unknown as Page;
    await expect(
      renderDocument(page, parseDocumentUrl("https://scribd.com/document/123")),
    ).rejects.toThrow(/^navigation:.*NS_ERROR_NET_TIMEOUT/);
  });

  it("preserves the batch number when loading fails", async () => {
    const page = {
      on: vi.fn(),
      goto: async () => ({ status: () => 200 }),
      evaluate: async (script: string) => {
        if (script === mainWorldCall(MANAGER_STATE_SCRIPT)) return state;
        if (script === mainWorldCall(LOAD_DOCUMENT_FONTS_SCRIPT)) return { loaded: 0 };
        if (script === mainWorldCall(LOAD_BATCH_SCRIPT, { start: 0, end: 1 }))
          throw new Error("did not finish loading");
        throw new Error("Unexpected stage");
      },
    } as unknown as Page;
    await expect(
      renderDocument(page, parseDocumentUrl("https://scribd.com/document/123")),
    ).rejects.toThrow(/^render: pages 1-1.*did not finish loading/);
  });

  it("preserves readiness failure stage and affected pages", async () => {
    const page = {
      evaluate: async (script: string) => {
        expect(script).toBe(mainWorldCall(BATCH_READY_SCRIPT, { start: 8, end: 16 }));
        throw new Error("context lost");
      },
    } as unknown as Page;
    await expect(waitForBatch(page, 8, 16)).rejects.toThrow(
      /^render: pages 9-16 readiness failed.*context lost/,
    );
  });

  it("rejects a changed page layout with the reference diagnostic", async () => {
    const failure = "page 1 content 901x1272 exceeds visible box 900x1272";
    const page = {
      evaluate: async () => ({ renderedPages: 1, layoutFailures: [failure] }),
    } as unknown as Page;
    await expect(
      prepareExportDom(page, {
        documentId: "123",
        title: "Sample",
        pageCount: 1,
        width: 902,
        height: 1274,
      }),
    ).rejects.toThrow(failure);
  });
});
