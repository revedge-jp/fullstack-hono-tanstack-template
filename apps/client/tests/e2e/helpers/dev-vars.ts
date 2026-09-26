import { readFileSync } from "node:fs";
import { join } from "node:path";

// アプリ（client の Worker）が実際に読む .dev.vars を読む。無ければ空。
export function readDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(join(import.meta.dirname, "../../../.dev.vars"), "utf8");
    const vars: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=["']?([^"']*)["']?\s*$/);
      if (m?.[1] && m[2] !== undefined) {
        vars[m[1]] = m[2];
      }
    }
    return vars;
  } catch {
    return {};
  }
}
