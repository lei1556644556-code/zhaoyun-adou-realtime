import "./styles.css";
import {
  GAME_CONFIG, GENERALS, HERO_PAIRS, LEVEL_ATTACK, LEVEL_SPEED, MAP_LAYOUTS, SOLDIERS,
  type GameCommand, type MatchSnapshot, type PlayerSlot,
} from "@adou/shared";
import { IMAGE_ASSETS } from "./game/assets";
import { createGame } from "./game/BattleScene";
import { PracticeEngine } from "./game/PracticeEngine";
import { RealtimeClient } from "./net/RealtimeClient";
import { SupabaseService, type CloudProgress, type PlayerProfile } from "./auth/SupabaseService";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <main class="site-shell">
    <section class="auth-screen" id="auth-screen">
      <div class="auth-art" aria-hidden="true"><img src="assets/backgrounds/lobby-zhaoyun-adou.webp" alt="" /></div>
      <div class="auth-panel">
        <p class="eyebrow">云端战令 · 跨设备续战</p>
        <h1>赵云与阿斗</h1>
        <p class="auth-lead">创建你的战场账号。密码由 Supabase Auth 加密保管，游戏进度只对当前账号开放。</p>
        <div class="auth-tabs" role="tablist" aria-label="账号操作">
          <button class="is-active" id="auth-login-tab" type="button" role="tab" aria-selected="true">登录</button>
          <button id="auth-register-tab" type="button" role="tab" aria-selected="false">创建账号</button>
        </div>
        <form class="auth-form" id="auth-form">
          <label class="field-label" for="auth-username">账号</label>
          <input class="text-input" id="auth-username" minlength="2" maxlength="16" autocomplete="username" placeholder="2–16位中英文、数字或下划线" required />
          <label class="field-label" for="auth-password">密码</label>
          <input class="text-input" id="auth-password" type="password" minlength="6" maxlength="72" autocomplete="current-password" placeholder="至少6位" required />
          <label class="field-label auth-confirm-row" for="auth-confirm" hidden>确认密码</label>
          <input class="text-input auth-confirm-row" id="auth-confirm" type="password" minlength="6" maxlength="72" autocomplete="new-password" placeholder="再次输入密码" hidden />
          <button class="btn btn-primary auth-submit" id="auth-submit" type="submit">进入战场</button>
        </form>
        <p class="auth-message" id="auth-message" aria-live="polite">首次游玩请先创建账号；以后可在电脑或手机继续进度。</p>
      </div>
    </section>

    <section class="lobby" id="lobby" hidden>
      <div class="lobby-art" aria-hidden="true"><img src="assets/backgrounds/lobby-zhaoyun-adou.webp" alt="" /></div>
      <div class="lobby-copy">
        <p class="eyebrow">1.0.9 规则复刻 · 新增实时对战</p>
        <h1><span>合字成将 · 护住阿斗</span>赵云与阿斗</h1>
        <div class="account-strip"><div><span>当前战令</span><strong id="player-name">未登录</strong></div><i id="cloud-status">云端同步中</i><button id="logout" type="button">退出账号</button></div>
        <div class="primary-actions">
          <button class="btn btn-primary" id="practice">人机对战</button>
          <button class="btn btn-accent" id="quick">随机匹配</button>
        </div>
        <div class="room-actions">
          <button class="btn btn-quiet" id="create-room">创建房间</button>
          <div class="join-row">
            <input class="text-input room-code-input" id="room-code" maxlength="6" placeholder="输入6位房号" aria-label="房间号" />
            <button class="btn btn-quiet" id="join-room">加入</button>
          </div>
        </div>
        <p class="lobby-note" id="lobby-note">创建房间后把6位房号发给好友，也可以直接随机匹配。</p>
      </div>
    </section>

    <section class="battle-shell" id="battle-shell" hidden>
      <header class="battle-toolbar">
        <div><b id="mode-label">人机对战</b><span id="network-label">本地权威演算</span></div>
        <div class="toolbar-room" id="room-banner" hidden><span>房号</span><strong id="room-id">------</strong><button id="copy-room">复制邀请</button></div>
        <span class="network-pill" id="network-pill"><i></i><b>已就绪</b></span>
        <button class="piece-mode-toggle" id="piece-mode-toggle" type="button" aria-pressed="false" title="切换棋子显示方式">形象版</button>
        <div class="zoom-controls" aria-label="战场缩放">
          <button id="zoom-out" type="button" aria-label="缩小战场" title="缩小战场">−</button>
          <button id="zoom-fit" type="button" aria-label="适应窗口" title="恢复为整屏显示">适屏 <span id="zoom-value">100%</span></button>
          <button id="zoom-in" type="button" aria-label="放大战场" title="放大战场">＋</button>
        </div>
        <button class="exit-match" id="exit-match">退出本局</button>
      </header>
      <div class="battle-layout">
        <section class="playfield-card" aria-label="赵云与阿斗战场"><div id="game" class="game-frame"></div></section>
        <aside class="tactics-panel">
          <p class="eyebrow">战局状态</p>
          <h2 id="map-title">巨鹿</h2>
          <dl class="battle-data">
            <div><dt>当前波次</dt><dd id="wave">准备</dd></div>
            <div><dt>我方馒头</dt><dd id="my-buns">20</dd></div>
          </dl>
          <div class="event-box"><span>当前事件</span><strong id="last-event">等待开局</strong></div>
          <div class="opponent-box"><span>对手</span><strong id="opponent-name">演武军士</strong><small id="opponent-status">等待布阵</small></div>
          <div class="howto">
            <b>操作方法</b>
            <ol>
              <li>点击“征兵”一次获得五枚棋子。</li>
              <li>拖到棋子上：能合成就合成，不能合成就直接交换位置。</li>
              <li>轻点棋子（不拖动）可查看实际攻击、攻速、射程与技能。</li>
              <li>姓名两字合将后占两格；上阵后拖出任一字即可拆分。</li>
              <li>铲子拖到高亮草格可扩一格。</li>
              <li>棕色只走敌兵，白色才可布阵，绿色草地不可通行或放置。</li>
            </ol>
          </div>
        </aside>
      </div>
      <section class="unit-inspector" id="unit-inspector" aria-labelledby="unit-inspector-name" hidden>
        <button class="unit-inspector-close" id="unit-inspector-close" type="button" aria-label="关闭属性">×</button>
        <div class="unit-inspector-head">
          <div class="unit-inspector-portrait">
            <img id="unit-inspector-art" alt="" />
            <span id="unit-inspector-glyph" aria-hidden="true">兵</span>
          </div>
          <div>
            <span class="unit-inspector-rarity" id="unit-inspector-rarity">兵种</span>
            <h2 id="unit-inspector-name">刀兵</h2>
            <p id="unit-inspector-level">Lv.1 / 5</p>
          </div>
        </div>
        <dl class="unit-inspector-stats">
          <div><dt>攻击</dt><dd id="unit-inspector-attack">—</dd></div>
          <div><dt>攻速</dt><dd id="unit-inspector-speed">—</dd></div>
          <div><dt>射程</dt><dd id="unit-inspector-range">—</dd></div>
          <div><dt>方式</dt><dd id="unit-inspector-form">—</dd></div>
        </dl>
        <p class="unit-inspector-skill" id="unit-inspector-skill">点击棋子查看详细属性。</p>
      </section>
    </section>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </main>`;

const lobby = get<HTMLElement>("lobby");
const authScreen = get<HTMLElement>("auth-screen");
const battleShell = get<HTMLElement>("battle-shell");
const lobbyNote = get<HTMLElement>("lobby-note");
const game = createGame("game");
const cloud = new SupabaseService();
let snapshot: MatchSnapshot | null = null;
let slot: PlayerSlot = 0;
let practice: PracticeEngine | null = null;
let online: RealtimeClient | null = null;
let commandSink: ((command: GameCommand) => void) | null = null;
let toastTimer = 0;
let roomPlayers: Array<{ slot: PlayerSlot; name: string }> = [];
let activeMode: "practice" | "online" | null = null;
let lastPracticeSaveAt = 0;
let battlefieldZoom = readStoredZoom();
let pieceDisplayMode: "text" | "image" = localStorage.getItem("adou-piece-display-mode-v1") === "text" ? "text" : "image";
let currentProfile: PlayerProfile | null = null;
let authMode: "login" | "register" = "login";
let cloudSaveTimer = 0;
let cloudSaveInFlight: Promise<void> | null = null;

const ACTIVE_MODE_KEY = "adou-active-mode-v1";
const PRACTICE_SAVE_KEY = "adou-practice-save-v1";
const ONLINE_SESSION_KEY = "adou-session";
const BATTLEFIELD_ZOOM_KEY = "adou-battlefield-zoom-v1";
const PIECE_DISPLAY_MODE_KEY = "adou-piece-display-mode-v1";

function get<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function unitArtPath(kind: string) {
  if (kind in IMAGE_ASSETS.troops) return IMAGE_ASSETS.troops[kind as keyof typeof IMAGE_ASSETS.troops].path;
  if (kind in IMAGE_ASSETS.heroes) return IMAGE_ASSETS.heroes[kind as keyof typeof IMAGE_ASSETS.heroes].path;
  if (kind === "铲子") return IMAGE_ASSETS.ui.shovel.path;
  return null;
}

function showUnitInspector(kind: string, level: number) {
  const panel = get<HTMLElement>("unit-inspector");
  const hero = GENERALS[kind];
  const soldier = SOLDIERS[kind as keyof typeof SOLDIERS];
  const base = hero ?? soldier;
  const normalizedLevel = base ? Math.max(1, Math.min(level, base.maxLevel)) : Math.max(1, level);
  const levelIndex = normalizedLevel - 1;
  const attack = base ? base.attack * (LEVEL_ATTACK[levelIndex] ?? 1) : null;
  const interval = base ? base.intervalMs / (LEVEL_SPEED[levelIndex] ?? 1) : null;
  const artPath = unitArtPath(kind);
  const art = get<HTMLImageElement>("unit-inspector-art");
  art.hidden = !artPath;
  if (artPath) art.src = artPath;
  get("unit-inspector-glyph").hidden = Boolean(artPath);
  get("unit-inspector-glyph").textContent = kind === "铲子" ? "铲" : kind;
  get("unit-inspector-name").textContent = hero ? kind : soldier ? `${kind}兵` : kind === "铲子" ? "铲子" : `姓名字棋 · ${kind}`;
  const rarity = hero ? (hero.rarity === "gold" ? "金色武将" : "紫色武将") : soldier ? "基础兵种" : kind === "铲子" ? "开垦道具" : "武将姓名字";
  const rarityElement = get("unit-inspector-rarity");
  rarityElement.textContent = rarity;
  rarityElement.dataset.rarity = hero?.rarity ?? "base";
  get("unit-inspector-level").textContent = base ? `Lv.${normalizedLevel} / ${base.maxLevel}` : "不可独立攻击";
  get("unit-inspector-attack").textContent = attack === null ? "—" : String(Math.round(attack * 100) / 100);
  get("unit-inspector-speed").textContent = interval === null ? "—" : `${(interval / 1000).toFixed(2)}秒/次`;
  get("unit-inspector-range").textContent = base ? `${base.range}格` : "—";
  get("unit-inspector-form").textContent = hero ? hero.weapon : soldier?.form ?? (kind === "铲子" ? "开垦草格" : "合字成将");
  if (hero) {
    get("unit-inspector-skill").textContent = `武器：${hero.weapon}。技能：${hero.skill}`;
  } else if (soldier) {
    const extra = kind === "枪" ? "贯穿命中第二名敌人，造成本次攻击50%的额外伤害。" : kind === "骑" ? "命中时对邻近敌人造成50%范围伤害。" : "";
    get("unit-inspector-skill").textContent = `优先攻击：${soldier.target}。${extra}`;
  } else if (kind === "铲子") {
    get("unit-inspector-skill").textContent = "拖到己方白格旁的绿色草格，可将该格永久开垦为布阵格。";
  } else {
    const matches = [...new Set(Object.entries(HERO_PAIRS)
      .filter(([pair]) => pair.split("+").includes(kind))
      .map(([, general]) => general))];
    get("unit-inspector-skill").textContent = matches.length ? `可参与合成：${matches.join("、")}。合成后武将占用相邻两格。` : "姓名字棋不能独立攻击，需要与对应姓名字合成武将。";
  }
  panel.hidden = false;
}

function hideUnitInspector() {
  get<HTMLElement>("unit-inspector").hidden = true;
}

function applyPieceDisplayMode() {
  const textMode = pieceDisplayMode === "text";
  const button = get<HTMLButtonElement>("piece-mode-toggle");
  button.textContent = textMode ? "字棋版" : "形象版";
  button.setAttribute("aria-pressed", String(textMode));
  button.title = textMode ? "当前为原版字棋显示，点击切换形象版" : "当前为形象显示，点击切换原版字棋版";
  game.events.emit("battle:piece-mode", pieceDisplayMode);
}
function playerName() { return currentProfile?.username ?? "常山侠客"; }
function scopedStorageKey(base: string) { return `${base}:${currentProfile?.userId ?? "guest"}`; }

function readStoredZoom() {
  const value = Number(localStorage.getItem("adou-battlefield-zoom-v1"));
  return Number.isFinite(value) && value >= 0.6 && value <= 2 ? value : 1;
}

function battlefieldDimensions() {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const siteShell = document.querySelector<HTMLElement>(".site-shell");
  const toolbar = document.querySelector<HTMLElement>(".battle-toolbar");
  const styles = siteShell ? getComputedStyle(siteShell) : null;
  const horizontalPadding = styles ? parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight) : 0;
  const verticalPadding = styles ? parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) : 0;
  const singleColumn = viewportWidth <= 880;
  const shellWidth = Math.min(1080, viewportWidth - horizontalPadding);
  const maxWidth = Math.max(180, Math.min(640, singleColumn ? shellWidth : shellWidth - 340 - 16));
  const availableHeight = Math.max(390, viewportHeight - verticalPadding - (toolbar?.offsetHeight ?? 52) - 10);
  const fitWidth = Math.min(maxWidth, availableHeight * GAME_CONFIG.designWidth / GAME_CONFIG.designHeight);
  return { fitWidth, maxWidth };
}

function applyBattlefieldScale() {
  if (battleShell.hidden) return;
  const { fitWidth, maxWidth } = battlefieldDimensions();
  const width = Math.min(maxWidth, fitWidth * battlefieldZoom);
  battleShell.style.setProperty("--game-width", `${Math.floor(width)}px`);
  get("zoom-value").textContent = `${Math.round(width / GAME_CONFIG.designWidth * 100)}%`;
  get<HTMLButtonElement>("zoom-out").disabled = battlefieldZoom <= 0.6;
  get<HTMLButtonElement>("zoom-in").disabled = width >= maxWidth - 1;
  requestAnimationFrame(() => game.scale.refresh());
}

function changeBattlefieldZoom(delta: number) {
  battlefieldZoom = Math.max(0.6, Math.min(2, Math.round((battlefieldZoom + delta) * 100) / 100));
  localStorage.setItem(BATTLEFIELD_ZOOM_KEY, String(battlefieldZoom));
  applyBattlefieldScale();
}

function readPracticeSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(PRACTICE_SAVE_KEY)) ?? "null") as { version?: number; savedAt?: number; snapshot?: MatchSnapshot } | null;
    const value = saved?.snapshot;
    if (saved?.version !== 1 || !value || !Array.isArray(value.players) || value.players.length !== 2) return null;
    return { savedAt: saved.savedAt ?? 0, snapshot: value };
  } catch { return null; }
}

function savePractice(force = false) {
  if (activeMode !== "practice" || !snapshot) return;
  const now = Date.now();
  if (!force && now - lastPracticeSaveAt < 500) return;
  lastPracticeSaveAt = now;
  localStorage.setItem(scopedStorageKey(PRACTICE_SAVE_KEY), JSON.stringify({ version: 1, savedAt: now, snapshot }));
  scheduleCloudSave(force);
}

function currentCloudProgress(): CloudProgress {
  return {
    version: 1,
    savedAt: Date.now(),
    activeMode,
    ...(activeMode === "practice" && snapshot ? { practiceSnapshot: snapshot } : {}),
  };
}

function setCloudStatus(message: string, tone: "syncing" | "ok" | "error" = "ok") {
  const status = get("cloud-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function scheduleCloudSave(force = false) {
  if (!currentProfile) return;
  if (!force && cloudSaveTimer) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = 0;
  setCloudStatus("正在同步", "syncing");
  const run = async () => {
    cloudSaveTimer = 0;
    if (!currentProfile) return;
    const profile = currentProfile;
    const progress = currentCloudProgress();
    try {
      if (cloudSaveInFlight) await cloudSaveInFlight;
      cloudSaveInFlight = cloud.saveProgress(profile, progress);
      await cloudSaveInFlight;
      setCloudStatus("云端已同步", "ok");
    } catch (error) {
      setCloudStatus("同步失败", "error");
      showToast(error instanceof Error ? error.message : "云存档同步失败");
    } finally {
      cloudSaveInFlight = null;
    }
  };
  if (force) void run();
  else cloudSaveTimer = window.setTimeout(() => void run(), 2400);
}

function enterBattle(mode: string, network: boolean) {
  lobby.hidden = true; battleShell.hidden = false;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  get("mode-label").textContent = mode;
  get("network-label").textContent = network ? "房主权威演算 · Supabase 实时同步" : "本地权威演算";
  get("network-pill").classList.toggle("is-online", network);
  applyPieceDisplayMode();
  requestAnimationFrame(() => {
    applyBattlefieldScale();
    requestAnimationFrame(applyBattlefieldScale);
  });
}

function showToast(message: string) {
  const toast = get("toast"); toast.textContent = message; toast.classList.add("show");
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function startPractice(saved?: MatchSnapshot) {
  online?.close(); online = null;
  practice?.stop(); practice = new PracticeEngine(saved); slot = 0;
  activeMode = "practice";
  localStorage.setItem(scopedStorageKey(ACTIVE_MODE_KEY), activeMode);
  localStorage.removeItem(scopedStorageKey(ONLINE_SESSION_KEY));
  commandSink = (command) => practice?.send(command);
  practice.addEventListener("snapshot", (event) => updateSnapshot((event as CustomEvent<MatchSnapshot>).detail));
  practice.addEventListener("notice", (event) => showToast((event as CustomEvent<{ message: string }>).detail.message));
  get("room-banner").hidden = true;
  get("opponent-name").textContent = "演武军士";
  enterBattle(saved ? "人机对战 · 已恢复" : "人机对战", false);
  practice.start();
  scheduleCloudSave();
}

function bindOnline(client: RealtimeClient) {
  client.addEventListener("snapshot", (event) => updateSnapshot((event as CustomEvent<MatchSnapshot>).detail));
  client.addEventListener("notice", (event) => showToast((event as CustomEvent<{ message: string }>).detail.message));
  client.addEventListener("network", (event) => {
    const connected = (event as CustomEvent<{ connected: boolean }>).detail.connected;
    get("network-pill").classList.toggle("is-offline", !connected);
    get("network-pill").querySelector("b")!.textContent = connected ? "已连接" : "重连中";
    if (!connected) showToast("网络中断，正在自动重连");
  });
  client.addEventListener("room", (event) => {
    const status = (event as CustomEvent<{ players: Array<{ slot: PlayerSlot; name: string }> }>).detail;
    roomPlayers = status.players;
    renderOpponent();
  });
}

async function onlineAction(kind: "create" | "join" | "quick") {
  practice?.stop(); practice = null;
  online?.close();
  online = new RealtimeClient(scopedStorageKey(ONLINE_SESSION_KEY)); bindOnline(online);
  lobbyNote.textContent = "正在连接 Supabase 实时房间……";
  let result;
  try {
    result = kind === "create" ? await online.create(playerName())
      : kind === "quick" ? await online.quick(playerName())
      : await online.join(get<HTMLInputElement>("room-code").value.trim().toUpperCase(), playerName());
  } catch (error) {
    const message = error instanceof Error ? error.message : "实时房间连接失败";
    lobbyNote.textContent = message;
    showToast(message);
    online.close();
    return;
  }
  if (!result.ok || result.slot === undefined || !result.roomId) {
    lobbyNote.textContent = result.message ?? "进入房间失败"; showToast(lobbyNote.textContent); return;
  }
  slot = result.slot; commandSink = (command) => online?.send(command);
  activeMode = "online";
  localStorage.setItem(scopedStorageKey(ACTIVE_MODE_KEY), activeMode);
  scheduleCloudSave();
  enterBattle(kind === "quick" ? "随机匹配" : "真人房间", true);
  get("room-banner").hidden = false; get("room-id").textContent = result.roomId;
  get("last-event").textContent = "等待另一位玩家进入";
  renderOpponent();
}

function renderOpponent() {
  const opponent = roomPlayers.find((player) => player.slot !== slot);
  get("opponent-name").textContent = opponent?.name ?? "等待对手";
  get("opponent-status").textContent = opponent ? "已进入房间" : "分享房号后等待加入";
}

function updateSnapshot(next: MatchSnapshot) {
  snapshot = next;
  const mine = next.players[slot]; const opponent = next.players[slot === 0 ? 1 : 0];
  get("my-buns").textContent = String(mine.buns);
  get("last-event").textContent = mine.lastEvent;
  get("map-title").textContent = MAP_LAYOUTS[next.mapIndex]?.name ?? "巨鹿";
  get("opponent-status").textContent = `${opponent.units.length} 部队 · 第 ${opponent.wave} 波`;
  get("wave").textContent = mine.phase === "preparing"
    ? `${Math.max(0, Math.ceil(mine.prepareMs / 1000))} 秒准备`
    : `${mine.wave} / ${GAME_CONFIG.maxWaves}`;
  game.events.emit("battle:snapshot", next, slot);
  savePractice();
  if (next.phase === "finished") showToast(next.winner === "draw" ? "本局平局" : next.winner === slot ? "守城成功" : "阿斗失守");
}

game.events.on("battle:recruit", () => commandSink?.({ type: "RECRUIT" }));
game.events.on("battle:inspect", (payload: { kind: string; level: number }) => showUnitInspector(payload.kind, payload.level));
game.events.on("battle:drop", (payload: { sourceType: "reserve" | "unit" | "generalPart"; id: string; partIndex: 0 | 1 | null; targetCell: number }) => {
  if (!snapshot || !commandSink) return;
  if (payload.sourceType === "reserve") commandSink({ type: "DROP_RESERVE", reserveId: payload.id, targetCell: payload.targetCell });
  else if (payload.sourceType === "generalPart" && payload.partIndex !== null) {
    commandSink({ type: "SPLIT_GENERAL", unitId: payload.id, partIndex: payload.partIndex, targetCell: payload.targetCell });
  } else commandSink({ type: "DROP_UNIT", unitId: payload.id, targetCell: payload.targetCell });
});
game.events.on("battle:camp-drop", (payload: { sourceType: "reserve" | "unit"; id: string; targetSlot: number }) => {
  if (!snapshot || !commandSink) return;
  if (payload.sourceType === "reserve") commandSink({ type: "DROP_RESERVE_TO_SLOT", reserveId: payload.id, targetSlot: payload.targetSlot });
  else commandSink({ type: "DROP_UNIT_TO_RESERVE", unitId: payload.id, targetSlot: payload.targetSlot });
});

get("practice").addEventListener("click", () => startPractice());
get("quick").addEventListener("click", () => void onlineAction("quick"));
get("create-room").addEventListener("click", () => void onlineAction("create"));
get("join-room").addEventListener("click", () => void onlineAction("join"));
get("copy-room").addEventListener("click", async () => {
  const code = get("room-id").textContent ?? "";
  const url = new URL(location.href); url.searchParams.set("room", code);
  await navigator.clipboard.writeText(url.toString()); showToast("邀请链接已复制");
});
get("zoom-out").addEventListener("click", () => changeBattlefieldZoom(-0.15));
get("zoom-in").addEventListener("click", () => changeBattlefieldZoom(0.15));
get("zoom-fit").addEventListener("click", () => {
  battlefieldZoom = 1;
  localStorage.setItem(BATTLEFIELD_ZOOM_KEY, "1");
  applyBattlefieldScale();
});
get("piece-mode-toggle").addEventListener("click", () => {
  pieceDisplayMode = pieceDisplayMode === "text" ? "image" : "text";
  localStorage.setItem(PIECE_DISPLAY_MODE_KEY, pieceDisplayMode);
  applyPieceDisplayMode();
});
get("unit-inspector-close").addEventListener("click", hideUnitInspector);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideUnitInspector(); });
get("exit-match").addEventListener("click", async () => {
  practice?.stop(); online?.close();
  practice = null; online = null; commandSink = null; snapshot = null; activeMode = null;
  localStorage.removeItem(scopedStorageKey(ACTIVE_MODE_KEY));
  localStorage.removeItem(scopedStorageKey(PRACTICE_SAVE_KEY));
  localStorage.removeItem(scopedStorageKey(ONLINE_SESSION_KEY));
  if (currentProfile) {
    try { await cloud.saveProgress(currentProfile, currentCloudProgress()); }
    catch { showToast("本局已退出，云端状态将在下次操作时同步"); }
  }
  hideUnitInspector();
  battleShell.hidden = true;
  lobby.hidden = false;
  window.scrollTo({ top: 0, behavior: "instant" });
});

async function restoreActiveSession(remoteProgress: CloudProgress | null) {
  const localSave = readPracticeSave();
  const remoteSave = remoteProgress?.practiceSnapshot
    ? { savedAt: remoteProgress.savedAt, snapshot: remoteProgress.practiceSnapshot }
    : null;
  const newestPractice = remoteSave && (!localSave || remoteSave.savedAt >= localSave.savedAt) ? remoteSave : localSave;
  const mode = remoteProgress?.activeMode ?? localStorage.getItem(scopedStorageKey(ACTIVE_MODE_KEY));
  if (mode === "practice") {
    if (newestPractice) { startPractice(newestPractice.snapshot); return; }
    localStorage.removeItem(scopedStorageKey(ACTIVE_MODE_KEY));
  }
  if (mode !== "online") return;
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(ONLINE_SESSION_KEY)) ?? "null") as { roomId?: string; token?: string } | null;
    if (!saved?.roomId || !saved.token) throw new Error("没有可恢复的房间凭证");
    online = new RealtimeClient(scopedStorageKey(ONLINE_SESSION_KEY)); bindOnline(online);
    const result = await online.resume(saved.roomId, saved.token);
    if (!result.ok || result.slot === undefined || !result.roomId) throw new Error(result.message ?? "房间已失效");
    slot = result.slot; activeMode = "online"; commandSink = (command) => online?.send(command);
    enterBattle("真人房间 · 已重连", true);
    get("room-banner").hidden = false; get("room-id").textContent = result.roomId;
    get("last-event").textContent = "已恢复原房间进度";
  } catch (error) {
    localStorage.removeItem(scopedStorageKey(ACTIVE_MODE_KEY));
    localStorage.removeItem(scopedStorageKey(ONLINE_SESSION_KEY));
    lobbyNote.textContent = `原房间无法恢复：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

function setAuthMode(mode: "login" | "register") {
  authMode = mode;
  const registering = mode === "register";
  get("auth-login-tab").classList.toggle("is-active", !registering);
  get("auth-register-tab").classList.toggle("is-active", registering);
  get("auth-login-tab").setAttribute("aria-selected", String(!registering));
  get("auth-register-tab").setAttribute("aria-selected", String(registering));
  document.querySelectorAll<HTMLElement>(".auth-confirm-row").forEach((element) => { element.hidden = !registering; });
  get<HTMLInputElement>("auth-password").autocomplete = registering ? "new-password" : "current-password";
  get("auth-submit").textContent = registering ? "创建战令并进入" : "进入战场";
  get("auth-message").textContent = registering
    ? "账号创建后会立即登录，进度将按账号隔离保存。"
    : "输入你的账号密码；刷新或换设备登录后可继续进度。";
}

async function enterAccount(profile: PlayerProfile) {
  currentProfile = profile;
  get("player-name").textContent = profile.username;
  setCloudStatus("云端已连接", "ok");
  authScreen.hidden = true;
  lobby.hidden = false;
  await restoreActiveSession(profile.progress);
}

get("auth-login-tab").addEventListener("click", () => setAuthMode("login"));
get("auth-register-tab").addEventListener("click", () => setAuthMode("register"));
get<HTMLFormElement>("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = get<HTMLButtonElement>("auth-submit");
  const message = get("auth-message");
  const username = get<HTMLInputElement>("auth-username").value;
  const password = get<HTMLInputElement>("auth-password").value;
  const confirm = get<HTMLInputElement>("auth-confirm").value;
  if (authMode === "register" && password !== confirm) { message.textContent = "两次输入的密码不一致"; return; }
  submit.disabled = true;
  message.textContent = authMode === "register" ? "正在创建账号……" : "正在验证账号……";
  try {
    const profile = authMode === "register"
      ? await cloud.signUp(username, password)
      : await cloud.signIn(username, password);
    get<HTMLInputElement>("auth-password").value = "";
    get<HTMLInputElement>("auth-confirm").value = "";
    await enterAccount(profile);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "登录失败，请稍后重试";
  } finally { submit.disabled = false; }
});

get("logout").addEventListener("click", async () => {
  const button = get<HTMLButtonElement>("logout");
  button.disabled = true;
  savePractice(true);
  if (cloudSaveInFlight) await cloudSaveInFlight.catch(() => undefined);
  practice?.stop(); online?.close();
  try { await cloud.signOut(); }
  catch (error) { showToast(error instanceof Error ? error.message : "退出账号失败"); button.disabled = false; return; }
  practice = null; online = null; commandSink = null; snapshot = null; activeMode = null; currentProfile = null;
  hideUnitInspector();
  lobby.hidden = true; battleShell.hidden = true; authScreen.hidden = false;
  button.disabled = false;
});

window.addEventListener("beforeunload", () => savePractice(true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") savePractice(true); });
window.addEventListener("resize", applyBattlefieldScale);
window.visualViewport?.addEventListener("resize", applyBattlefieldScale);
new ResizeObserver(applyBattlefieldScale).observe(document.querySelector<HTMLElement>(".battle-toolbar")!);

const invitedRoom = new URLSearchParams(location.search).get("room");
if (invitedRoom) get<HTMLInputElement>("room-code").value = invitedRoom.toUpperCase();

async function initializeAuth() {
  try {
    const session = await cloud.session();
    if (!session) return;
    const profile = await cloud.loadProfile(session);
    await enterAccount(profile);
  } catch (error) {
    get("auth-message").textContent = error instanceof Error ? error.message : "无法连接账号服务";
  }
}

void initializeAuth();
