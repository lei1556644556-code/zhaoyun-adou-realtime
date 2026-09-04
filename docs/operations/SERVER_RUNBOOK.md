# 常驻权威服务器运行手册

## 生产职责

`apps/server` 是真人对战的唯一权威端：客户端只提交 `GameCommand`，服务端调用 `packages/shared` 推进 10Hz 确定性模拟并广播快照。Supabase 只负责账号令牌校验、读取账号累计局数和保存房间检查点；GitHub Pages 只托管静态文件。

生产模式拒绝以下缺失配置：精确 `CLIENT_ORIGIN`、Supabase URL/publishable key、仅服务端持有的 service-role key。浏览器永远不能获得 service-role key。

直接部署在反向代理同机时保持默认 `HOST=127.0.0.1`、`PORT=3001`，不向公网暴露 Node 监听端口；只有容器平台需要跨网络命名空间接入时才显式设置 `HOST=0.0.0.0`。

## 本地验证

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm smoke:server
pnpm --filter @adou/qa test:integration
```

本地无 Supabase 凭证时，`REQUIRE_AUTH=false` 允许集成测试使用临时访客身份；不得把该值用于生产。

## Supabase

按顺序执行：

```text
supabase/migrations/20260902133000_player_accounts.sql
supabase/migrations/20260903150000_authoritative_matches.sql
```

`zhaoyun_adou_matches` 开启 RLS 并撤销 `anon/authenticated` 权限。服务端只持久化恢复令牌的 SHA-256，不保存明文。成功命令立即排队写检查点，战斗中至少每秒写一次；进程重启后 `room:resume` 可从未过期检查点恢复。

## Render 常驻实例

仓库根目录的 `render.yaml` 使用付费 `0.5c-512mb` Web Service，Dockerfile 为 `Dockerfile.server`。免费实例空闲会休眠，不符合实时房间“常驻”要求。

Render 首次创建时填写三个 `sync:false` 变量：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

其余生产值已在 Blueprint 中声明。部署成功后确认：

```bash
curl --fail https://<service>.onrender.com/health
```

响应必须同时包含 `authority:"server"`、`authentication:true`、`persistence:true`。随后将完整 HTTPS 地址写入 GitHub Actions 仓库变量 `PRODUCTION_SERVER_URL`，再发布 Pages。

## 运行与恢复

- Render 健康探针：`GET /health`。
- `SIGTERM/SIGINT`：停止前排队保存所有内存房间，最长等待平台的 30 秒关闭窗口。
- 无连接房间在内存保留 10 分钟，数据库检查点保留 24 小时；内存释放后仍可凭同账号和恢复令牌重新装载。
- 服务端只运行单实例。若未来横向扩容，必须先增加跨实例房间租约/消息总线，不可直接把同一房间分散到两个模拟进程。
- 回滚服务器时必须保持协议、规则、配置结构和快照版本兼容；握手不兼容会明确拒绝并提示刷新。
