# 普攻动作与打击感（客户端表现）

用户要求参考原作“兵挥舞武器、刷刷刷”的连续攻击感。此轮仅修改 03/04 客户端动画与 07 验收，不修改共享模拟、伤害、攻速、攻击范围、技能触发或服务器协议。保持 `CombatEffectEvent` 向后兼容。

原包参考来自已核对 SHA-256 的 `dcc_restored/js/bundle.js`（见赵云源码审计）。`Ta.attack` 调用 `sF()` 再发射武器；`sF()` 区分角色动画播放与非角色部件的短促形变。不是只有弹道。原包 `prefab/bulletTrail/knifeTrail.lh`、`arrowTrail.lh`、`daoqiTrail.lh` 拖尾寿命分别为 0.2、0.3、0.178 秒；knife/pike/bow/cavalry Hit 预制体使用不同轮廓。以上是参考证据，不将其世界尺寸直接套用本项目。

实现约定：

- 角色动作绑定已确认攻击事件；前摇、接触、收招仅是表现时间，不延迟伤害或冻结模拟。
- 优先补四类士兵的真实姿势帧（手臂、武器、身体关节变化），不能只平移整张立绘冒充挥武器。
- 攻击动作不能修改棋子容器、占格或交互命中区域；字棋模式保留文字，动作在独立非交互层展示。
- 飞行特效立即进入短快弹道；接触时才播放命中反馈，减少慢速缩放、厚重烟尘及数字遮挡。
- 不用假连击增加伤害表现；命中次数以事件为准。低动效、切局、拖动、重绘均需清理和恢复。
- 本轮不自动部署；先完成本地动作与性能验收。

## 字棋追加要求

用户明确要求“用字做个动作”。字棋不是整体圆盘摇摆：圆盘、外圈、等级和交互根节点保持静止，独立文字层播放 55ms 起势、65ms 出手、110ms 归位。刀为抬字侧转后劈落，枪为回收后向目标前探，弓为横向压缩蓄力后弹开，骑为压低起势再向目标冲出；武将双字使用其武器动作类型。攻击角度来自已确认事件的目标；不改变技能触发、攻速、移动或伤害。

文字每次攻击先取消旧动作并归零，销毁时清理补间；低动效保持字静止，只保留必要弹道和命中反馈。赵云“七进七出”的虚影命中不重复驱动本体文字。文字层不接收指针事件，两个武将字仍可独立点击查看原单位。

用户进一步要求“更像人在动”：文字作为身体，背后增加同色的四条短笔画式手脚，独立摆臂、蹬腿补间；起势显现、出手伸展、收势淡出，静止状态完全隐藏。身体收势使用轻微惯性回弹。移除先前字棋格边的实体武器示意，以字自身的拟人动作作为动作主体，原来的弹道和命中反馈保留。无需增加图片资源。

## 资源与接口

- 新增 `attackMotion.ts`，原事件协议不变。`CombatVfx.attack` 仅追加可选本地接触回调。
- 四个士兵动作 WebP 合计 291,414 字节，归入独立 320,000 字节动画资源预算；属于首次静态加载，不增加对战消息。约 16MiB 解码纹理，尚未进行实体低端手机 GPU 验收。
- 生成模式、姿势提示及来源见 `art_sources/attack-motion/README.md`，规范化脚本为 `tools/prepare-attack-motion.cjs`。武将没有新增全套身体动作帧，沿用原有技能资源。
- 本轮只修改客户端表现与验收；未修改共享规则、服务端、部署工作流或线上配置。

## 交付文件

- `apps/client/src/presentation/attackMotion.ts`：士兵姿势动画、文字身体和短笔画手脚动作。
- `apps/client/src/game/BattleScene.ts`：绑定真实攻击事件，文字/形象模式接线及生命周期清理。
- `apps/client/src/presentation/combatVfx.ts`：短快弹道、命中反馈、特效容量及一次性接触回调。
- `apps/client/public/assets/motion/`、`art_sources/attack-motion/`、`tools/prepare-attack-motion.cjs`：运行时图集、生成来源和可复现规范化。
- `apps/client/src/presentation/__tests__/attackMotion.test.ts`、`combatVfx.test.ts`：资源预算、独立四肢、收势归位、低动效、容量和命中回调回归。
- `tests/qa/e2e/attack-motion.spec.ts`、`realtime-rendering.spec.ts`：双模式、双尺寸、连续攻击、双字武将交互及持续快照压力回归。

## 验证与边界

- 最终 `pnpm verify`：197 项自动化测试通过，全部类型检查、预览构建、服务端冒烟通过；JS 1,679,251 / 1,680,000 字节，未放宽预算。
- 图像版四兵种、技能有界生命周期此前已通过桌面/手机尺寸回归；文字拟人动作追加双尺寸回归，结果及录像保存在 `artifacts/attack-motion/glyph-person-qa/`。
- 最终浏览器命令：`QA_BASE_URL=http://127.0.0.1:4175 QA_SUPABASE_ORIGIN=https://preview-not-configured.invalid QA_HEADED_PERF=1 pnpm --filter @adou/qa test:e2e --headed attack-motion.spec.ts reduced-motion-combat.spec.ts realtime-rendering.spec.ts --grep 'text|paired general|keeps wave' --output ../../artifacts/attack-motion/glyph-person-qa`，24 项全部通过。32 敌人 / 10Hz 快照条件下，桌面形象/文字 60.2 / 60.3 FPS，手机尺寸形象/文字 60.1 / 60.2 FPS；四组均通过持续快照下拖动。
- 一轮中途并行重建预览目录曾造成一次页面导航失败，未进入战斗；最终验收先完成构建，再执行浏览器测试，避免产物重建干扰。
- 录像预览 `artifacts/attack-motion/text-chess-preview.mp4`。浏览器手机尺寸模拟不代表实体手机 GPU 性能；未新增音效或全套武将身体动作帧。
- 待集成：本地提交后按用户要求再发布，本轮未推送、未部署生产。
