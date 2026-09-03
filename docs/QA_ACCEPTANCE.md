# 自动化测试与质量验收

## 测试金字塔

1. **规则与契约层（每次提交）**：从 `docs/RULES_1.0.9_BASELINE.md` 和 `docs/PROPS_1.0.9_IMPLEMENTATION.md` 读取冻结值，对照共享配置；不从实现函数反推预期。
2. **确定性与传输层（每次提交）**：验证相同种子/命令/Tick、JSON 快照恢复、传输克隆隔离，以及独立房间服务的双客户端同步、命令去重和断线凭证恢复。
3. **浏览器验收层（合并前）**：Chromium 下运行 1440×1100 桌面视口和 390×844 常见手机视口，验证页面身份、非空白、无框架错误层、控制台、画布、点击信息、攻击范围视觉变化、拖放合成升级和刷新恢复。
4. **真人环境层（发布前人工/预发布）**：两个真实 Supabase 账号、两台设备或两个独立浏览器上下文，执行创建/加入/刷新/断网/重连。自动化房间测试覆盖 Socket.IO 权威协议，但不能替代真实常驻服务、Supabase Auth/Postgres 与真实触屏硬件。

## 可重复命令

```bash
pnpm install
pnpm test
pnpm test:e2e
pnpm qa:acceptance
```

`qa:acceptance` 串行运行所有门禁并在末尾汇总；单项失败后仍继续后续检查，最终以非零退出码阻断发布。Playwright 产物写入已忽略的 `test-results/` 和 `playwright-report/`。

发布完成后可复用同一套浏览器验收直接检查线上构建（URL 必须保留末尾 `/`）：

```powershell
$env:QA_BASE_URL = "https://example.github.io/project/"
pnpm test:e2e
Remove-Item Env:QA_BASE_URL
```

## 发布门槛

- `pnpm check`、共享单测、QA 契约/确定性/房间回归、生产构建、桌面/手机 E2E 必须全部通过。
- `test:release` 不得存在失败：快照必须携带明确的 schema 版本，练习 AI 不得维护第二套武将合字清单。
- 两个真实 Supabase 账号完成房主/客席恢复；房主刷新后权威快照不回退，客席断线重连后席位和命令权限不变。
- 桌面和手机首屏不得横向溢出；画布点击与拖动不可互相误触；攻击范围显示必须与共享判定一致。
- 不允许带未解释的浏览器控制台错误、失败截图或不稳定重试进入发布分支。

## 首轮失败基线（2026-09-03）

| 检查 | 初始结果 | 复现/结论 |
|---|---|---|
| `pnpm test` | FAIL（启动前） | Windows 可选包 `@rolldown/binding-win32-x64-msvc` 首次安装未落盘，Vitest 无法启动；根包改为显式 optional dependency 后恢复。 |
| `pnpm check` | PASS | 三个原工作区包类型检查通过。 |
| `pnpm build` | FAIL（启动前） | 与 Vitest 相同的 Rolldown 原生绑定缺失；修复依赖后通过，但保留 1.52 MB 主包体积警告。 |
| 原有共享测试 | PASS | 环境恢复后 1 个文件、26 个用例通过。 |
| MatchSnapshot 合同版本 | FAIL（发布门禁） | `docs/contracts/README.md` 要求快照包含版本号，当前运行时快照没有显式 schema 版本。 |
| 规则单一来源 | FAIL（发布门禁） | `PracticeEngine.ts` 仍有独立 `heroPairs` 清单，可能与 `HERO_PAIRS` 漂移。 |

失败门禁只描述提供方缺口；07 模块不跨边界修改战斗、UI 或网络生产实现。修复应由对应模块完成，再由本验收脚本复测。

## 首轮自动化验收结果

执行环境为 Windows、Node.js 24、pnpm 11、Playwright Chromium 151。当前会话未提供 Browser 插件/Browser 技能，因此按前端测试规范记录为 `Browser plugin not available`，使用仓库内 Playwright 回退路径。

| 门禁 | 结果 |
|---|---|
| 类型检查 | PASS |
| 共享战斗单测 | PASS，26/26 |
| 规则/确定性/房间回归 | PASS，9/9 |
| 生产构建 | PASS，保留主包体积警告 |
| 桌面 1440×1100 + 手机 390×844 | PASS，4/4；手机交互连续重复 3 次为 6/6 |
| 发布合同门禁 | FAIL，2/2（快照版本、重复合字名单） |

真实常驻 Socket.IO 服务、Supabase Auth/Postgres、双真实账号、真实触屏硬件和浏览器矩阵仍属于发布前预发布验收，不在本地 mock 自动化的能力范围内。
