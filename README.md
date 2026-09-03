# 赵云与阿斗 · 1.0.9 规则复刻 + 实时对战

浏览器可运行的竖屏塔防版本。核心对局以安装包 1.0.9 的实机行为和内置配置为基线；真人房间、随机匹配和人机对战只包在核心规则外层，不各自维护另一套战斗数值。

## 在线试玩

[打开 GitHub Pages 试玩版](https://lei1556644556-code.github.io/zhaoyun-adou-realtime/)

GitHub Pages 前端通过 Supabase Auth 登录并同步云存档，可直接体验人机与真人模式。创建房间、加入房间和随机匹配通过 Supabase Realtime 通道连接，房主执行唯一权威战斗模拟并向另一名玩家广播快照。

## 已接入

- 640×1386 原比例竖屏，8 列×10 行上下同图战场；电脑和手机默认按可视窗口整屏显示，并可用“− / 适屏 / ＋”缩放。
- 巨鹿、云梦泽、虎牢关、赤壁四张包内地图格子编码。
- 开局 20 馒头；征兵 10 起、每次 +2；一次获得 5 枚棋子并进入五格营地。
- 棋子可在营地内换位、升级、合字，也可在营地与己方白格之间双向拖动；按住拖拽期间战斗不会暂停。
- 同字同级升级；赵+云、张+飞等 12 组姓名在营地或棋盘均可合为占两格的武将；上阵后可把任一姓名字拖出并拆回两个文字棋子。
- 铲子只能开垦与已开放区域相邻的己方草格。
- 3 点阿斗生命、20 波、普通击杀 +1、Boss +10、漏怪每点生命 +10。
- 对方阿斗血量显示在顶部，我方阿斗血量固定在地图下方安全栏，避免与兵线重叠。
- 每次有效攻击由权威战斗事件驱动，包含出手闪光、箭矢/枪芒/冲锋/刀光、命中特效和伤害数字。
- 战场可随时切换“原版字棋版/形象版”并记住选择；攻击特效不会额外复制或放大单位头像。
- 1–5 级单位分别使用素、青、蓝、紫、金升阶边框；所有合成升级都有定位爆点，紫色/金色武将另有全屏登场提示。
- 人机对战、创建房间、输入房号加入、随机匹配；在线对局由房主权威模拟，通过 Supabase Realtime 同步。
- 玩家自助创建账号密码并登录；密码只进入 Supabase Auth，业务表不保存明文或散列密码。
- 刷新页面自动续局：人机完整战局快照按账号保存到 Supabase 并保留本地兜底；真人模式在房主页面保持在线时恢复原房间席位，房主刷新则从本地权威快照续局；点击“退出本局”才会清除当前对局存档。

规则与数值明细见 [docs/RULES_1.0.9_BASELINE.md](docs/RULES_1.0.9_BASELINE.md)。

## 直接运行

根目录双击 `双击启动试玩.cmd`。脚本会启动网页和仓库内保留的独立房间服务器，然后打开：

- 试玩页：http://localhost:5173
- 房间服务：http://localhost:3001
- 健康检查：http://localhost:3001/health

当前网页真人模式默认使用 Supabase Realtime；`apps/server` 是可选的独立 Node 房间服务实现。不要直接双击 `apps/client/index.html`，浏览器的 ES Module 必须通过 HTTP 服务运行。

命令行方式（Node.js 24、pnpm 11）：

```bash
pnpm install
pnpm dev
```

校验：

```bash
pnpm test
pnpm check
pnpm build
pnpm verify
```

`pnpm verify` 是合并门禁：校验版本与迁移台账、运行测试和类型检查、生成隔离的 Preview 产物，并冒烟检查独立房间服务器。

## 发布试玩链接

仓库包含 GitHub Pages 工作流。先在 Settings → Pages 中选择 **GitHub Actions**，并按 `docs/operations/ENVIRONMENTS.md` 配置生产仓库变量。生产发布不会随 main 自动发生；维护者需手动运行 `Deploy GitHub Pages`，输入已通过验收的完整 commit SHA 或 `vX.Y.Z` 标签。工作流会对该 ref 重新执行发布门禁，旧标签也是静态客户端的回滚入口。

PR 和 main 的 `CI` 工作流会生成隔离的静态 Preview artifact，但默认不连接生产后端。完整账号和双人预览需要独立 Preview Supabase 项目。详细集成顺序、迁移和回滚见 `docs/operations/`。

## Supabase 初始化

先在目标 Supabase 项目的 SQL Editor 执行：

```text
supabase/migrations/20260902133000_player_accounts.sql
```

迁移会创建独立的 `zhaoyun_adou_profiles` 云存档表并启用 RLS：每个登录用户只能读取、插入和更新自己的记录，匿名用户无表权限。使用独立表名可避免与 Supabase 项目中其他应用的玩家资料表冲突。客户端由环境变量提供项目配置。开发者可复制到 `apps/client/.env.development.local`；正式 Pages 发布由仓库变量注入：

```bash
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=你的PublishableKey
```

## 目录

```text
apps/client        Phaser 战场、响应式大厅与人机模式
apps/server        可选的独立 Node 房间服务实现
packages/shared    地图、数值、协议、战斗模拟和自动测试
supabase            玩家账号档案、RLS 与云存档迁移
docs               复刻基线与美术对应说明
```
