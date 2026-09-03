# 集成发布与线上运维方案

更新日期：2026-09-03

## 审计结论

| 范围 | 当前状态 | 第一轮处置 |
|---|---|---|
| 客户端组合入口 | `main.ts` 约 1024 行，同时包含 DOM、账号、经济、商店、存档、战局和传输接线 | 先把环境依赖改为组合根单次读取并显式注入；业务拆分等待 03/05/06 的稳定端口 |
| 共享层 | 客户端与服务器共同依赖 `@adou/shared`，方向正确；协议版本为 `0.3.0` | 构建清单记录协议版本，发布前运行共享测试 |
| 构建 | Node/pnpm 仅写在 README/工作流；前端单包约 1.52 MB，生产还发布 sourcemap | 固定 Node 24/pnpm 11.19.0，增加体积预算；生产禁用 sourcemap |
| GitHub Pages | main push 直接构建发布，未经过完整测试门禁 | 改为只允许人工选择精确 SHA/标签，发布任务重新执行完整门禁；旧标签用于回滚 |
| 预览 | 无隔离环境 | PR 生成 14 天静态 artifact；默认 `.invalid` 后端，完整预览依赖独立 Supabase 项目 |
| Supabase | 单个迁移，未链接 CLI；客户端曾在两个文件重复硬编码配置 | 建立迁移台账、环境合同与迁移/回滚手册；不自动执行远端迁移 |
| 独立实时服务器 | 只有内存房间进程；无持久化、水平扩展、部署平台或流水线；客户端当前不消费它 | 增加健康冒烟门禁与运行手册；06 模块交付传输端口和状态策略前不发布 |
| 远端状态 | 本机 `gh` 凭据失效，无法核实 Pages 环境保护、仓库变量或历史运行 | 上线前由维护者按清单复核，不把未知状态当已配置 |

## 按依赖集成顺序

1. 00 冻结合同版本和消费者清单。
2. 01 合入有证据的规则配置；不接受入口文件里的临时数值。
3. 02 合入确定性战斗命令、快照、事件及契约测试。
4. 05 交付账号/进度适配器与只前向迁移；在应用代码前先将迁移部署到 Preview。
5. 06 交付 `MatchTransport`、服务器状态策略和协议兼容测试。
6. 03 与 04 分别接入稳定战斗端口和资源清单；二者可以并行，但不可绕过合同读取对方内部实现。
7. 08 在 `main.ts` 组合根接线并删除旧适配路径；一次只迁移一个端口，保留兼容窗口。
8. 07 执行桌面、手机、人机、双人、刷新恢复、断线重连和规则回归。
9. 08 发布 Preview，完成数据迁移演练和回滚演练后创建 `vX.Y.Z` 标签，再发布生产。

## 冲突热点

- `apps/client/src/main.ts`：03、05、06 都可能修改。各模块应新增自己的公开工厂/端口，08 负责最后接线，其他模块不直接重写入口。
- `apps/client/src/game/BattleScene.ts`：03 与 04 的共同热点。表现只消费事件和 `AssetManifest`，不得加入伤害或概率。
- `packages/shared/src/{types,config,simulation}.ts`：01 与 02 的热点。先配置和合同，后模拟实现；服务器/客户端禁止复制。
- `apps/server/src/index.ts` 与 `apps/client/src/net/RealtimeClient.ts`：06 内部存在两套联机路径。必须先决定 Supabase 房主权威或独立服务器权威，不能同时称为最终裁决者。
- `supabase/migrations/` 与 `CloudProgress.version`：05 负责结构，08 负责顺序。数据库、存档 JSON、协议版本不可在同一提交中无迁移地跳变。

## 版本规则

- 应用版本以根 `package.json` 为唯一版本源，三个 workspace 包必须同步。
- 原版规则基线 `1.0.9` 与应用版本分离，不把复刻基线误当产品发布版本。
- 战斗协议版本仍由 `packages/shared` 权威配置提供；每次客户端构建生成 `release-manifest.json`，记录应用版本、规则基线、协议版本、Git SHA 与提交时间。
- 破坏快照/命令/账号合同提升应用主版本；新增兼容功能提升次版本；修复提升补丁版本。

## 组合根收口路线

第一轮只收口运行环境并显式注入 Supabase 连接。后续在提供方完成合同后依次引入 `createAccountStore`、`createProgressStore`、`createMatchTransport`、`createPresentation` 和 `createBattleUI` 工厂。最终 `main.ts` 只负责读取配置、创建适配器、挂载 UI 和处理顶层启动失败；商店概率、奖励、日切、存档归一化及命令规则必须回到各自模块。

## 发布依赖

- GitHub 仓库变量：`PRODUCTION_SUPABASE_URL`、`PRODUCTION_SUPABASE_PUBLISHABLE_KEY`。
- GitHub Pages Source 为 GitHub Actions，`github-pages` environment 建议开启 reviewer 保护。
- Preview Supabase 项目及迁移完成；未配置时 PR artifact 只适合静态/布局检查。
- 07 模块签署验收结果，且发布 SHA 的 `CI` 工作流成功。
- 独立服务器若要上线，必须先确定托管平台、TLS、持久化/粘性会话、监控和客户端 `MatchTransport` 接线。

## 不在第一轮执行

- 不部署生产、不创建或修改远端 Supabase 项目、不猜测服务器托管平台。
- 不移动 `main.ts` 中仍归属 03/05/06 的业务实现，以免与尚未交付的模块分支产生无意义冲突。
- 不创建首个 release tag；需先完成 Preview 数据迁移和 07 验收。
