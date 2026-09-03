# 环境与预览

## 环境矩阵

| 环境 | 构建方式 | 后端 | 用途 |
|---|---|---|---|
| Local | `pnpm dev` | `.env.development` 的现有共享测试项目，可用 `.env.development.local` 覆盖 | 本地联调 |
| Preview | `pnpm build:preview && pnpm preview` | 默认 `.invalid`；完整联调必须配置独立 Preview Supabase | PR 静态验收和集成测试 |
| Production | `pnpm build:production` | 必须显式注入生产仓库变量 | GitHub Pages 正式发布 |

所有 `VITE_*` 值都会打进浏览器代码，不属于服务端秘密。只能放 publishable/anon key；service role key 只能保存在受控服务端密钥系统，且本项目客户端与 Actions 都不需要它。

## GitHub 配置

在仓库 Settings → Secrets and variables → Actions → Variables 配置：

- `PRODUCTION_SUPABASE_URL`
- `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`

不要把这两个值配置为 `SUPABASE_SERVICE_ROLE_KEY`。Preview 项目就绪前，CI 保持 `.invalid` 占位，不会访问生产数据。CI 成功产出的 `client-preview-<sha>` artifact 保留 14 天，可下载后在目录中用任意静态服务器查看；账号/房间功能只有在构建前注入隔离 Preview 配置时才可用。

## 独立服务器变量

- `PORT`：监听端口，默认 `3001`。
- `CLIENT_ORIGIN`：允许的单一浏览器 Origin；生产不可保留宽松默认值。
- `STATIC_DIR`：可选客户端静态目录；必须按服务进程工作目录解析并在部署前验证。
- `VITE_SERVER_URL`：保留变量。当前客户端未消费，不能据此宣称独立服务器已经接线。
