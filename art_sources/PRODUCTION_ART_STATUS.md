# 战场美术重制 · 2026-09-17

## 范围与交付

按用户要求在当前任务独立制作并接入地图、兵将、敌军、攻击/绝技、HUD 与 BUFF 图标；不改原版规则、经济、存档或联网协议。目标是统一的国风 Q 版手绘 2.5D 战场，不是仅交概念图。

- 39 个新资源：12 武将、4 兵种、4 普通敌军、2 BOSS、3 城楼/营地/阿斗、4 地表、6 BUFF、4 光效。
- 主 HUD 使用青铜/深玉/宣纸视觉；血量、波次与备战状态分区。地图使用世界坐标连续取样，布阵格仍独立明确。攻击与绝技区分枪芒、新月、箭雨、冲击波、冲锋。
- 图片模式不再用两枚大字棋盖住武将；保留原命中区域，可点击查看、拖出任意一半拆字。拖动时显示完整大字。
- BOSS、绝技、BUFF 掉落提示避开棋盘和兵营；BUFF 保留左右翻页、说明和拖放。
- 修正弹道到达前提前闪白；限制普通攻击每批/同时存活特效数量；滚动去重代替清空事件集合，避免快照重叠重播；移除静止棋子抖动，遵循 reduced-motion。

## 来源与复现

正式新位图来自 GPT 网页版「雷鑫」项目的「生成游戏美术图」对话，完整提示词可追溯：
https://chatgpt.com/g/g-p-69bcee09853c81918339a51d5fd2ba4e-lei-xin/c/6aabb68b-f398-83ee-8348-e0a6c316e164

production/*-web-*.png 保留原图；正式选用及格子顺序见 tools/prepare-production-art.cjs。主将 v1、副将 v1、光效 v1 有切图边界问题，已由 v2 替代。主将 v2 按实际空白通道 y=660/1254 分割，不按数学中线截脚。

运行 node tools/prepare-production-art.cjs：验证真实 alpha 与安全边距，按完整轮廓裁切，统一锚点、尺寸，再输出 WebP。人物/地表 256px，BUFF/光效 192px，质量 84、alpha 100。先验证所有输入，再替换输出；export-report.json 记录源 SHA-256 与边缘，不自动抠图/补画。Sharp 使用项目或 Codex bundled runtime，也可用 ADOU_SHARP 指定模块。

输出为 apps/client/public/assets/v2/、presentation/assets/production.json 与精简键表。原资源保留为兼容回退，规则不依赖美术文件名。

## Blender

实际通过 Blender MCP 在 5.2.1 LTS 制作并检查场景。blender/adou-production-palette.blend 是内嵌最终贴图的材质源文件，production_palette.py 可复现。adou-terrain.blend 与 drafts/ 是早期烘焙验证；grass-candidate-v1.png 为早期内置生图候选，均不作为最终资源。运行时仍为 Phaser 2D，不增加实时 3D 计算，也不在房间快照中传图片。

## 验收与边界

最终验收结果：

- `pnpm verify` 通过：共享 104、客户端 39、服务端 5、QA 13，共 161 项测试；类型检查、客户端/管理端预览构建、发布静态检查及权威服务端回环 smoke 通过。
- 完整桌面/390px 手机 E2E：27 通过、1 跳过（仅手机执行的真实触摸测试在桌面项目跳过）。包括拆字、换将、BUFF 说明/拖放、道具重启保存、开局保护和技能表现。
- 对已构建的预览包再次验收画面、BUFF 和真实触摸：5 通过、1 跳过。首次运行因测试固定了开发后端会话键而停在登录页，修正 QA 的可配置拦截地址后重跑通过；未更改游戏认证实现。
- 可见 Chromium 性能专项通过：32 个敌人、10Hz 快照，采样约 60.3 FPS，负载中拖动成功。软件无头模式为约 19 FPS，不能将其当作真实设备帧率；此测试不代表低端手机或所有设备的性能承诺。
- 39 个新资源合计 750,340 bytes；清单全部 46 个活动光栅合计 1,794,420 bytes，低于原预算 1,843,376 bytes。客户端 JS 1,669,866 bytes（gzip 约 455.41 kB），CSS 29,906 bytes。
- `acceptance/desktop-battle.png`、`mobile-battle.png` 为最终运行画面；`*-ultimate.png` 是技能触发后消退阶段截图，不是大招峰值展示。实际 transient 帧差及效果类型另有自动化回归。
- 生产构建命令被既有安全校验阻止：仓库 `.env.production` 有意保留 `VITE_DEPLOY_ENV=preview` 和 `.invalid` 占位地址。正式构建必须由发布环境注入正确配置；本轮没有绕过校验、写入线上配置或部署。

复验命令：

- node tools/prepare-production-art.cjs
- pnpm verify
- pnpm --filter @adou/client build:production
- pnpm --filter @adou/qa test:e2e
- 设置 QA_HEADED_PERF=1，运行 realtime-rendering.spec.ts --headed --project desktop-chromium

性能专项门槛 45 FPS。桌面/390px 手机截图已人工检查，BUFF 与兵营不重叠；资源请求、控制台、技能消退及真实 touch events 拆字均有回归。使用隔离测试账号，不操作真实玩家房间。预览构建使用占位后端，运行预览包 E2E 时设置 `QA_SUPABASE_ORIGIN=https://preview-not-configured.invalid`，使测试拦截与会话存储键匹配；默认开发测试保持原行为。

本轮不代表已发布外网，不声称所有目标机型均完成认证。角色使用透明立绘与程序动作/特效；完整骨骼、多方向逐帧动画及音频重制不在此次范围。美术风格仍可由用户实机验收调整。
