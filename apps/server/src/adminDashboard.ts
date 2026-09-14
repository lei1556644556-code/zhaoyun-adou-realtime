import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { OperationsMetricsSnapshot } from "@adou/shared";
import type { OperationsMetrics } from "./operationsMetrics";

interface AdminDashboardOptions {
  app: Express;
  monitor: OperationsMetrics;
  token: string;
  staticDir: string;
  snapshot: () => OperationsMetricsSnapshot;
}

function bearerToken(request: Request) {
  const header = request.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function tokenMatches(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export function registerAdminDashboard(options: AdminDashboardOptions) {
  const { app, monitor, snapshot, staticDir, token } = options;
  const requireAdmin = (request: Request, response: Response, next: NextFunction) => {
    if (!token) {
      response.status(503).json({ ok: false, code: "ADMIN_DISABLED", message: "生产环境尚未配置运维后台令牌" });
      return;
    }
    if (!tokenMatches(token, bearerToken(request))) {
      response.status(401).setHeader("WWW-Authenticate", "Bearer").json({
        ok: false,
        code: "ADMIN_UNAUTHORIZED",
        message: "运维令牌无效",
      });
      return;
    }
    next();
  };

  app.get("/api/admin/metrics", requireAdmin, (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(snapshot());
  });

  app.get("/api/admin/metrics/stream", requireAdmin, (request, response) => {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    monitor.streamOpened();

    const send = () => response.write(`event: metrics\ndata: ${JSON.stringify(snapshot())}\n\n`);
    send();
    const timer = setInterval(send, 2_000);
    timer.unref();
    request.once("close", () => {
      clearInterval(timer);
      monitor.streamClosed();
      response.end();
    });
  });

  if (!existsSync(staticDir)) return false;
  app.use("/admin", express.static(staticDir, { index: "index.html", fallthrough: true }));
  app.get("/admin/{*path}", (_request, response) => response.sendFile(path.join(staticDir, "index.html")));
  return true;
}
