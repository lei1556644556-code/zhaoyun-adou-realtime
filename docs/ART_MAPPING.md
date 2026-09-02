# 规则 ID 与画面对应

规则判断不依赖图片识别，也不会让生成图参与“猜字”。

- `packages/shared/src/config.ts` 保存文字 ID、合字表、兵种与武将数值。
- `packages/shared/src/simulation.ts` 只按这些稳定 ID 判定移动、合成、攻击和同步。
- `apps/client/src/game/BattleScene.ts` 收到规则状态后，用代码绘制圆牌并直接写入该 ID（例如 `赵`、`云`、`赵云`）。
- 因而 `赵 + 云 → 赵云` 是配置表的确定映射，与生成图片文件名、图像内容和加载结果无关。

本次生成的 `backgrounds/lobby-zhaoyun-adou.webp` 只作为大厅主视觉，不进入战斗判定。战场道路、白格、草格、营地、按钮、文字棋子和生命/波次 HUD 均由 Phaser 确定性绘制，保证电脑与手机缩放后仍清楚、可交互。
