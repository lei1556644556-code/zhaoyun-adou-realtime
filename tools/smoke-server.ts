import { createServer } from "node:net";
import path from "node:path";

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("无法分配测试端口"));
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function main() {
  const port = await availablePort();
  process.env.PORT = String(port);
  process.env.CLIENT_ORIGIN = "http://127.0.0.1:5173";
  process.env.STATIC_DIR = path.resolve(process.cwd(), "../client/dist");

  const timeoutAt = Date.now() + 15_000;
  try {
    await import("../apps/server/src/index.ts");
    let lastError: unknown;
    while (Date.now() < timeoutAt) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        const body = await response.json() as { ok?: boolean; rooms?: number; protocol?: string };
        if (!response.ok || body.ok !== true || typeof body.rooms !== "number" || !body.protocol) {
          throw new Error(`健康检查响应无效：${JSON.stringify(body)}`);
        }
        console.log(`Server smoke test passed on port ${port}, protocol ${body.protocol}.`);
        process.exit(0);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError ?? new Error("服务器健康检查超时");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
