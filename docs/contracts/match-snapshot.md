# 权威快照合同（match-snapshot）

## 合同元数据

- 版本：1.0.0
- 提供方：02 权威战斗内核
- 消费方：03 战场交互、05 云存档、06 实时联机、07 自动化测试
- TypeScript 权威定义：`packages/shared/src/types.ts`

## 完整状态

`MatchSnapshot` 是一次对局可持久化、同步和恢复的完整权威状态。除表现层消费游标外，继续演算所需的全部内容必须包含在快照中：

- `snapshotVersion`：快照结构版本，当前为 `1`；
- `tick`、`stateVersion`、`simulationTimeMs`：确定性逻辑时钟与单调状态版本；
- `seed`、地图、难度曲线和 Boss 波次计划；
- 双方生命、经济、波次、单位占格、营地占格、敌军、道具及计时器；
- `eventSequence` 与当前转换产生的 `events`；
- `acceptedCommands` 与 `lastClientSeq`，用于恢复后的命令幂等；
- 胜者与阶段。

`serverTime` 作为 0.x 字段继续保留，语义收口为从对局创建开始累计的逻辑毫秒数，与 `simulationTimeMs` 同步。它不再读取墙钟；展示真实时间应由传输层另附元数据。

单位占格规则：普通单位只有 `cell`；两字武将必须同时提供互不相同且四向相邻的 `cell`、`secondaryCell`，两格都必须位于己方已开放区域。营地的 `slot` / `secondarySlot` 同理，范围为 `0..reserveSize-1` 且必须相邻。任意两个单位或营地项不得共享占格。

## 确定性约束

在相同结构版本、规则配置、初始 `roomId` / `seed` / `mapIndex`、命令序列及步进时长序列下，快照和事件必须深度相等。内核不得读取 Phaser、DOM、Supabase、WebSocket、墙钟或系统随机数。

`createMatch` 的初始逻辑时间固定为 `0`。外层如需随机种子，必须先生成数值并显式传入；该随机源不属于内核。

`stepMatch` 只接受有限且大于 0 的毫秒值。正式对局按 `GAME_CONFIG.tickHz` 使用固定步长；暂停、补帧和断线恢复必须重放相同的固定步序列，不能把多个 Tick 合并成一个超大步长。

## 生命周期

1. `createMatch` 生成 `snapshotVersion: 1` 的完整快照。
2. 每次成功命令或有效模拟步使 `stateVersion` 恰好增加 1。
3. `tick` 只在模拟步增加；玩家命令不增加 Tick。
4. `simulationTimeMs` / `serverTime` 只在模拟步累加。
5. `cloneSnapshot` 生成没有共享可变引用的等价副本。
6. 旧存档进入演算入口时补齐 1.0 新字段；这项兼容只补元数据，不猜测缺失的规则状态。

## 兼容策略

- 增加可安全推导的字段可提升 `snapshotVersion` 次版本；删除字段或改变规则语义需提升主版本并提供迁移器。
- 0.x 存档缺少事件、命令幂等和逻辑时间字段时，内核按空集合、序号 0 和原 `serverTime`（若为有限数）补齐。
- 消费者必须忽略不认识的附加字段；遇到高于自身支持范围的 `snapshotVersion` 时应拒绝继续权威演算。

## 契约样例

```ts
const a = createMatch("room", 123, 0);
const b = createMatch("room", 123, 0);
expect(a).toEqual(b);

stepMatch(a, 100);
stepMatch(b, 100);
expect(a).toEqual(b);
```

## 未决问题

- 01 规则模块仍需把敌军移动速度、武将技能倍率/阈值、农民周期和道具效果半径等结构化进规则配置；02 不再新增散落数值，已有实现待配置合同补齐后迁移。
- 05 模块需要按 `snapshotVersion` 做云存档迁移和不兼容版本提示。
