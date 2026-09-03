import { spawn } from "node:child_process";

const pnpmCli = process.env.npm_execpath;
const pnpm = pnpmCli ? process.execPath : "pnpm";
const gates = [
  ["类型检查", ["check"]],
  ["共享战斗单测", ["--filter", "@adou/shared", "test"]],
  ["规则/确定性/房间回归", ["--filter", "@adou/qa", "test"]],
  ["生产构建", ["build"]],
  ["桌面与手机视口 E2E", ["--filter", "@adou/qa", "test:e2e"]],
  ["发布合同门禁", ["--filter", "@adou/qa", "test:release"]],
];

function run(args) {
  return new Promise((resolve) => {
    const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
    const child = spawn(pnpm, commandArgs, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.once("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

const results = [];
for (const [name, args] of gates) {
  console.log(`\n[QA] ${name}`);
  const code = await run(args);
  results.push({ name, code });
}

console.log("\n[QA] 验收汇总");
for (const result of results) console.log(`${result.code === 0 ? "PASS" : "FAIL"}  ${result.name}`);
process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
