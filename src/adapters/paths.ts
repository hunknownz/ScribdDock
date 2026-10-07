import { homedir } from "node:os";
import { resolve } from "node:path";

export function expandHomePath(value: string, home = homedir()): string {
  if (value === "~") return home;
  if (/^~[/\\]/.test(value)) return resolve(home, value.slice(2));
  return value;
}
