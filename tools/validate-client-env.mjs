import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const mode = process.argv[2] ?? "production";
const clientRoot = process.cwd();
const fileOrder = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
let values = {};
for (const file of fileOrder) {
  const absolutePath = path.join(clientRoot, file);
  if (existsSync(absolutePath)) values = { ...values, ...parseEnv(await readFile(absolutePath, "utf8")) };
}
values = { ...values, ...process.env };

function required(name) {
  const value = values[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

const deploymentEnvironment = required("VITE_DEPLOY_ENV");
if (deploymentEnvironment !== mode) {
  throw new Error(`VITE_DEPLOY_ENV=${deploymentEnvironment}，期望 ${mode}`);
}

const url = new URL(required("VITE_SUPABASE_URL"));
const publishableKey = required("VITE_SUPABASE_PUBLISHABLE_KEY");
const serverUrl = new URL(required("VITE_SERVER_URL"));
if (mode === "production" && url.protocol !== "https:") throw new Error("生产 Supabase 地址必须使用 HTTPS");
if (/\.invalid$/.test(url.hostname) || /not-configured|your-project/i.test(url.href)) {
  throw new Error("生产/预览后端仍是占位地址");
}
if (/not-configured|your[_-]?publishable/i.test(publishableKey)) throw new Error("publishable key 仍是占位值");
if (/service[_-]?role/i.test(publishableKey)) throw new Error("客户端禁止注入 service role key");
if (mode === "production" && serverUrl.protocol !== "https:") throw new Error("生产权威服务器地址必须使用 HTTPS");
if (/\.invalid$/.test(serverUrl.hostname) || /not-configured|your-server/i.test(serverUrl.href)) throw new Error("权威服务器仍是占位地址");

console.log(`Client environment valid: ${deploymentEnvironment} -> ${url.origin}, authority ${serverUrl.origin}`);
