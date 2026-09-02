# 赵云与阿斗 · 1.0.9 规则复刻 + 实时对战

浏览器可运行的竖屏塔防版本。核心对局以安装包 1.0.9 的实机行为和内置配置为基线；真人房间、随机匹配和人机对战只包在核心规则外层，不各自维护另一套战斗数值。

## 在线试玩

[打开 GitHub Pages 试玩版](https://lei1556644556-code.github.io/zhaoyun-adou-realtime/)

GitHub Pages 前端通过 Supabase Auth 登录并同步云存档，可直接体验人机模式。创建房间、加入房间和随机匹配的前端及权威房间服务均已包含在仓库中；公开真人对战还需要单独部署 `apps/server` 并配置 `VITE_SERVER_URL`。

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
- 1–5 级单位分别使用素、青、蓝、紫、金升阶边框；所有合成升级都有定位爆点，紫色/金色武将另有全屏登场提示。
- 人机对战、创建房间、输入房号加入、随机匹配；在线对局由服务器权威模拟。
- 玩家自助创建账号密码并登录；密码只进入 Supabase Auth，业务表不保存明文或散列密码。
- 刷新页面自动续局：人机完整战局快照按账号保存到 Supabase 并保留本地兜底，真人恢复原房间席位与服务器进度；点击“退出本局”才会清除当前对局存档。

规则与数值明细见 [docs/RULES_1.0.9_BASELINE.md](docs/RULES_1.0.9_BASELINE.md)。

## 直接运行

根目录双击 `双击启动试玩.cmd`。脚本会启动网页与房间服务器，然后打开：

- 试玩页：http://localhost:5173
- 房间服务：http://localhost:3001
- 健康检查：http://localhost:3001/health

不要直接双击 `apps/client/index.html`；浏览器的 ES Module 和 WebSocket 必须通过 HTTP 服务运行。若误开该文件，页面会显示正确启动提示。

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
```

## 发布试玩链接

仓库包含 GitHub Pages 工作流。推送到 GitHub 后，在 Settings → Pages 中选择 **GitHub Actions**，即可发布静态的人机试玩版。

跨设备真人对战还需把 `apps/server` 部署到支持 Node.js/WebSocket 的服务，并在构建客户端时设置：

```bash
VITE_SERVER_URL=https://你的房间服务器地址
```

## Supabase 初始化

先在目标 Supabase 项目的 SQL Editor 执行：

```text
supabase/migrations/20260902133000_player_accounts.sql
```

迁移会创建 `player_profiles` 云存档表并启用 RLS：每个登录用户只能读取、插入和更新自己的记录，匿名用户无表权限。客户端支持用环境变量覆盖项目配置：

```bash
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=你的PublishableKey
```

## 目录

```text
apps/client        Phaser 战场、响应式大厅与人机模式
apps/server        房间、随机匹配、断线席位、权威 Tick
packages/shared    地图、数值、协议、战斗模拟和自动测试
supabase            玩家账号档案、RLS 与云存档迁移
docs               复刻基线与美术对应说明
```
