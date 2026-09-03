import { readFileSync } from "node:fs";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
export const rulesBaseline = readFileSync(path.join(repositoryRoot, "docs/RULES_1.0.9_BASELINE.md"), "utf8");
export const propsBaseline = readFileSync(path.join(repositoryRoot, "docs/PROPS_1.0.9_IMPLEMENTATION.md"), "utf8");

export function section(markdown: string, heading: string, nextHeading: string) {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) throw new Error(`Cannot find contract section: ${heading}`);
  return markdown.slice(start, end);
}

export function markdownRows(markdown: string) {
  return markdown.split(/\r?\n/)
    .filter((line) => /^\|.*\|$/.test(line.trim()) && !/^\|[\s:|-]+\|$/.test(line.trim()))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((row) => !row.some((cell) => /^-+$/.test(cell)));
}

export function contractNumber(pattern: RegExp, markdown = rulesBaseline) {
  const match = markdown.match(pattern);
  if (!match?.[1]) throw new Error(`Contract number missing for ${pattern}`);
  return Number(match[1]);
}
