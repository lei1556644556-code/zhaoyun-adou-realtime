# 客户端运行配置合同

## 版本与所有权

- 合同版本：`1.0.0`
- 提供方：08 集成发布与线上运维
- 消费方：05 账号经济与云存档、06 实时联机

## 配置结构

组合根调用 `loadRuntimeConfig()`，再把同一个 Supabase 连接配置显式传给账号与实时传输适配器：

```ts
interface RuntimeConfig {
  deploymentEnvironment: "local" | "preview" | "production";
  supabase: {
    url: string;
    publishableKey: string;
  };
  /** v2 权威联网接线后，production 必填；兼容期可缺省。 */
  realtimeServerUrl?: string;
}
```

环境变量为 `VITE_DEPLOY_ENV`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、`VITE_SERVER_URL`。它们均会进入浏览器产物，因此只能使用公开地址和 Supabase publishable/anon key，绝不能使用 service role key。

## 生命周期与错误语义

- 配置在客户端启动时读取一次，运行中不可切换环境。
- 当前实现会对 Supabase 缺值、未知环境、无效 URL、生产 HTTP 地址或疑似 service role key 立即拒绝启动。
- `realtimeServerUrl` 是 v2 迁移字段；接线完成后，生产环境必须提供 HTTPS/WSS 地址，预览环境可显式启用旧 P2P 兼容层。
- `apps/client/.env.production` 故意指向 `.invalid`，防止开发者把普通构建误当生产发布；正式工作流必须显式注入生产配置。

## 兼容策略

适配器构造函数从隐式读取环境变量改为接收结构化连接配置。后续新增可选字段时保持向后兼容；删除或重命名字段必须提升合同主版本，并由 08 模块统一接线。

## 验证

- `pnpm release:check`：检查占位环境、安全变量与版本一致性。
- `pnpm build:production`：生产配置预检后才生成静态产物。
- `pnpm verify`：使用不可路由的预览占位地址，确保 PR 不会误写生产数据。

## 未决问题

- 需要创建独立的 Preview Supabase 项目，配置仓库变量后才可进行完整账号/房间预览。
- `VITE_SERVER_URL` 的正式消费者和独立服务端持久化尚待按 [`realtime-authority-v2`](./realtime-authority-v2.md) 接线；接线前浏览器真人模式仍是 Supabase P2P 兼容层，不可作为正式联网发布。
