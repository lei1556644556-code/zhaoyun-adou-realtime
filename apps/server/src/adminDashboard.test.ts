import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerAdminDashboard } from "./adminDashboard";
import { OperationsMetrics } from "./operationsMetrics";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function fixture(token = "test-token") {
  const app = express();
  const monitor = new OperationsMetrics(1_000);
  const snapshot = () => monitor.snapshot({
    now: 6_000,
    onlineUsers: 3,
    socketConnections: 3,
    rooms: [],
    authenticationRequired: true,
    persistenceEnabled: true,
    protocolVersion: "0.6.0",
    rulesetVersion: "1.0.9",
  });
  registerAdminDashboard({ app, monitor, token, staticDir: "missing-admin-dist", snapshot });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP");
  return { baseUrl: `http://127.0.0.1:${address.port}`, monitor };
}

describe("admin dashboard routes", () => {
  it("rejects missing or invalid bearer credentials", async () => {
    const { baseUrl } = await fixture();
    expect((await fetch(`${baseUrl}/api/admin/metrics`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/metrics`, {
      headers: { Authorization: "Bearer wrong-token" },
    })).status).toBe(401);
  });

  it("returns metrics and opens a cancellable SSE stream for a valid token", async () => {
    const { baseUrl, monitor } = await fixture();
    const headers = { Authorization: "Bearer test-token" };
    const response = await fetch(`${baseUrl}/api/admin/metrics`, { headers });
    expect(response.status).toBe(200);
    expect((await response.json() as { onlineUsers: number }).onlineUsers).toBe(3);

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/admin/metrics/stream`, { headers, signal: controller.signal });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: metrics");
    expect(monitor.snapshot({
      now: 6_000,
      onlineUsers: 3,
      socketConnections: 3,
      rooms: [],
      authenticationRequired: true,
      persistenceEnabled: true,
      protocolVersion: "0.6.0",
      rulesetVersion: "1.0.9",
    }).health.adminStreamClients).toBe(1);
    controller.abort();
  });
});
