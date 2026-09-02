import "./styles.css";
import { GAME_CONFIG, MAP_LAYOUTS, type GameCommand, type MatchSnapshot, type PlayerSlot } from "@adou/shared";
import { createGame } from "./game/BattleScene";
import { PracticeEngine } from "./game/PracticeEngine";
import { RealtimeClient } from "./net/RealtimeClient";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <main class="site-shell">
    <section class="lobby" id="lobby">
      <div class="lobby-art" aria-hidden="true"><img src="assets/backgrounds/lobby-zhaoyun-adou.webp" alt="" /></div>
      <div class="lobby-copy">
        <p class="eyebrow">1.0.9 规则复刻 · 新增实时对战</p>
        <h1><span>合字成将 · 护住阿斗</span>赵云与阿斗</h1>
        <p class="lead">五连征兵、营地拖放、铲子开格、同字升级与合字成将均按安装包基线运行。先选人机熟悉规则，或直接创建房间、输入房号、随机匹配。</p>
        <label class="field-label" for="player-name">玩家名</label>
        <input class="text-input" id="player-name" maxlength="16" value="常山侠客" autocomplete="nickname" />
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
        <p class="lobby-note" id="lobby-note">本机直接试玩请选择“人机对战”；真人模式需要同时运行仓库内的房间服务器。</p>
      </div>
    </section>

    <section class="battle-shell" id="battle-shell" hidden>
      <header class="battle-toolbar">
        <div><b id="mode-label">人机对战</b><span id="network-label">本地权威演算</span></div>
        <div class="toolbar-room" id="room-banner" hidden><span>房号</span><strong id="room-id">------</strong><button id="copy-room">复制邀请</button></div>
        <span class="network-pill" id="network-pill"><i></i><b>已就绪</b></span>
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
              <li>棋子可在营地换位/合成，也可在营地与下半场白格之间拖动。</li>
              <li>姓名两字合将后占两格；上阵后拖出任一字即可拆分。</li>
              <li>铲子拖到高亮草格可扩一格。</li>
              <li>棕色只走敌兵，白色才可布阵，绿色草地不可通行或放置。</li>
            </ol>
          </div>
        </aside>
      </div>
    </section>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </main>`;

const lobby = get<HTMLElement>("lobby");
const battleShell = get<HTMLElement>("battle-shell");
const lobbyNote = get<HTMLElement>("lobby-note");
const game = createGame("game");
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

const ACTIVE_MODE_KEY = "adou-active-mode-v1";
const PRACTICE_SAVE_KEY = "adou-practice-save-v1";
const ONLINE_SESSION_KEY = "adou-session";
const PLAYER_NAME_KEY = "adou-player-name";
const BATTLEFIELD_ZOOM_KEY = "adou-battlefield-zoom-v1";

function get<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
function playerName() { return get<HTMLInputElement>("player-name").value.trim() || "常山侠客"; }
function roomServerUrl() {
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return import.meta.env.VITE_SERVER_URL || (isLocal ? `${location.protocol}//${location.hostname}:3001` : location.origin);
}

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
    const saved = JSON.parse(localStorage.getItem(PRACTICE_SAVE_KEY) ?? "null") as { version?: number; snapshot?: MatchSnapshot } | null;
    const value = saved?.snapshot;
    if (saved?.version !== 1 || !value || !Array.isArray(value.players) || value.players.length !== 2) return null;
    return value;
  } catch { return null; }
}

function savePractice(force = false) {
  if (activeMode !== "practice" || !snapshot) return;
  const now = Date.now();
  if (!force && now - lastPracticeSaveAt < 500) return;
  lastPracticeSaveAt = now;
  localStorage.setItem(PRACTICE_SAVE_KEY, JSON.stringify({ version: 1, savedAt: now, snapshot }));
}

function enterBattle(mode: string, network: boolean) {
  lobby.hidden = true; battleShell.hidden = false;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  get("mode-label").textContent = mode;
  get("network-label").textContent = network ? "服务器权威演算" : "本地权威演算";
  get("network-pill").classList.toggle("is-online", network);
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
  localStorage.setItem(ACTIVE_MODE_KEY, activeMode);
  localStorage.removeItem(ONLINE_SESSION_KEY);
  commandSink = (command) => practice?.send(command);
  practice.addEventListener("snapshot", (event) => updateSnapshot((event as CustomEvent<MatchSnapshot>).detail));
  practice.addEventListener("notice", (event) => showToast((event as CustomEvent<{ message: string }>).detail.message));
  get("room-banner").hidden = true;
  get("opponent-name").textContent = "演武军士";
  enterBattle(saved ? "人机对战 · 已恢复" : "人机对战", false);
  practice.start();
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
  localStorage.setItem(PLAYER_NAME_KEY, playerName());
  online = new RealtimeClient(roomServerUrl()); bindOnline(online);
  lobbyNote.textContent = "正在连接房间服务器……";
  const result = kind === "create" ? await online.create(playerName())
    : kind === "quick" ? await online.quick(playerName())
    : await online.join(get<HTMLInputElement>("room-code").value.trim().toUpperCase(), playerName());
  if (!result.ok || result.slot === undefined || !result.roomId) {
    lobbyNote.textContent = result.message ?? "进入房间失败"; showToast(lobbyNote.textContent); return;
  }
  slot = result.slot; commandSink = (command) => online?.send(command);
  activeMode = "online";
  localStorage.setItem(ACTIVE_MODE_KEY, activeMode);
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
get("exit-match").addEventListener("click", () => {
  practice?.stop(); online?.close();
  localStorage.removeItem(ACTIVE_MODE_KEY);
  localStorage.removeItem(PRACTICE_SAVE_KEY);
  localStorage.removeItem(ONLINE_SESSION_KEY);
  location.href = location.pathname;
});

async function restoreActiveSession() {
  const savedName = localStorage.getItem(PLAYER_NAME_KEY);
  if (savedName) get<HTMLInputElement>("player-name").value = savedName;
  const mode = localStorage.getItem(ACTIVE_MODE_KEY);
  if (mode === "practice") {
    const saved = readPracticeSave();
    if (saved) { startPractice(saved); return; }
    localStorage.removeItem(ACTIVE_MODE_KEY);
  }
  if (mode !== "online") return;
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) ?? "null") as { roomId?: string; token?: string } | null;
    if (!saved?.roomId || !saved.token) throw new Error("没有可恢复的房间凭证");
    online = new RealtimeClient(roomServerUrl()); bindOnline(online);
    const result = await online.resume(saved.roomId, saved.token);
    if (!result.ok || result.slot === undefined || !result.roomId) throw new Error(result.message ?? "房间已失效");
    slot = result.slot; activeMode = "online"; commandSink = (command) => online?.send(command);
    enterBattle("真人房间 · 已重连", true);
    get("room-banner").hidden = false; get("room-id").textContent = result.roomId;
    get("last-event").textContent = "已恢复原房间进度";
  } catch (error) {
    localStorage.removeItem(ACTIVE_MODE_KEY);
    localStorage.removeItem(ONLINE_SESSION_KEY);
    lobbyNote.textContent = `原房间无法恢复：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

get<HTMLInputElement>("player-name").addEventListener("change", () => localStorage.setItem(PLAYER_NAME_KEY, playerName()));
window.addEventListener("beforeunload", () => savePractice(true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") savePractice(true); });
window.addEventListener("resize", applyBattlefieldScale);
window.visualViewport?.addEventListener("resize", applyBattlefieldScale);
new ResizeObserver(applyBattlefieldScale).observe(document.querySelector<HTMLElement>(".battle-toolbar")!);

const invitedRoom = new URLSearchParams(location.search).get("room");
if (invitedRoom) get<HTMLInputElement>("room-code").value = invitedRoom.toUpperCase();
void restoreActiveSession();
