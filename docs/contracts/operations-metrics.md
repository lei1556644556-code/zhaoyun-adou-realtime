# 实时运维指标合同

## 目标

后台页面只读展示权威服务器的实时运行状态。它不得修改房间、玩家、战斗或账号数据，也不得把完整战斗快照复制到监控链路。

## 传输

- `GET /api/admin/metrics`：返回一次 `OperationsMetricsSnapshot`。
- `GET /api/admin/metrics/stream`：以 SSE `metrics` 事件每 2 秒推送同一结构。
- 两个接口都要求 `Authorization: Bearer <ADMIN_DASHBOARD_TOKEN>`。
- 生产环境未配置 `ADMIN_DASHBOARD_TOKEN` 时接口不可用；本地开发默认令牌为 `dev-admin`。

## 指标口径

| 指标 | 口径 |
| --- | --- |
| 在线人数 | 当前 Socket.IO 连接中去重后的 `userId` 数；游客连接以 socket 身份隔离 |
| Socket 连接 | 当前已通过握手的 Socket.IO 连接数 |
| 场内在线 | 当前所有内存房间内 `socketId` 非空的席位数 |
| 房间总数 | 当前服务器内存中的房间数；从数据库恢复后会重新计入 |
| 等待 | 少于两名玩家且尚未开战 |
| 准备 | 已有两名玩家、尚未生成战斗快照 |
| 对战中 | 已有快照且阶段不是 `finished` |
| 已结束 | 快照阶段为 `finished` |
| 每分钟指令 | 最近 60 秒收到的 `match:command` 数，按实际覆盖秒数归一化 |
| 指令拒绝率 | 最近 60 秒拒绝指令数 / 收到指令数；无指令时为 0 |
| 估算下行流量 | 服务器序列化业务事件的 UTF-8 字节数 × 接收人数；不含 Socket.IO/WebSocket 头、TLS，也不是压缩后网卡字节 |
| 事件循环延迟 | 权威 10Hz Tick 实际触发相对预计触发时间的最近平滑延迟 |

## 隐私与安全

- 接口不返回账号 ID、访问令牌、恢复令牌、IP、数据库密钥或完整快照。
- 房间详情仅返回房号、玩家显示名、连接/准备状态、波次与时间信息。
- 管理令牌只保存在浏览器 `sessionStorage`，不会进入 URL、日志或构建产物。

## 共享类型

客户端和服务端共同消费 `packages/shared/src/operations.ts` 中的 `OperationsMetricsSnapshot`，不得各自复制一套字段定义。
