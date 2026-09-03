# 战斗命令合同（battle-command）

## 合同元数据

- 版本：1.0.0
- 提供方：02 权威战斗内核
- 消费方：03 战场交互、06 实时联机、07 自动化测试
- TypeScript 权威定义：`packages/shared/src/types.ts`

## 数据结构与入口

`GameCommand` 是玩家能提交的全部对局意图。它必须是可 JSON 序列化的判别联合；客户端不得提交伤害、奖励、生命、胜负或任意快照补丁。

```ts
interface CommandEnvelope {
  commandId: string;
  clientSeq: number;
  expectedStateVersion: number;
  command: GameCommand;
}

function executeCommand(
  snapshot: MatchSnapshot,
  slot: PlayerSlot,
  envelope: CommandEnvelope,
): CommandResult;
```

- `commandId`：一次玩家意图的非空稳定 ID；网络重试必须复用同一个 ID。
- `clientSeq`：该席位从 1 开始严格递增的整数序号。
- `expectedStateVersion`：客户端生成命令时看到的权威状态版本；不得大于当前版本。由于战斗 Tick 会持续推进版本，落后的版本本身不构成拒绝理由，命令目标仍按处理时的当前权威状态重新校验。
- `command`：`GameCommand` 判别联合中的一个成员。

`CommandResult` 是判别联合。成功结果包含 `ok: true`、`duplicate` 和应用命令后的 `stateVersion`；失败结果还包含稳定的 `code` 与可展示的 `message`。所有结果回显 `commandId`。

## GameCommand 判别成员

| `type` | 必需载荷 | 权威语义 |
|---|---|---|
| `RECRUIT` | — | 校验并扣除本次征兵成本，回收旧营地，再按规则配置抽取五枚 |
| `SET_PROP_LOADOUT` | `loadout` | 仅准备阶段装配一次；主动最多 2、被动最多 6，均不允许重复 |
| `USE_PROP` | `propId` 与该道具所需目标 | 按装配、冷却、归属、目标类型和规则配置结算 |
| `CLAIM_SHOVEL_SUPPLY` | — | 满足原版局内补给条件时，每局领取一次 |
| `DROP_RESERVE` | `reserveId`, `targetCell` | 营地到棋盘；目标已有单位时执行合成或互换，铲子只开垦合法草格 |
| `DROP_RESERVE_TO_SLOT` | `reserveId`, `targetSlot` | 营地内移动、合成或互换 |
| `DROP_UNIT` | `unitId`, `targetCell` | 棋盘内移动、合成或互换 |
| `DROP_UNIT_TO_RESERVE` | `unitId`, `targetSlot` | 棋盘回营、合成或互换；两格武将须先拆分 |
| `SPLIT_GENERAL` | `unitId`, `partIndex`, `targetCell` | 把两格武将拆回两个姓名字，拖出的字落到空白开放格 |
| `MOVE` | `unitId`, `targetCell` | `DROP_UNIT` 的 0.x 兼容别名 |
| `MERGE` | `sourceId`, `targetId` | 以单位 ID 显式发起棋盘合成，判定与拖放合成相同 |

所有格号、营地槽位、序号和版本必须是安全整数；ID 必须为非空字符串。传输层收到的 JSON 即使在 TypeScript 中被断言成某类型，仍要经过内核运行时校验。

## 生命周期和幂等语义

1. 内核先按 `commandId` 查找快照内的已接受命令。完全相同的重试不再次执行，返回原结果并置 `duplicate: true`。
2. 同一 `commandId` 若被另一席位、序号或命令内容复用，以 `ERR_COMMAND_ID_CONFLICT` 拒绝。
3. 新命令的 `expectedStateVersion` 大于当前版本时，以 `ERR_STATE_VERSION` 拒绝；正常网络延迟产生的旧版本继续进入当前状态校验。
4. `clientSeq` 不大于该席位最后接受的序号时，以 `ERR_CLIENT_SEQUENCE` 拒绝。
5. 业务校验在隔离副本上完成。被拒绝的命令不得改变棋子、营地、经济、随机序列、事件或状态版本。
6. 成功命令只增加一次 `stateVersion`，并把幂等记录写入 `MatchSnapshot`，因此存档和断线恢复后仍不会重复结算。

`applyCommand(snapshot, slot, command)` 仅是 0.x 本地调用兼容入口，不提供网络幂等与乐观并发保证。06 模块应迁移到 `executeCommand`；移除兼容入口须另开主版本。

## 稳定错误码

| code | 语义 |
|---|---|
| `ERR_INVALID_ENVELOPE` | ID、序号或预期版本格式非法 |
| `ERR_COMMAND_ID_CONFLICT` | 同一 ID 被用于不同意图 |
| `ERR_STATE_VERSION` | 命令引用服务端尚不存在的未来/分叉版本 |
| `ERR_CLIENT_SEQUENCE` | 席位序号重复或倒退 |
| `ERR_MATCH_ENDED` | 对局已结束 |
| `ERR_NOT_ENOUGH_BUN` | 馒头不足 |
| `ERR_INVALID_COMMAND` | 目标、占格、阶段、道具或合成条件不成立 |

错误 `message` 可调整文案，消费者不得据此编写业务分支。

## 兼容策略

- `GameCommand` 只允许追加新的 `type`；修改或删除既有成员需要提升合同主版本。
- 可选字段只能追加，既有字段不得改变含义。
- 06 模块迁移期间可继续调用 `applyCommand`，但线上服务端完成幂等迁移后才能声明本合同接线完成。

## 契约样例

```ts
const envelope = {
  commandId: "p0-42",
  clientSeq: 42,
  expectedStateVersion: snapshot.stateVersion,
  command: { type: "MOVE", unitId: "u-1", targetCell: 58 },
} satisfies CommandEnvelope;

const first = executeCommand(snapshot, 0, envelope);
const retry = executeCommand(snapshot, 0, envelope);
// first.ok === true; retry.ok === true; retry.duplicate === true
// 棋子只移动一次，snapshot.stateVersion 只增加一次。
```

## 未决集成项

- 06 模块需要删除房间进程内的临时去重集合，改由快照内核统一裁决，并把稳定错误码透传给客户端。
- 03 模块需要在未来版本冲突后等待新快照，并以新 `commandId` 重建仍然有效的玩家意图；不得静默重放旧目标。断线重连还需持久化 `clientSeq`，避免序号倒退。
