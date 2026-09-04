# 环境与预览

## 环境矩阵

| 环境 | 构建方式 | 后端 | 用途 |
|---|---|---|---|
| Local | `pnpm dev` | `.env.development` 的现有共享测试项目，可用 `.env.development.local` 覆盖 | 本地联调 |
| Preview | `pnpm build:preview && pnpm preview` | 默认 `.invalid`；完整联调必须配置独立 Preview Supabase | PR 静态验收和集成测试 |
| Production | `pnpm build:production` | 常驻 `apps/server` + Supabase Auth/Postgres | GitHub Pages 静态前端正式发布 |

所有 `VITE_*` 值都会打进浏览器代码，不属于服务端秘密。只能放 publishable/anon key；service role key 只放在 Render 服务端密钥中，客户端与 GitHub Actions 都不保存它。

## GitHub 配置

在仓库 Settings → Secrets and variables → Actions → Variables 配置：

- `PRODUCTION_SUPABASE_URL`
- `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`
- `PRODUCTION_SERVER_URL`（常驻权威服务 HTTPS 根地址）

不要把这两个值配置为 `SUPABASE_SERVICE_ROLE_KEY`。Preview 项目就绪前，CI 保持 `.invalid` 占位，不会访问生产数据。CI 成功产出的 `client-preview-<sha>` artifact 保留 14 天，可下载后在目录中用任意静态服务器查看；账号/房间功能只有在构建前注入隔离 Preview 配置时才可用。

## 独立服务器变量

- `HOST`：监听地址，默认 `127.0.0.1`；只有明确需要容器或公网接口监听时才设为 `0.0.0.0`。
- `PORT`：监听端口，默认 `3001`。
- `CLIENT_ORIGIN`：逗号分隔的精确浏览器 Origin；生产不可保留宽松默认值。
- `STATIC_DIR`：可选客户端静态目录；必须按服务进程工作目录解析并在部署前验证。
- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`：校验登录令牌并按用户身份读取进度。
- `SUPABASE_SERVICE_ROLE_KEY`：只在权威服务端保存，用于房间检查点。
- `REQUIRE_AUTH=true`：生产必须开启。
- `VITE_SERVER_URL`：客户端已消费；生产缺失或非 HTTPS 时构建直接失败。
