// The words zSol never uses where people or the public read: in what the panel shows, and in
// this repository, which is public.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BANNED: readonly [RegExp, string][] = [
  [/\banonymous(ly)?\b/i, "anonymous"],
  [/\buntraceable\b/i, "untraceable"],
  [/\bno trace\b/i, "no trace"],
  [/\binvisible\b/i, "invisible"],
  [/\bmixer\b/i, "mixer"],
  [/privacy\s*cash/i, "the pool's maker by name"],
  [/multix/i, "a private repository's name"],
  [/—/, "an em dash"],
];

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

describe("words", () => {
  it("never says what zSol doesn't say", () => {
    const files = [
      ...filesIn("src"),
      ...filesIn("tests").filter((path) => !path.endsWith("words.test.ts")),
      ...filesIn("scripts"),
      "README.md",
    ].filter((path) => /\.(ts|tsx|mjs|css|html|md|json)$/.test(path));
    const found = files.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return BANNED.filter(([word]) => word.test(text)).map(([, what]) => `${path}: ${what}`);
    });
    expect(found).toEqual([]);
  });
});
