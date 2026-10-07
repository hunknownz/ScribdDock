import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const core = ["domain", "ports", "service", "errors"];
describe("application dependency boundaries", () => {
  it.each(core)("keeps %s independent of adapters and vendor packages", (module) => {
    const code = readFileSync(new URL(`../src/${module}.ts`, import.meta.url), "utf8");
    const specifiers = [...code.matchAll(/(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    for (const specifier of specifiers)
      expect(specifier).toMatch(/^\.\/(?:domain|ports|service|errors)\.js$|^node:/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });
});

it("keeps PDF export native without rasterizing browser pages", () => {
  const files = readdirSync(new URL("../src/", import.meta.url), { recursive: true });
  for (const file of files.filter((file) => String(file).endsWith(".ts"))) {
    const code = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    expect(code).not.toMatch(/\.screenshot\s*\(|\bembed(?:Png|Jpg)\s*\(/);
  }
});
