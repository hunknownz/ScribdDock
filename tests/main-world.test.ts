import { expect, it } from "vitest";
import { mainWorldCall } from "../src/adapters/scribd/evaluate.js";

it("invokes a function expression instead of returning an unserializable function", () => {
  const script = mainWorldCall("mw:({ value }) => ({ value })", { value: 42 });
  expect(new Function(`return ${script.slice(3)}`)()).toEqual({ value: 42 });
});

it("serializes arguments as data", () => {
  const value = "quotes '\" and parentheses );";
  const script = mainWorldCall("mw:({ value }) => value", { value });
  expect(new Function(`return ${script.slice(3)}`)()).toBe(value);
});

it("requires the explicit main-world prefix", () => {
  expect(() => mainWorldCall("() => true")).toThrow("main-world");
});
