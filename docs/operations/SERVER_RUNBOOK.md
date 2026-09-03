# 独立实时服务器运行手册

## 当前边界

`apps/server` 是可选 Socket.IO 权威模拟进程，`/health` 返回房间数和共享协议版本。当前 GitHub Pages 客户端使用 Supabase Realtime 的房主权威实现，尚未通过 `MatchTransport` 接入该进程。因此服务器通过健康检查不等于线上双人链路已经使用它。

房间、席位、命令去重和快照全在单进程内存中。进程重启会丢失房间，多副本没有共享状态；在 06 模块给出持久化或房间粘性方案前只能单实例预览，不能宣称高可用生产服务。

## 启动与健康

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm smoke:server
PORT=3001 CLIENT_ORIGIN=https://example.invalid pnpm --filter @adou/server start
curl --fail http://127.0.0.1:3001/health
```

生产入口必须由 TLS 反向代理提供 HTTPS/WSS，设置精确 `CLIENT_ORIGIN`，并把进程工作目录和 `STATIC_DIR` 固定在部署清单中。禁止把 Supabase service role key 注入此进程；当前实现不需要数据库管理权限。

## 上线前阻断项

- 06 模块提供客户端 `MatchTransport` 接线、协议兼容测试和断线恢复语义。
- 明确单实例/粘性会话或共享房间状态方案。
- 增加 SIGTERM 优雅停机、连接数/事件循环/错误率监控和结构化日志。
- 选择托管平台、域名、TLS、健康探针与最小/最大副本数。
- 07 模块完成两浏览器跨网测试、刷新、断网和进程重启验收。

这些条件未满足时，本仓库只保留可复现启动与 CI 冒烟，不添加猜测性的生产部署文件。
