# 账号、经济与存档合同

- 合同版本：`1.0.0`
- 提供方：05 账号经济与云存档
- 消费方：03 战场交互、06 实时联机、07 质量验收、08 集成发布
- 实现入口：`apps/client/src/auth/index.ts`、`apps/client/src/economy/index.ts`

## 边界

Supabase Auth 是正式账号的唯一认证方。用户输入自设账号与密码；客户端只把密码传给 `signUp` / `signIn`，密码不得写入业务表、游戏存档、日志或本地开发存储。账号名经过 NFKC、去首尾空格和小写归一化，再确定性映射为 Auth 内部邮箱；该邮箱不是玩家资料，也不支持邮件找回。

`AccountStore` 只负责身份生命周期，`ProgressStore` 只负责按身份加载和保存版本化进度，`EconomyService` 只执行可测试的经济状态转换。消费者不得把密码放进这三类对象，也不得绕过 `ProgressStore` 直接更新 `zhaoyun_adou_profiles.progress`。

## AccountStore

```ts
interface AccountStore {
  readonly mode: "cloud" | "local-development";
  restore(): Promise<AccountIdentity | null>;
  signUp(credentials: { username: string; password: string }): Promise<AccountIdentity>;
  signIn(credentials: { username: string; password: string }): Promise<AccountIdentity>;
  signOut(): Promise<void>;
}

interface AccountIdentity {
  userId: string;
  username: string;
  createdAt: string;
  assurance: "supabase" | "local-development";
}
```

正式模式必须使用 `SupabaseAccountStore`。恢复会话时先让 Supabase 刷新本地 token，再以 `getUser` 向 Auth 服务验证用户；不能把未经服务端验证的本地 session 当作授权事实。业务数据仍由 RLS 与 RPC 再次约束。

本地开发模式使用 `LocalDevelopmentAccountStore.enterLocalDevelopment(username)`。它不接受密码、不执行认证，身份的 `assurance` 固定为 `local-development`。03/08 集成时必须把状态显示为“本地开发模式 · 未认证 · 仅此设备”，不得显示“云端已连接”“登录成功”等字样。`signUp` 与 `signIn` 在此模式固定返回 `AUTH_UNAVAILABLE`，防止把设备内身份冒充正式账号。

## ProgressStore

```ts
interface ProgressStore<T = CloudProgress> {
  readonly mode: "cloud" | "local-development";
  load(accountId: string): Promise<ProgressRecord<T> | null>;
  save(accountId: string, progress: T, expectedRevision: number): Promise<ProgressRecord<T>>;
}

interface ProgressRecord<T> {
  accountId: string;
  revision: number;
  updatedAt: string;
  durability: "cloud" | "device-only";
  progress: T;
}
```

云端保存调用 `zhaoyun_adou_save_progress(accountId, expectedRevision, progress)`；数据库核对 `auth.uid()`、文档版本、1 MiB 大小上限和当前 revision，在同一条 `UPDATE` 中递增 revision。SQLSTATE `40001` 映射为 `PROGRESS_CONFLICT`，消费者必须重新加载并显式决定合并/覆盖，不允许把旧页面静默写到新存档上。

本地开发存档使用独立前缀并按 `accountId` 分区，也执行相同的 revision 比较。返回的 durability 固定为 `device-only`。正式 Supabase token 由 Supabase SDK 自己的会话存储管理，不属于游戏存档；游戏代码不得读写或复制 token。

`CloudProgress.version = 1` 暂时兼容现有快照。`MatchSnapshot` 的结构仍由 `match-snapshot` 合同负责；本模块只持久化，不解释或修改战斗判定。

## EconomyService

`EconomyService` 接收 `EconomyRules` 和可注入随机源。`EconomyRules.props` 必须直接来自规则模块导出的 `PROPS`；售价、`ja` / `Ha`、升级价格和可升级等级均从该目录读取，不在 UI、存档或经济服务内复制。胜负奖励、体力上限、商店数量、原广告概率等尚未统一导出的局外规则，也必须由规则模块/集成入口注入，不得由消费者自行补默认值。

稳定操作：

```ts
normalize(raw, at?)
beginResult(economy, matchKey, won)
claimResult(economy, "normal" | "direct-original-ad")
claimShopOffer(economy, offerIndex)
drawLottery(economy)
finishPostgame(economy)
```

所有操作返回新状态，不原地修改调用方对象。`matchKey` 与 `completedMatchKeys` 保证一局只进入一次奖励流程。原作广告路径仅替换为直接领取：双倍结算每局只能选一次；广告商品每个 offer 只能领一次；战后转盘每次商店只能抽一次。情景、候选池和次数限制保留。行军丹等无法从展示文案判断的运行效果通过 `outsideBattleEffects` 注入，当前证据要求由规则提供方配置实际 `stamina + 1`，不能从“体力+10”文案推导。

每日切换以注入时区（发布配置为 `Asia/Shanghai`）判断：金币与体力保留；当日胜负、当日道具、已处理对局和未完成战后流程清空。

## 数据库与 RLS

按顺序应用：

1. `supabase/migrations/20260902133000_player_accounts.sql`
2. `supabase/migrations/20260903120000_account_progress_v2.sql`

第二份迁移新增 `progress_revision`、更新时间触发器、进度类型/大小约束和 CAS RPC；强制 RLS；匿名角色无权限；authenticated 只能读取自己的完整行、插入自己的身份列，不能直接更新/删除表。插入 policy 还会用 `pgcrypto` 核对归一化用户名与 Auth 内部邮箱，避免登录用户抢占别的 profile 用户名。`SELECT` / `UPDATE` policy 与受约束的 `INSERT` policy 作为纵深防御，实际进度写入只授权给 RPC。

手工回滚脚本位于 `supabase/rollback/20260903120000_account_progress_v2.down.sql`。执行前必须备份 profile 表；回滚会丢弃 revision 历史并恢复旧版直接更新权限。两个 `NOT VALID` 约束会立即保护新写入，但升级后应先审计遗留行，再由运维执行：

```sql
alter table public.zhaoyun_adou_profiles
  validate constraint zhaoyun_adou_profiles_progress_object;
alter table public.zhaoyun_adou_profiles
  validate constraint zhaoyun_adou_profiles_progress_size;
alter table public.zhaoyun_adou_profiles
  validate constraint zhaoyun_adou_profiles_progress_version;
```

## 配置与模式选择

正式云端需要同时提供：

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

两项都没有时，工厂返回明确的本地开发服务；只配置一项、使用示例占位值或非本地 HTTP 地址时返回 `AUTH_CONFIGURATION`，不回退到貌似成功的云端。用户名登录使用不可投递的内部邮箱，因此 Supabase Email provider 必须开启且关闭 Confirm email；否则注册后不会获得 session，客户端会返回 `AUTH_CONFIGURATION`。

## 错误语义

| 错误码 | 含义 | 消费方处理 |
|---|---|---|
| `AUTH_UNAVAILABLE` | 本地开发模式被误当成密码登录，或认证服务不可用 | 显示模式说明，不宣称登录成功 |
| `AUTH_CONFIGURATION` | 环境变量或 Supabase Auth 设置不完整 | 阻止正式登录，提示运维配置 |
| `AUTH_INVALID_CREDENTIALS` | 账号或密码不正确 / session 失效 | 清空密码框，允许重试 |
| `AUTH_USERNAME_TAKEN` | 归一化账号已注册 | 引导登录或换名 |
| `PROFILE_MIGRATION_REQUIRED` | 表、列或 RPC 未部署 | 阻止云存档写入，提示执行迁移 |
| `PROGRESS_CONFLICT` | revision 已被另一页面/设备推进 | 重新加载，禁止静默覆盖 |
| `PROGRESS_INVALID` | revision 或文档不符合合同 | 拒绝写入并保留上一版 |

## 兼容与集成

`SupabaseService` 暂时保留为现有 `main.ts` 的兼容门面，并导出旧类型名；它已经改用新的 AccountStore/ProgressStore 及 revision RPC。08 模块应把组合入口改为直接依赖三个公开端口，并根据 `PersistenceServices.statusLabel` 展示真实持久化模式。移除兼容门面属于后续大版本，不在本合同内。

本模块没有修改 UI 布局、战斗命令、战斗判定或实时房间协议。06 模块若要为线上奖励提供抗作弊证明，应另行扩展服务端签名的 `matchKey/outcome` 合同；当前 RLS 能保证账号隔离和原子幂等，但不能阻止已登录玩家篡改自己浏览器后提交虚假战果。

## 契约样例

- 两个本地开发 accountId 写入相同键名时，读取结果必须互不相见。
- revision 0 首次保存返回 1；再次以 expectedRevision 0 保存必须得到 `PROGRESS_CONFLICT`。
- 同一 matchKey 首次 `beginResult` 创建待领取结果；完成领取后再次调用不得增加金币。
- 原广告商品直接领取后 `claimed = true`；再次领取必须得到 `ALREADY_CLAIMED`。
- 转盘 `lotteryUsed = true` 后再次抽取必须得到 `ALREADY_CLAIMED`。

## 未决问题

- 规则模块尚未把局外奖励、每日体力上限、广告商品概率、商店/转盘数量导出为统一配置；当前由 `EconomyRules` 强制注入，禁止隐藏默认值。01 模块应补齐可追溯配置后再由 08 接线。
- 线上对局奖励缺少服务端签名凭据；在 06 提供权威战果证明前，玩家只能被 RLS 限制在自己的账号行内，不能达到经济防作弊。
- 合成 `main.ts` 的明确本地模式入口及 GitHub Pages 环境变量属于 08 模块；未配置云端时，现有兼容登录表单会明确拒绝密码登录，不会冒充云端成功。
