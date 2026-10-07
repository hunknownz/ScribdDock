import { afterEach, expect, it, vi } from "vitest";
import { LOAD_DOCUMENT_FONTS_SCRIPT } from "../src/adapters/scribd/scripts.js";

interface FontSpec {
  url: string;
  family: string;
  weight?: string;
  style?: string;
}

function fontHarness(fonts: FontSpec[], pending = false) {
  const created: { family: string; source: string; descriptors: Record<string, string> }[] = [];
  const add = vi.fn();
  class TestFont {
    constructor(family: string, source: string, descriptors: Record<string, string>) {
      created.push({ family, source, descriptors });
    }
    load(): Promise<TestFont> {
      return pending ? new Promise(() => {}) : Promise.resolve(this);
    }
  }
  const invoke = new Function(
    "window",
    "document",
    "FontFace",
    `return (${LOAD_DOCUMENT_FONTS_SCRIPT.slice(3)})();`,
  );
  return {
    created,
    add,
    run: () =>
      invoke(
        {
          docManager: {
            _fontLoader: { fonts: Object.fromEntries(fonts.map((font, index) => [index, font])) },
          },
        },
        { fonts: { add, ready: Promise.resolve() } },
        TestFont,
      ) as Promise<{ loaded: number }>,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it("registers document fonts and preserves weight/style", async () => {
  const harness = fontHarness([
    {
      url: "https://html.scribdassets.com/fonts/0.woff2",
      family: "ff0",
      weight: "700",
      style: "italic",
    },
    { url: "https://html.scribdassets.com/fonts/1.woff2", family: "ff1" },
  ]);
  await expect(harness.run()).resolves.toEqual({ loaded: 2 });
  expect(harness.add).toHaveBeenCalledTimes(2);
  expect(harness.created[0]?.descriptors).toEqual({ weight: "700", style: "italic" });
  expect(harness.created[1]?.descriptors).toEqual({ weight: "normal", style: "normal" });
});

it("permits image-only documents with no fonts", async () => {
  await expect(fontHarness([]).run()).resolves.toEqual({ loaded: 0 });
});

it.each([
  "https://evil-scribdassets.com/f.woff2",
  "https://scribdassets.com.evil.example/f.woff2",
  "file:///font.woff2",
])("rejects undeclared font host %s", async (url) => {
  const harness = fontHarness([{ url, family: "ff0" }]);
  await expect(harness.run()).rejects.toThrow("unsupported document font source");
  expect(harness.created).toHaveLength(0);
});

it("has a bounded failure when a font never loads", async () => {
  vi.useFakeTimers();
  const harness = fontHarness(
    [{ url: "https://html.scribdassets.com/0.woff2", family: "ff0" }],
    true,
  );
  const result = expect(harness.run()).rejects.toThrow("document fonts timed out");
  await vi.advanceTimersByTimeAsync(45_000);
  await result;
});
