# 实时对战权威服务合同 v2

## 结论

正式联网不再让“创建房间的浏览器”兼任服务器。生产客户端使用 Socket.IO 连接 `apps/server`；旧 Supabase Realtime 房主权威实现仅保留给无 `VITE_SERVER_URL` 的本地兼容调试，生产构建禁止回退。

v2 的唯一正式方案是：`apps/server` 成为双方共同连接的唯一权威端，Supabase 只负责账号认证与持久化；GitHub Pages 只托管静态客户端。

## 版本与所有权

- 合同版本：`2.2.0`（新增权威局内 BUFF 命令、库存与事件）
- 提供方：06 实时联机
- 消费方：02 权威战斗内核、03 战场 UI、05 账号存档、07 验收、08 发布
- 协议/规则版本：握手必须同时校验 `protocolVersion=0.5.0`、`rulesetVersion=1.0.9`、规则配置结构版本和快照版本。

## 客户端端口

```ts
interface MatchTransport extends EventTarget {
  create(input: { name: string; accessToken: string }): Promise<JoinResult>;
  join(input: { roomId: string; name: string; accessToken: string }): Promise<JoinResult>;
  quick(input: { name: string; accessToken: string }): Promise<JoinResult>;
  resume(input: { roomId: string; resumeToken: string; accessToken: string }): Promise<JoinResult>;
  ready(): Promise<{ ok: boolean; ready?: boolean; started?: boolean }>;
  send(command: GameCommand): Promise<CommandResult>;
  close(): void;
}
```

客户端只发送 `GameCommand`。伤害、随机数、波次、馒头、生命和胜负只由服务端调用共享内核结算。人机模式实现同一个端口，但在本地运行。

## 服务端状态

每个房间必须持久化：

- 房间 ID、创建/过期时间、规则/协议/快照版本；
- 两个席位的用户 ID、显示名、不可逆哈希后的恢复令牌、在线时间；
- 两个席位各自的 `ready` 状态；未创建快照前断线会清除该席位准备状态；
- 最新完整 `MatchSnapshot`、递增快照序号；
- 已接受命令的 `commandId/clientSeq/result` 幂等账本；
- 权威进程租约和最后检查点时间。

建议使用 Supabase Postgres 表 `match_rooms`、`match_seats`、`match_commands`。服务端使用私有 service-role 凭证；该凭证绝不能进入 Pages 构建。每条成功命令立即事务落库；战斗中每 1 秒或关键事件（合成、掉血、结算）写检查点。服务重启后抢占过期租约并从最后快照续跑。

## 连接与在线状态

UI 必须分别展示三个状态，不能再把 WebSocket 订阅成功等同于对局健康：

1. `transportConnected`：本机到权威服务的 Socket 是否可用；
2. `authorityHealthy`：最近 6 秒是否收到权威心跳/快照；
3. `opponentConnected`：服务端最后一次确认对手席位在线。

心跳每 2 秒一次，6 秒进入“重连中”，12 秒判定离线。断线保留席位 120 秒；期间权威模拟继续，重连成功后发送最新快照和未播放事件。恢复失败不得自动删除本地恢复令牌或最近快照，只有玩家明确“退出本局”才清理。

等待房间不会因为第二个席位加入而自动开战。`room:status.players[]` 必须携带 `connected` 与 `ready`；仅当两个席位都在线且都已提交 `room:ready` 时，服务端才能创建首个 `MatchSnapshot`、广播 `match:start` 并进入原版 10 秒布阵准备期。

## 命令一致性

- 服务端验证 Supabase access token，并确认 token 的用户 ID 与房间席位一致。
- 新手生命系数使用服务端从账号存档读取的累计完成局数，禁止相信客户端自行上报；当前 P2P 兼容层只能交换本地记录的局数，属于过渡限制。
- `commandId` 全局幂等；重复同一命令返回第一次结果，复用 ID 提交不同内容返回冲突。
- `clientSeq` 每席位严格递增，拒绝倒序命令。
- 当前全局 `stateVersion` 会被 10Hz Tick 持续推进，不适合作为玩家拖放的乐观锁。v2 应新增“命令域版本”或目标对象版本；迁移前由权威端用当前全局版本执行，并保留 `commandId/clientSeq` 防重。
- 每条命令必须有 5 秒确认超时；超时只标成“未确认”，不得在客户端先行结算。

## 部署

1. `Dockerfile.server` 和 `render.yaml` 将 `apps/server` 部署到支持常驻 WebSocket 的 Node 环境；生产强制配置 HTTPS、精确 `CLIENT_ORIGIN` 和 Supabase 私有服务端凭证。
2. 客户端生产运行配置必填 `VITE_SERVER_URL=https://...`；生产构建禁止回退到 Pages 同源或浏览器房主模式。
3. `AuthoritativeRealtimeClient` 已接线 Socket.IO，生产路径不调用 `RealtimeClient` 房主权威实现。
4. Supabase `zhaoyun_adou_matches` 保存 24 小时检查点；恢复令牌只保存 SHA-256。
5. 常驻服务部署完成并通过双浏览器验收后，写入 GitHub `PRODUCTION_SERVER_URL` 再发布 Pages。

权威服务的监听合同为 `HOST` + `PORT`：直接部署在 Nginx 同机时默认 `127.0.0.1:3001`，仅由反向代理访问；容器平台需要跨网络命名空间接入时必须显式设置 `HOST=0.0.0.0`。Socket.IO 路径由 `SOCKET_PATH` 配置，Nginx 路由必须保持该路径和升级头，不得改写或占用其他应用的 WebSocket 路径。

## 发布闸门

以下全部通过才允许把真人对战标为正式可用：

- 建房、加房、随机匹配、双向拖放/合成、命令去重；
- 双方分别刷新后 120 秒内恢复同一快照；
- 房主浏览器关闭后客端仍由服务器继续推进，不再冻结；
- 服务端进程重启后房间从持久化检查点恢复；
- 断网 15 秒再恢复、重复发送、乱序发送、旧版本客户端均有确定结果；
- 手机与电脑混合对局至少连续完成 20 波；
- 生产监控包含在线房间数、Tick 延迟、命令拒绝率、快照延迟与恢复成功率。

## 当前兼容层已采取的止损

在 v2 上线前，Supabase P2P 兼容层执行房主 2 秒心跳、客端 6 秒健康超时、命令 5 秒确认超时；客端保存最近快照，恢复失败保留凭证。兼容层仍不能在房主离线时继续战斗，因此不得作为正式联网架构发布。
