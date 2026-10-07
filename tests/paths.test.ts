import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { printPreferences, profileDirectory } from "../src/adapters/camoufox.js";
import { expandHomePath } from "../src/adapters/paths.js";
import { defaultOutputFilename, isWindowsReservedFilename } from "../src/filenames.js";

it.each(["~/用户 空间", "~\\用户 空间"])("expands %s against the user's home", (value) => {
  expect(expandHomePath(value)).toBe(join(homedir(), "用户 空间"));
});

it("preserves native absolute and relative paths without expanding other user names", () => {
  const absolute = join(tmpdir(), "用户 空间", "文档.pdf");
  expect(expandHomePath(absolute)).toBe(absolute);
  expect(expandHomePath("relative path/file.pdf")).toBe("relative path/file.pdf");
  expect(expandHomePath("~someone/file.pdf")).toBe("~someone/file.pdf");
  expect(expandHomePath("~")).toBe(homedir());
});

it.each(["~/profile dir", "~\\profile dir"])("accepts profile override %s", (value) => {
  expect(profileDirectory({ SCRIBDDOCK_PROFILE_DIR: value })).toBe(join(homedir(), "profile dir"));
});

it("resolves default profile and print filenames using the native path implementation", () => {
  expect(profileDirectory({})).toBe(join(homedir(), ".scribddock", "profiles", "scribd"));
  const output = join("relative dir", "文档.pdf");
  expect(printPreferences(output)["print.print_to_filename"]).toBe(resolve(output));
});

it.each(["CON", "prn", "AUX.txt", "NUL", "COM1", "COM9", "LPT1", "LPT9", "COM¹", "COM²", "LPT³"])(
  "creates a real file instead of the Windows device %s",
  async (title) => {
    expect(isWindowsReservedFilename(`${title}.pdf`)).toBe(true);
    const name = defaultOutputFilename(title, "123");
    expect(name).toBe(`_${title}.pdf`);
    const directory = await mkdtemp(join(tmpdir(), "scribddock-name-"));
    try {
      const output = join(directory, name);
      await writeFile(output, "content");
      expect(await readFile(output, "utf8")).toBe("content");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.each(["CONsole", "COM10", "LPT10", "Document NUL", "工艺 文档"])(
  "preserves legitimate title %s",
  (title) => {
    expect(isWindowsReservedFilename(title)).toBe(false);
    expect(defaultOutputFilename(title, "123")).toBe(`${title}.pdf`);
  },
);
