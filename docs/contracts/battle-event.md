# 一次性战斗事件合同（battle-event）

## 合同元数据

- 版本：1.0.0
- 提供方：02 权威战斗内核
- 消费方：03 战场交互、04 美术表现、06 实时联机、07 自动化测试
- TypeScript 权威定义：`packages/shared/src/types.ts`

## 事件信封

`BattleEvent` 是可 JSON 序列化的判别联合。每项都包含：

```ts
interface BattleEventBase {
  id: string;
  type: BattleEventType;
  tick: number;
  stateVersion: number;
}
```

- `id`：对局内永不复用的稳定 ID，由快照持久化的 `eventSequence` 生成；
- `type`：稳定判别字段；消费者应按它选择表现；
- `tick`：事件发生的权威模拟 Tick；
- `stateVersion`：产生该事件的状态转换版本。

首版事件类型覆盖：征兵、单位上阵/移动/回营/交换、合成升级、武将拆分、开垦、营地移动、道具使用、攻击命中、敌军死亡、阿斗受击和对局结束。事件只描述已经由内核结算的事实，不接受客户端回写。

| `type` | 关键载荷 |
|---|---|
| `recruited` | 席位、新营地 ID、消耗与回收馒头 |
| `reserve-granted` | 席位、新营地 ID、补给来源 |
| `unit-deployed` / `unit-moved` / `unit-returned` | 单位 ID 与权威格号/槽位 |
| `units-swapped` | 互换后各对象的最终格号或槽位 |
| `units-merged` | 来源/目标 ID、结果兵种、等级、位置与棋盘/营地区域 |
| `general-split` | 原武将 ID 与拆分后两个文字的 ID、文字、格号 |
| `cell-unlocked` | 开垦格号与被消耗的铲子 ID |
| `reserve-moved` | 营地项 ID 与最终槽位 |
| `prop-used` / `prop-triggered` | 道具 ID、使用目标或触发后受影响对象 ID |
| `attack` | 攻击者、主目标、伤害、命中数、技能标记与目标进度 |
| `enemy-defeated` | 敌军 ID、Boss 标记与该敌军奖励 |
| `player-damaged` | 逃脱数量、剩余生命与补偿馒头 |
| `match-finished` | 胜方席位或 `draw` |

## 生命周期与一次性语义

- `MatchSnapshot.events` 只包含最近一次成功命令或模拟步产生的事件；下一次成功转换开始前清空。
- 同一转换可以产生多项事件，数组顺序就是权威发生顺序。
- 命令被拒绝时不得清空、追加或重排事件。
- 幂等重试返回原 `CommandResult`，不重新生成事件；快照仍保留最近一次成功转换的事件，因此传输层若重发该快照，消费者必须依赖事件 ID 去重，不能依赖数组下标或文案。
- 恢复存档后 `eventSequence` 延续，新的事件 ID 不与恢复前重复。

`combatEvents` 作为 0.x 攻击表现兼容视图暂时保留，只含 `type: "attack"` 的事件，并复用事件原始 ID。单次模拟转换时它与 `events` 一致；旧版实时房主若在一次发布前补算多个固定 Tick，则按 Tick 顺序暂存这批攻击事件并随最终快照一次发布，下一次补算前清空，避免漏播或重播。03/04/06 完成迁移后，旧字段在下一主版本删除。

## 事件载荷原则

- 占格事件携带权威格号数组；普通单位一格、武将两格。
- 合成事件同时携带来源、目标、结果兵种、等级和结果占格。
- 攻击事件携带攻击者、目标、伤害、命中数量和技能标记；表现层不得据此再次扣血。
- 敌军死亡按敌军逐项发出，包含是否 Boss 与该敌军产生的馒头奖励。
- 阿斗受击事件包含逃脱数量、剩余生命和本次补偿馒头。
- 胜负事件包含 `winner`；平局使用 `"draw"`。
- `lastEvent` 是兼容展示文案，不是事件流，不能用于业务判断或去重。

## 兼容策略

- 新事件类型可追加；既有类型字段的删除或语义变化需要提升合同主版本。
- 消费者遇到未知 `type` 时应忽略表现但保留快照，不得中止权威同步。
- 文案、本地化、音效、动画和资源键由 03/04 模块映射，不进入战斗内核。

## 契约样例

```ts
stepMatch(snapshot, 100);
for (const event of snapshot.events) {
  if (seenIds.has(event.id)) continue;
  seenIds.add(event.id);
  render(event);
}
```

## 未决集成项

- 03/04 模块把当前 `combatEvents` 播放器迁移为统一 `events` 消费器，并持久化最近已播放事件 ID。
- 06 模块只广播快照中的权威事件，不合成第二套网络事件。
