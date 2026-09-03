import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rootPackage = await readJson("package.json");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rootPackage.version), "根 package.json 版本必须是 SemVer");
assert(rootPackage.packageManager === "pnpm@11.19.0", "pnpm 版本必须与 CI 固定版本一致");
assert(rootPackage.engines?.node === ">=24 <25", "Node 主版本必须固定为 24");

for (const packagePath of ["apps/client/package.json", "apps/server/package.json", "packages/shared/package.json"]) {
  const packageJson = await readJson(packagePath);
  assert(
    packageJson.version === rootPackage.version,
    `${packagePath} (${packageJson.version}) 与根版本 (${rootPackage.version}) 不一致`,
  );
}

const requiredExampleVariables = [
  "VITE_DEPLOY_ENV",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "PORT",
  "CLIENT_ORIGIN",
  "STATIC_DIR",
];
const envExample = await readFile(path.join(repositoryRoot, ".env.example"), "utf8");
for (const variable of requiredExampleVariables) {
  assert(new RegExp(`^${variable}=`, "m").test(envExample), `.env.example 缺少 ${variable}`);
}

const sourcePaths = [
  "apps/client/src/main.ts",
  "apps/client/src/auth/SupabaseService.ts",
  "apps/client/src/net/RealtimeClient.ts",
  "apps/client/src/app/runtimeConfig.ts",
];
for (const sourcePath of sourcePaths) {
  const source = await readFile(path.join(repositoryRoot, sourcePath), "utf8");
  assert(!/service[_-]?role\s*[:=]/i.test(source), `${sourcePath} 疑似包含 service role 配置`);
}

const productionDefaults = await readFile(path.join(repositoryRoot, "apps/client/.env.production"), "utf8");
assert(/VITE_DEPLOY_ENV=preview/.test(productionDefaults), "默认 production 构建必须保持非生产环境标记");
assert(/\.invalid\b/.test(productionDefaults), "默认 production 构建不得连接真实后端");

const migrationLedger = await readJson("ops/migrations.json");
assert(migrationLedger.schemaVersion === 1, "ops/migrations.json schemaVersion 必须为 1");
const ledgerIds = migrationLedger.migrations.map((migration) => migration.id);
assert(new Set(ledgerIds).size === ledgerIds.length, "迁移台账存在重复 ID");
assert([...ledgerIds].sort().join("\n") === ledgerIds.join("\n"), "迁移台账必须按 ID 升序排列");

const migrationFiles = (await readdir(path.join(repositoryRoot, "supabase/migrations")))
  .filter((file) => file.endsWith(".sql"))
  .sort();
assert(migrationFiles.join("\n") === ledgerIds.map((id) => `${id}.sql`).join("\n"), "迁移台账与 SQL 文件不一致");

for (const file of migrationFiles) {
  assert(/^\d{14}_[a-z0-9_]+\.sql$/.test(file), `迁移文件名不符合时间戳规范：${file}`);
}

console.log(`Release metadata valid: app ${rootPackage.version}, ${migrationFiles.length} migration(s).`);
