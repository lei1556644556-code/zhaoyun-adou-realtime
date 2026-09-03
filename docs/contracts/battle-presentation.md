# BattlePresentation v1.0.0

## 责任与依赖

- 事件提供方：02 权威战斗内核。
- 表现提供方：04 美术资源与战斗表现。
- 渲染端及接线：03 战场交互 UI、08 集成发布。
- 表现层只消费 `BattleEvent[]`，不通过快照 diff 推断合成、升级或死亡，不重算攻击范围、伤害、概率或目标。

## BattleEvent 结构

所有事件共有 `{ id, roomId, tick, slot, type }`。`id` 在房间生命期全局唯一，同一事件经断线重发仍使用原 id。坐标使用 `BattleAnchor`：

```ts
type BattleAnchor =
  | { kind: "cell"; cell: number; secondaryCell?: number }
  | { kind: "path"; progress: number }
  | { kind: "entity"; entityId: string }
  | { kind: "screen"; x: number; y: number };
```

v1 必须事件：

| type | 必须载荷 | 表现保证 |
|---|---|---|
| `ATTACK_RESOLVED` | `actor`, `from`, `impacts[]`, `special` | 播放兵种/武将动作、弹道和受击；不放大头像 |
| `UNIT_MERGED` | 两个 `sources`、`result { level, rarity }`、`at` | 每次合成都有汇聚及结果品阶/等级回馈 |
| `UNIT_UPGRADED` | `entity`、`fromLevel`、`toLevel`、`at` | 每次非合成升级都有等级印记回馈 |
| `ENTITY_DIED` | `entity`、`at` | 普通单位灰烬退场，Boss 旗帜倒伏，不从 HP diff 推断 |

`BattleEntityRef.role` 是表现分类，值为 `troop | hero | enemy | boss | prop`。`amountText` 如需显示，必须由事件提供方预先格式化；04 不根据伤害数值生成或修改它。

## 表现端口

```ts
interface PresentationSink {
  enqueue(cues: readonly PresentationCue[]): void;
}

class BattlePresentationController {
  constructor(sink: PresentationSink);
  consume(events: readonly BattleEvent[], context: PresentationContext): ConsumptionStats;
  reset(): void;
}
```

`PresentationCue` 是仅面向渲染的指令：`actor-motion | projectile | impact | damage-label | death | merge | upgrade | audio`。渲染器负责把 `BattleAnchor` 映射到当前镜像视角，不改写事件。

## 生命周期与重放

1. 每次收到快照/事件包时，08 将其中 `battleEvents` 原样传给 `consume`。
2. Controller 按 `event.id` 去重，且以有界 FIFO 保留已播放 id。
3. 房间发生变化、战斗重置或回放 seek 时调用 `reset()`。
4. 事件过载时优先保留死亡、合成、升级和特殊攻击 cue；被裁剪的低优先级 cue 仍标记事件已处理，避免重放风暴。

## 性能预算

| 场景 | cue/批 | 单次攻击命中上限 | 单命中粒子 | 去重 ID |
|---|---:|---:|---:|---:|
| 桌面端 | 48 | 8 | 8 | 800 |
| 移动端 | 24 | 4 | 4 | 400 |
| 减少动效 | 18 | 3 | 0 | 300 |

集成渲染器还必须将同时存活显示对象控制在桌面端 96、移动端 48 以内，将图集材质数控制在 2 个以内；持续超预算时先关闭粒子和伤害漂字，合成/升级/死亡语义 cue 保持最高裁剪优先级。

## 错误语义

- 重复 id：忽略且计入 `duplicateEvents`。
- 未知武将/兵种：使用通用刀光 profile，不影响事件处理。
- 锚点暂不存在：渲染器丢弃该 cue 并记诊断，不改写快照。
- planned 资源：使用 AssetManifest 声明的回退。

## 兼容与集成

- 当前 `MatchSnapshot.combatEvents: CombatEffectEvent[]` 是 v0 攻击专用结构，不足以可靠表达合成、升级和死亡。
- 02 需在共享包中提供结构等价的 `BattleEvent` 和 `MatchSnapshot.battleEvents`；迁移期可同时保留 `combatEvents`。
- 08 负责在 `BattleScene` 达成端口接线。本模块不直接修改 `BattleScene`，也不保留快照 diff 合成检测作为正式路径。

## 契约测试

`pnpm --filter @adou/client test:presentation` 覆盖事件去重、移动端/减少动效预算、16 个可玩身份的独立 profile，以及合成、升级、死亡的语义 cue。

## 未决问题

- 02 需确认 `BattleEvent` 是随快照发送还是独立序列，并提供断线重放窗口。
- 03/08 需确认 Phaser 的对象池实现和屏幕镜像转换端口。
