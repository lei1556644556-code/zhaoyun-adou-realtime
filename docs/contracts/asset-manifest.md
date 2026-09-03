# AssetManifest v1.0.0

## 责任与范围

- 提供方：04 美术资源与战斗表现。
- 消费方：03 战场交互 UI、08 集成发布。
- 代码实现：`apps/client/src/presentation/assets/manifest.ts`。
- 本合同只定义稳定资源键、加载阶段与回退，不携带攻击、等级上限、稀有度概率或其他规则数值。

## 数据结构

```ts
interface AssetManifest {
  version: "1.0.0";
  assets: Record<AssetKey, AssetEntry>;
}

interface AssetEntry {
  key: AssetKey;
  category: "background" | "tile" | "ui" | "troop" | "hero" | "enemy" | "key-art" | "effect" | "audio";
  scope: "boot" | "lobby" | "battle" | "lazy";
  iconModeOnly?: boolean;
  source:
    | { kind: "raster"; path: string; width: number; height: number; bytes: number; alpha: boolean }
    | { kind: "planned"; preferredFormat: "webp-atlas" | "ogg"; fallback: string };
  purpose: string;
}
```

`key` 是唯一稳定标识。`path`、压缩参数、图集分页和文件名可在不变更 key 的情况下替换。图片模式按 `battle + iconModeOnly` 加载头像；文字模式必须跳过 `iconModeOnly` 条目。

## 生命周期

1. `boot` 仅加载首屏通用小图标。
2. `lobby` 进入大厅时加载，离开大厅可保留浏览器缓存。
3. `battle` 在对局准备期加载；文字模式不加载兵种/武将头像。
4. `lazy` 只在展示大图鉴赏或宣传页时加载。
5. `planned` 条目不触发网络请求，渲染器必须使用 `fallback`。

## 错误语义与回退

- 未知 key：记一次可采样诊断，该 cue 使用程序化几何或文字，不阻断对局。
- 图片失败：棋子回退到完整文字 ID；地形回退到纯色和边界线；特效回退到简化几何。
- 音频失败：静音继续，不重试当前事件。
- 尺寸不符：以 manifest 画布尺寸进行校验，进入发布前阻断资源检查，不影响规则层。

## 兼容策略

- v1 保留当前 `apps/client/src/game/assets.ts` 使用的 34 个运行时 key，另为两张大图添加 `key-art-*` 键。
- 新资源只能新增 key；改名或删除必须升级 manifest 主版本并由 08 提供迁移。
- 规则层和服务端不得导入 AssetManifest。

## 契约测试

`pnpm --filter @adou/client test:presentation` 校验 key 唯一、36 个 raster 文件存在、总体积与文字/图片两种加载路径。测试位于表现模块自己的 `src/presentation/__tests__/`，不侵入 UI 和战斗内核目录。

## 未决问题

- 特效图集和 OGG 音效尚未产出，当前使用 manifest 中声明的程序化/静音回退。
- 大厅背景尚高于首屏移动端预算，需美术二次压缩或生成小屏变体。
