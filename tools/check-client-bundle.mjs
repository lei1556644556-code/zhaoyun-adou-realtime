import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve(process.cwd(), process.argv[2] ?? "dist");
// 1.5.0 增加可离线演算的完整武将技能状态机，给予不到 1% 的净增长空间。
const limits = { ".js": 1_660_000, ".css": 30_000 };
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolutePath);
    else files.push({ path: path.relative(outputDirectory, absolutePath), size: (await stat(absolutePath)).size });
  }
}

await walk(outputDirectory);
for (const [extension, limit] of Object.entries(limits)) {
  const matching = files.filter((file) => path.extname(file.path) === extension);
  const total = matching.reduce((sum, file) => sum + file.size, 0);
  if (total > limit) throw new Error(`${extension} 产物 ${total} bytes 超过预算 ${limit} bytes`);
  console.log(`${extension} bundle budget: ${total}/${limit} bytes.`);
}
