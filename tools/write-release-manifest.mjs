import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(process.cwd(), process.argv[2] ?? "dist");
const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const sharedConfig = await readFile(path.join(repositoryRoot, "packages/shared/src/config.ts"), "utf8");
const protocolVersion = sharedConfig.match(/protocolVersion:\s*["']([^"']+)["']/)?.[1];
if (!protocolVersion) throw new Error("无法从共享配置读取 protocolVersion");
const rulesBaselines = (await readdir(path.join(repositoryRoot, "docs")))
  .map((file) => file.match(/^RULES_(\d+\.\d+\.\d+)_BASELINE\.md$/)?.[1])
  .filter(Boolean);
if (rulesBaselines.length !== 1) throw new Error("发布时必须存在且只能存在一个 RULES_*_BASELINE.md");

function git(...args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

// Always describe the checked-out tree. workflow_dispatch may check out an old
// release ref while GITHUB_SHA still points at the workflow's source branch.
const gitSha = git("rev-parse", "HEAD");
const sourceCommittedAt = git("show", "-s", "--format=%cI", gitSha);
const manifest = {
  schemaVersion: 1,
  appVersion: rootPackage.version,
  rulesBaseline: rulesBaselines[0],
  protocolVersion,
  deploymentEnvironment: process.env.VITE_DEPLOY_ENV || "preview",
  gitSha,
  sourceCommittedAt,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release manifest written for ${manifest.appVersion} (${gitSha.slice(0, 12)}).`);
