import "./styles.css";
import {
  ACTIVE_PROP_IDS, GAME_CONFIG, GENERAL_EXPERIENCE, GENERAL_LEVEL_ATTACK, GENERAL_LEVEL_SPEED, GENERALS, HERO_PAIRS, MAP_LAYOUTS,
  PASSIVE_PROP_IDS, PROPS, PROP_RARITY_COLORS, PROP_RARITY_NAMES, SOLDIER_LEVEL_ATTACK,
  SOLDIER_LEVEL_SPEED, SOLDIERS,
  bulldozerSupplyAvailable, shovelSupplyCount,
  type ActivePropId, type GameCommand, type MatchSnapshot, type PlayerSlot, type PropLoadout,
} from "@adou/shared";
import { IMAGE_ASSETS } from "./game/assets";
import { createGame } from "./game/BattleScene";
import {
  BATTLE_INPUT, commandForActivePropDrop, commandForBattleCampDrop, commandForBattleDrop,
  createPointerGesture, updatePointerGesture,
  type ActivePropDropPayload, type BattleCampDropPayload, type BattleDropPayload, type PointerGesture,
} from "./game/battleInteraction";
import { PracticeEngine } from "./game/PracticeEngine";
import { RealtimeClient } from "./net/RealtimeClient";
import { AuthoritativeRealtimeClient } from "./net/AuthoritativeRealtimeClient";
import { loadRuntimeConfig } from "./app/runtimeConfig";
import { createRoomInviteUrl, normalizeRoomCode, removeRoomInviteFromUrl } from "./app/roomInvite";
import {
  SupabaseService, type AccountEconomy, type CloudProgress, type PlayerProfile, type ShopOffer,
} from "./auth/SupabaseService";
import { freshEconomy, normalizeEconomy } from "./auth/economy";

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
        <div class="account-strip"><div><span>当前战令</span><strong id="player-name">未登录</strong></div><div class="account-economy"><span>金币</span><strong id="account-gold">0</strong></div><div class="account-economy"><span>体力</span><strong id="account-stamina">30/30</strong></div><div class="account-economy"><span>今日战绩</span><strong id="account-record">0胜 0负</strong></div><i id="cloud-status">云端同步中</i><button id="logout" type="button">退出账号</button></div>
        <details class="prop-armory" id="prop-armory">
          <summary><span>原版道具装配</span><b id="prop-loadout-count">主动 0/2 · 被动 0/6</b></summary>
          <p>只显示今天已获得的道具。原版道具每日零点清空；每局结算后进入商店，可用金币购买或直接领取原广告奖励。</p>
          <h3>主动道具（最多2件）</h3><div class="prop-picker" id="active-prop-picker"></div>
          <h3>被动道具（最多6件）</h3><div class="prop-picker" id="passive-prop-picker"></div>
        </details>
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
        <div class="toolbar-room" id="room-banner" hidden>
          <span>房号</span><strong id="room-id">------</strong>
          <div class="toolbar-room-actions"><button type="button" data-copy-room-code>复制房号</button><button type="button" data-copy-room-link>邀请链接</button></div>
        </div>
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
        <section class="playfield-card" aria-label="赵云与阿斗战场">
          <div class="battle-skill-dock active-props" id="battle-skill-dock">
            <div><b>主动道具</b><small id="prop-target-hint">按住道具，拖到高亮目标。</small></div>
            <div id="active-prop-bar" class="active-prop-bar"></div>
          </div>
          <section class="match-ready-panel" id="match-ready-panel" aria-labelledby="match-ready-title" hidden>
            <div class="match-ready-card">
              <p class="eyebrow">真人对战 · 开战确认</p>
              <h2 id="match-ready-title">双方准备后开战</h2>
              <p>先确认网络和阵容。任何一方未进入或未准备，权威服务器都不会开始倒计时。</p>
              <div class="ready-roster" aria-live="polite">
                <div id="ready-player-0"><span>玩家一</span><strong>等待进入</strong><i>未准备</i></div>
                <div id="ready-player-1"><span>玩家二</span><strong>等待进入</strong><i>未准备</i></div>
              </div>
              <div class="ready-room-share">
                <div><span>邀请房间</span><strong id="ready-room-id">------</strong></div>
                <div class="ready-room-share-actions">
                  <button class="btn btn-quiet" type="button" data-copy-room-code>复制房号</button>
                  <button class="btn btn-primary" type="button" data-copy-room-link>复制邀请链接</button>
                </div>
                <small>好友打开邀请链接后，将直接进入这个房间。</small>
              </div>
              <button class="btn btn-accent" id="match-ready" type="button">我已准备</button>
              <small id="match-ready-hint">可以先准备，好友进入并准备后自动开战。</small>
            </div>
          </section>
          <div id="game" class="game-frame"></div>
        </section>
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
              <li>主动道具从上方图标拖到高亮目标；包子轻点即用。</li>
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
      <section class="postgame-overlay" id="postgame-overlay" role="dialog" aria-modal="true" aria-labelledby="postgame-title" hidden>
        <article class="postgame-card">
          <p class="eyebrow" id="postgame-eyebrow">战斗结算</p>
          <h2 id="postgame-title">守城成功</h2>
          <div id="result-pane" class="result-pane">
            <div class="gold-reward"><span>本局金币</span><strong id="result-gold">20</strong></div>
            <p>原版胜利获得20金币、失败获得5金币；广告翻倍在网页版本改为直接领取。</p>
            <div class="postgame-actions"><button class="btn btn-quiet" id="claim-normal" type="button">领取金币</button><button class="btn btn-accent" id="claim-double" type="button">直接领取双倍（原广告）</button></div>
          </div>
          <div id="shop-pane" class="shop-pane" hidden>
            <div class="shop-heading"><div><span>今日持有金币</span><strong id="shop-gold">0</strong></div><p>原版流程：战斗结算后出现3件随机商品，道具仅在当天有效。</p></div>
            <div class="shop-offers" id="shop-offers"></div>
            <section class="lottery-panel"><div><b>八格道具转盘</b><small>原版需广告或分享；本版本点击即抽取</small></div><div class="lottery-slots" id="lottery-slots"></div><button class="btn btn-accent" id="lottery-draw" type="button">直接抽奖（原广告/分享）</button></section>
            <button class="btn btn-primary shop-close" id="shop-close" type="button">完成选择，返回大厅</button>
          </div>
        </article>
      </section>
    </section>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </main>`;

const lobby = get<HTMLElement>("lobby");
const authScreen = get<HTMLElement>("auth-screen");
const battleShell = get<HTMLElement>("battle-shell");
const lobbyNote = get<HTMLElement>("lobby-note");
const interactionTestMode = import.meta.env.DEV && new URLSearchParams(location.search).get("testBattle") === "1";
let invitedRoom = normalizeRoomCode(new URLSearchParams(location.search).get("room"));
const game = createGame("game");
const runtimeConfig = loadRuntimeConfig();
const cloud = new SupabaseService(runtimeConfig.supabase);
let snapshot: MatchSnapshot | null = null;
let slot: PlayerSlot = 0;
let practice: PracticeEngine | null = null;
type OnlineClient = RealtimeClient | AuthoritativeRealtimeClient;
type RoomPlayer = { slot: PlayerSlot; name: string; connected: boolean; ready: boolean };
let online: OnlineClient | null = null;
let commandSink: ((command: GameCommand) => void) | null = null;
let toastTimer = 0;
let roomPlayers: RoomPlayer[] = [];
let roomStarted = false;
let activeMode: "practice" | "online" | null = null;
let lastPracticeSaveAt = 0;
let battlefieldZoom = readStoredZoom();
let pieceDisplayMode: "text" | "image" = localStorage.getItem("adou-piece-display-mode-v1") === "text" ? "text" : "image";
let currentProfile: PlayerProfile | null = null;
let authMode: "login" | "register" = "login";
let cloudSaveTimer = 0;
let cloudSaveInFlight: Promise<void> | null = null;
let propLoadout: PropLoadout = { active: [], passive: [] };
let economy: AccountEconomy = freshEconomy();
let inspectedTarget: { kind: string; level: number; unitId?: string; reserveId?: string; ownerSlot?: PlayerSlot } | null = null;
let loadoutSentKey = "";
let shownFinishedKey = "";
let activePropPointer: {
  propId: ActivePropId;
  button: HTMLButtonElement;
  gesture: PointerGesture;
  ghost: HTMLButtonElement | null;
} | null = null;
let suppressActivePropClick = false;

const ACTIVE_MODE_KEY = "adou-active-mode-v1";
const PRACTICE_SAVE_KEY = "adou-practice-save-v1";
const ONLINE_SESSION_KEY = "adou-session";
const BATTLEFIELD_ZOOM_KEY = "adou-battlefield-zoom-v1";
const PIECE_DISPLAY_MODE_KEY = "adou-piece-display-mode-v1";
const PROP_LOADOUT_KEY = "adou-prop-loadout-v1";

function get<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function receivesEarlyDailyShovels() {
  return economy.winDay + economy.loseDay < 3;
}

function ownedLevel(id: number) { return economy.ownedProps.find((entry) => entry.id === id)?.level ?? 0; }

function pruneLoadout(loadout: PropLoadout): PropLoadout {
  return {
    active: loadout.active.filter((id) => ownedLevel(id) > 0).slice(0, 2),
    passive: loadout.passive.filter((entry) => ownedLevel(entry.id) > 0).slice(0, 6)
      .map((entry) => ({ id: entry.id, level: ownedLevel(entry.id) })),
  };
}

function renderEconomy() {
  get("account-gold").textContent = String(economy.gold);
  get("account-stamina").textContent = `${economy.stamina}/30`;
  get("account-record").textContent = `${economy.winDay}胜 ${economy.loseDay}负`;
  get("shop-gold").textContent = String(economy.gold);
}

function normalizeStoredLoadout(value: unknown): PropLoadout {
  if (!value || typeof value !== "object") return { active: [], passive: [] };
  const raw = value as Partial<PropLoadout>;
  const active = [...new Set((Array.isArray(raw.active) ? raw.active : []).filter((id): id is ActivePropId => ACTIVE_PROP_IDS.includes(id as ActivePropId)))].slice(0, 2);
  const passive = (Array.isArray(raw.passive) ? raw.passive : [])
    .filter((entry): entry is PropLoadout["passive"][number] => Boolean(entry) && PASSIVE_PROP_IDS.includes(Number(entry.id) as PropLoadout["passive"][number]["id"]))
    .filter((entry, index, entries) => entries.findIndex((other) => other.id === entry.id) === index)
    .slice(0, 6)
    .map((entry) => ({ id: entry.id, level: entry.id === 22 ? Math.max(1, Math.min(3, Math.floor(entry.level || 1))) : 1 }));
  return { active, passive };
}

function propCooldownLabel(milliseconds: number) {
  if (milliseconds < 0) return "被动";
  if (milliseconds === 0) return "无冷却";
  return `${Math.round(milliseconds / 1000)}秒`;
}

function renderPropPicker() {
  const activeSelected = new Set(propLoadout.active);
  const passiveSelected = new Map(propLoadout.passive.map((entry) => [entry.id, entry.level]));
  const card = (id: number, selected: boolean, level = 1) => {
    const prop = PROPS[id]!;
    const color = PROP_RARITY_COLORS[prop.rarity];
    return `<button class="prop-card${selected ? " is-selected" : ""}" type="button" data-prop-id="${id}" style="--prop-color:${color}" aria-pressed="${selected}">
      <span><i>${prop.name.slice(0, 1)}</i><strong>${prop.name}</strong><em>${PROP_RARITY_NAMES[prop.rarity]}</em></span>
      <small>${prop.intro}</small><b>${propCooldownLabel(prop.cooldownMs)}${id === 22 ? ` · 已升至${level}级` : ""}</b>
    </button>`;
  };
  const activeOwned = ACTIVE_PROP_IDS.filter((id) => ownedLevel(id) > 0);
  const passiveOwned = PASSIVE_PROP_IDS.filter((id) => ownedLevel(id) > 0);
  get("active-prop-picker").innerHTML = activeOwned.length ? activeOwned.map((id) => card(id, activeSelected.has(id))).join("") : '<p class="empty-props">今天还没有主动道具，完成一局后可在商店获得。</p>';
  get("passive-prop-picker").innerHTML = passiveOwned.length ? passiveOwned.map((id) => card(id, passiveSelected.has(id), ownedLevel(id))).join("") : '<p class="empty-props">今天还没有被动道具，完成一局后可在商店获得。</p>';
  get("prop-loadout-count").textContent = `主动 ${propLoadout.active.length}/2 · 被动 ${propLoadout.passive.length}/6`;
}

function savePropLoadout() {
  localStorage.setItem(scopedStorageKey(PROP_LOADOUT_KEY), JSON.stringify(propLoadout));
  renderPropPicker();
  scheduleCloudSave();
}

function toggleProp(id: number) {
  if (ACTIVE_PROP_IDS.includes(id as ActivePropId)) {
    const propId = id as ActivePropId;
    if (propLoadout.active.includes(propId)) propLoadout.active = propLoadout.active.filter((entry) => entry !== propId);
    else if (propLoadout.active.length < 2) propLoadout.active = [...propLoadout.active, propId];
    else { showToast("主动道具最多装配2件"); return; }
  } else if (PASSIVE_PROP_IDS.includes(id as PropLoadout["passive"][number]["id"])) {
    const propId = id as PropLoadout["passive"][number]["id"];
    const exists = propLoadout.passive.some((entry) => entry.id === propId);
    if (exists) propLoadout.passive = propLoadout.passive.filter((entry) => entry.id !== propId);
    else if (propLoadout.passive.length < 6) propLoadout.passive = [...propLoadout.passive, { id: propId, level: 1 }];
    else { showToast("被动道具最多装配6件"); return; }
  }
  savePropLoadout();
}

function renderActiveProps() {
  const bar = get("active-prop-bar");
  const mine = snapshot?.players[slot];
  const active = mine?.props?.loadout.active ?? propLoadout.active;
  const supplyCount = mine && snapshot ? shovelSupplyCount(snapshot, mine) : 0;
  const bulldozerReady = Boolean(mine && snapshot && bulldozerSupplyAvailable(snapshot, mine));
  const structureKey = `${supplyCount > 0 ? "supply" : ""}:${bulldozerReady ? "bulldozer" : ""}:${active.join(",")}`;
  if (bar.dataset.structureKey !== structureKey) {
    const buttons: HTMLElement[] = [];
    if (supplyCount > 0) {
      const supply = document.createElement("button");
      supply.type = "button";
      supply.dataset.claimShovels = "";
      supply.style.setProperty("--prop-color", "#e99431");
      supply.innerHTML = "<i>铲</i><b></b><small>直接领取·原广告</small>";
      buttons.push(supply);
    }
    if (bulldozerReady) {
      const bulldozer = document.createElement("button");
      bulldozer.type = "button";
      bulldozer.dataset.claimBulldozer = "";
      bulldozer.style.setProperty("--prop-color", "#c46c3d");
      bulldozer.innerHTML = "<i>车</i><b>推土车</b><small>直接出动·原广告</small>";
      buttons.push(bulldozer);
    }
    for (const id of active) {
      const prop = PROPS[id]!;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.useProp = String(id);
      button.style.setProperty("--prop-color", PROP_RARITY_COLORS[prop.rarity]);
      button.setAttribute("aria-describedby", "prop-target-hint");
      button.innerHTML = `<i>${prop.name[0]}</i><b>${prop.name}</b><small></small>`;
      buttons.push(button);
    }
    if (buttons.length === 0) {
      const empty = document.createElement("span");
      empty.textContent = "本局未装配主动道具";
      buttons.push(empty);
    }
    bar.replaceChildren(...buttons);
    bar.dataset.structureKey = structureKey;
  }
  const supply = bar.querySelector<HTMLButtonElement>("[data-claim-shovels]");
  if (supply) supply.querySelector("b")!.textContent = `${supplyCount}把铲子`;
  for (const id of active) {
    const button = bar.querySelector<HTMLButtonElement>(`[data-use-prop="${id}"]`);
    if (!button) continue;
    const cooldown = mine?.props?.cooldowns[id] ?? 0;
    button.disabled = cooldown > 0;
    button.querySelector("small")!.textContent = cooldown > 0
      ? `${Math.ceil(cooldown / 1000)}秒`
      : PROPS[id]?.target === "self" ? "轻点使用" : "拖动使用";
  }
}

function activePropInstruction(propId: ActivePropId) {
  const prop = PROPS[propId]!;
  if (prop.target === "own-unit") return `把${prop.name}拖到己方单位上`;
  if (prop.target === "enemy-area") return `把${prop.name}拖到敌方单位上作为落点`;
  if (prop.target === "road-cell") return `把${prop.name}拖到己方棕色道路上`;
  if (prop.target === "reserve") return `把${prop.name}拖到营地文字上`;
  return `轻点${prop.name}即可使用`;
}

function useActiveProp(propId: ActivePropId) {
  if (!commandSink) return;
  if (PROPS[propId]?.target === "self") {
    commandSink({ type: "USE_PROP", propId });
    return;
  }
  const instruction = activePropInstruction(propId);
  get("prop-target-hint").textContent = instruction;
  showToast(instruction);
}

function beginActivePropPointer(event: PointerEvent, button: HTMLButtonElement) {
  if (activePropPointer || button.disabled || !event.isPrimary) return;
  const propId = Number(button.dataset.useProp) as ActivePropId;
  const threshold = event.pointerType === "touch" ? BATTLE_INPUT.touchDragThresholdPx : BATTLE_INPUT.mouseDragThresholdPx;
  activePropPointer = {
    propId,
    button,
    gesture: createPointerGesture(event.pointerId, { x: event.clientX, y: event.clientY }, threshold),
    ghost: null,
  };
  button.classList.add("is-pressed");
  button.setPointerCapture?.(event.pointerId);
}

function beginActivePropDrag(event: PointerEvent) {
  if (!activePropPointer || activePropPointer.ghost) return;
  const { button, propId } = activePropPointer;
  const ghost = button.cloneNode(true) as HTMLButtonElement;
  const rect = button.getBoundingClientRect();
  ghost.classList.remove("is-pressed");
  ghost.classList.add("active-prop-drag-ghost");
  ghost.disabled = false;
  ghost.style.width = `${Math.max(86, rect.width)}px`;
  document.body.append(ghost);
  activePropPointer.ghost = ghost;
  button.classList.add("is-drag-source");
  document.body.classList.add("is-dragging-prop");
  hideUnitInspector();
  get("prop-target-hint").textContent = activePropInstruction(propId);
  game.events.emit("battle:prop-drag-start", propId);
  moveActivePropGhost(event);
}

function moveActivePropGhost(event: PointerEvent) {
  if (!activePropPointer?.ghost) return;
  activePropPointer.ghost.style.left = `${event.clientX}px`;
  activePropPointer.ghost.style.top = `${event.clientY}px`;
  game.events.emit("battle:prop-drag-move", {
    propId: activePropPointer.propId, clientX: event.clientX, clientY: event.clientY,
  });
}

function finishActivePropPointer(event: PointerEvent, cancelled = false) {
  if (!activePropPointer || activePropPointer.gesture.pointerId !== event.pointerId) return;
  const update = updatePointerGesture(activePropPointer.gesture, event.pointerId, { x: event.clientX, y: event.clientY });
  activePropPointer.gesture = update.gesture;
  if (update.beganDrag) beginActivePropDrag(event);
  const dragged = Boolean(activePropPointer.ghost);
  const propId = activePropPointer.propId;
  if (dragged) {
    event.preventDefault();
    suppressActivePropClick = true;
    if (cancelled) game.events.emit("battle:prop-drag-cancel");
    else game.events.emit("battle:prop-drag-end", { propId, clientX: event.clientX, clientY: event.clientY });
  }
  activePropPointer.button.classList.remove("is-pressed", "is-drag-source");
  activePropPointer.ghost?.remove();
  document.body.classList.remove("is-dragging-prop");
  activePropPointer = null;
  if (dragged) window.setTimeout(() => { suppressActivePropClick = false; }, 0);
}

function moveActivePropPointer(event: PointerEvent) {
  if (!activePropPointer) return;
  const update = updatePointerGesture(activePropPointer.gesture, event.pointerId, { x: event.clientX, y: event.clientY });
  if (!update.accepted) return;
  activePropPointer.gesture = update.gesture;
  if (update.beganDrag) beginActivePropDrag(event);
  if (update.gesture.dragging) {
    event.preventDefault();
    moveActivePropGhost(event);
  }
}

function unitArtPath(kind: string) {
  if (kind in IMAGE_ASSETS.troops) return IMAGE_ASSETS.troops[kind as keyof typeof IMAGE_ASSETS.troops].path;
  if (kind in IMAGE_ASSETS.heroes) return IMAGE_ASSETS.heroes[kind as keyof typeof IMAGE_ASSETS.heroes].path;
  if (kind === "铲子") return IMAGE_ASSETS.ui.shovel.path;
  return null;
}

function showUnitInspector(payload: { kind: string; level: number; unitId?: string; reserveId?: string; ownerSlot?: PlayerSlot }) {
  const { kind, level } = payload;
  inspectedTarget = payload;
  const panel = get<HTMLElement>("unit-inspector");
  const hero = GENERALS[kind];
  const soldier = SOLDIERS[kind as keyof typeof SOLDIERS];
  const base = hero ?? soldier;
  const normalizedLevel = base ? Math.max(1, Math.min(level, base.maxLevel)) : Math.max(1, level);
  const levelIndex = normalizedLevel - 1;
  const attackCurve = hero ? GENERAL_LEVEL_ATTACK : SOLDIER_LEVEL_ATTACK;
  const speedCurve = hero ? GENERAL_LEVEL_SPEED : SOLDIER_LEVEL_SPEED;
  const attack = base ? base.attack * (attackCurve[levelIndex] ?? 1) : null;
  const selectedPlayer = payload.ownerSlot === undefined || !snapshot ? undefined : snapshot.players[payload.ownerSlot];
  const selectedUnit = payload.unitId ? selectedPlayer?.units.find((unit) => unit.id === payload.unitId) : undefined;
  const selectedReserve = payload.reserveId ? selectedPlayer?.reserve.find((item) => item.id === payload.reserveId) : undefined;
  const selectedPiece = selectedUnit ?? selectedReserve;
  const opposingPlayer = payload.ownerSlot === undefined || !snapshot ? undefined : snapshot.players[payload.ownerSlot === 0 ? 1 : 0];
  const universalSpeed = (selectedPlayer?.props?.loadout.passive.some((entry) => entry.id === 14) ? 0.1 : 0)
    + (opposingPlayer?.props?.loadout.passive.some((entry) => entry.id === 14) ? 0.1 : 0);
  const togetherSpeed = (selectedPlayer?.props?.loadout.passive.some((entry) => entry.id === 15) ? 0.5 : 0)
    + (opposingPlayer?.props?.loadout.passive.some((entry) => entry.id === 15) ? 0.3 : 0);
  const speedMultiplier = 1 + universalSpeed + togetherSpeed + ((selectedUnit?.attackSpeedMultiplier ?? 1) - 1)
    + ((selectedUnit?.temporaryAttackSpeedMultiplier ?? 1) - 1);
  const interval = base ? base.intervalMs / (speedCurve[levelIndex] ?? 1) / Math.max(0.05, speedMultiplier) : null;
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
  get("unit-inspector-range").textContent = base ? `${base.range * (selectedUnit?.rangeMultiplier ?? 1)}格` : "—";
  get("unit-inspector-form").textContent = hero ? `${hero.weapon} · ${hero.form}` : soldier?.form ?? (kind === "铲子" ? "开垦草格" : "合字成将");
  if (hero) {
    const thresholds = GENERAL_EXPERIENCE.thresholds[hero.rarity];
    const experience = selectedPiece?.experience ?? thresholds[normalizedLevel - 1] ?? 0;
    const next = thresholds[normalizedLevel];
    const growth = next === undefined ? "经验已满" : `击杀经验 ${experience}/${next}，满后自动升级`;
    get("unit-inspector-skill").textContent = `自动索敌攻击 · ${growth}。武器：${hero.weapon}。技能：${hero.skill}。`;
  } else if (soldier) {
    const extra = kind === "枪" ? "长枪刺击会贯穿刺击轨迹上的敌人。" : kind === "骑" ? "两段环扫：内圈各承受两次50%伤害，外圈承受一次50%伤害。" : "";
    get("unit-inspector-skill").textContent = `优先攻击：${soldier.target}。${extra}判定：攻击圆擦到敌军整格碰撞盒即命中。`;
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

function hideUnitInspector(notifyScene = true) {
  get<HTMLElement>("unit-inspector").hidden = true;
  inspectedTarget = null;
  if (notifyScene) game.events.emit("battle:inspect-clear");
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
  const skillDock = document.getElementById("battle-skill-dock");
  const availableHeight = Math.max(390, viewportHeight - verticalPadding - (toolbar?.offsetHeight ?? 52) - (skillDock?.offsetHeight ?? 0) - 10);
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
  if (interactionTestMode) return;
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
    propLoadout,
    economy,
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
  get("network-label").textContent = network
    ? runtimeConfig.serverUrl ? "常驻服务器权威演算" : "本地兼容联机"
    : "本地权威演算";
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
  roomStarted = false;
  get<HTMLElement>("match-ready-panel").hidden = true;
  practice?.stop(); practice = new PracticeEngine(saved, undefined, economy.totalMatches); slot = 0;
  activeMode = "practice";
  localStorage.setItem(scopedStorageKey(ACTIVE_MODE_KEY), activeMode);
  localStorage.removeItem(scopedStorageKey(ONLINE_SESSION_KEY));
  commandSink = (command) => practice?.send(command);
  practice.addEventListener("snapshot", (event) => updateSnapshot((event as CustomEvent<MatchSnapshot>).detail));
  practice.addEventListener("notice", (event) => showToast((event as CustomEvent<{ message: string }>).detail.message));
  get("room-banner").hidden = true;
  get("opponent-name").textContent = "演武军士";
  enterBattle(saved ? "人机对战 · 已恢复" : "人机对战", false);
  if (!practice.snapshot.players[0].props?.configured) practice.send({
    type: "SET_PROP_LOADOUT", loadout: propLoadout, earlyAccountShovelBonus: receivesEarlyDailyShovels(),
  });
  practice.start();
  scheduleCloudSave();
}

function createOnlineClient(): OnlineClient {
  const storageKey = scopedStorageKey(ONLINE_SESSION_KEY);
  if (!runtimeConfig.serverUrl) return new RealtimeClient(storageKey, runtimeConfig.supabase);
  return new AuthoritativeRealtimeClient(storageKey, runtimeConfig.serverUrl, async () => {
    const session = await cloud.session();
    if (!session?.access_token) throw new Error("登录已失效，请重新登录后进入真人对战");
    return session.access_token;
  }, runtimeConfig.socketPath);
}

function bindOnline(client: OnlineClient) {
  client.addEventListener("snapshot", (event) => updateSnapshot((event as CustomEvent<MatchSnapshot>).detail));
  client.addEventListener("notice", (event) => showToast((event as CustomEvent<{ message: string }>).detail.message));
  client.addEventListener("network", (event) => {
    const connected = (event as CustomEvent<{ connected: boolean }>).detail.connected;
    get("network-pill").classList.toggle("is-offline", !connected);
    get("network-pill").querySelector("b")!.textContent = connected ? "已连接" : "重连中";
    if (!connected) showToast("网络中断，正在自动重连");
  });
  client.addEventListener("room", (event) => {
    const status = (event as CustomEvent<{ players: RoomPlayer[]; started: boolean }>).detail;
    roomPlayers = status.players;
    roomStarted = status.started;
    renderOpponent();
    renderReadyState();
  });
  client.addEventListener("start", () => {
    roomStarted = true;
    renderReadyState();
  });
}

function renderRoomId(roomId: string) {
  get("room-id").textContent = roomId;
  get("ready-room-id").textContent = roomId;
}

async function copyRoomText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("复制失败，请长按房间号手动复制");
  }
}

function currentRoomCode() {
  return normalizeRoomCode(get("room-id").textContent);
}

async function onlineAction(kind: "create" | "join" | "quick"): Promise<boolean> {
  practice?.stop(); practice = null;
  snapshot = null;
  roomPlayers = [];
  roomStarted = false;
  loadoutSentKey = "";
  online?.close();
  online = createOnlineClient(); bindOnline(online);
  lobbyNote.textContent = runtimeConfig.serverUrl ? "正在连接权威对战服务器……" : "正在连接本地实时房间……";
  let result;
  const introRound = economy.totalMatches;
  try {
    result = kind === "create" ? await online.create(playerName(), introRound)
      : kind === "quick" ? await online.quick(playerName(), introRound)
      : await online.join(get<HTMLInputElement>("room-code").value.trim().toUpperCase(), playerName(), introRound);
  } catch (error) {
    const message = error instanceof Error ? error.message : "实时房间连接失败";
    lobbyNote.textContent = message;
    showToast(message);
    online.close();
    return false;
  }
  if (!result.ok || result.slot === undefined || !result.roomId) {
    lobbyNote.textContent = result.message ?? "进入房间失败"; showToast(lobbyNote.textContent); return false;
  }
  slot = result.slot; commandSink = (command) => online?.send(command);
  activeMode = "online";
  localStorage.setItem(scopedStorageKey(ACTIVE_MODE_KEY), activeMode);
  scheduleCloudSave();
  enterBattle(kind === "quick" ? "随机匹配" : "真人房间", true);
  get("room-banner").hidden = false; renderRoomId(result.roomId);
  get("last-event").textContent = "等待另一位玩家进入";
  renderOpponent();
  renderReadyState();
  return true;
}

function renderOpponent() {
  const opponent = roomPlayers.find((player) => player.slot !== slot);
  get("opponent-name").textContent = opponent?.name ?? "等待对手";
  get("opponent-status").textContent = opponent
    ? opponent.ready ? "已准备，等待你确认" : "已进入房间 · 尚未准备"
    : "分享房号后等待加入";
}

function renderReadyState() {
  const panel = get<HTMLElement>("match-ready-panel");
  const button = get<HTMLButtonElement>("match-ready");
  const hint = get("match-ready-hint");
  panel.hidden = activeMode !== "online" || Boolean(snapshot);
  for (const playerSlot of [0, 1] as const) {
    const player = roomPlayers.find((candidate) => candidate.slot === playerSlot);
    const row = get(`ready-player-${playerSlot}`);
    row.classList.toggle("is-ready", Boolean(player?.ready));
    row.classList.toggle("is-offline", Boolean(player && !player.connected));
    row.querySelector("span")!.textContent = playerSlot === slot ? "你" : "对手";
    row.querySelector("strong")!.textContent = player?.name ?? "等待进入";
    row.querySelector("i")!.textContent = !player ? "未进入" : !player.connected ? "已离线" : player.ready ? "已准备" : "未准备";
  }
  const mine = roomPlayers.find((player) => player.slot === slot);
  button.disabled = roomStarted || !mine?.connected || Boolean(mine.ready);
  button.textContent = roomStarted ? "正在载入战场…" : mine?.ready ? "已准备，等待对手" : "我已准备";
  const opponent = roomPlayers.find((player) => player.slot !== slot);
  hint.textContent = roomStarted
    ? "双方已经准备，正在接收权威战场快照。"
    : !opponent ? "可以先准备，好友进入并准备后自动开战。"
      : mine?.ready ? "你的准备已确认，等待对手点击准备。"
        : opponent.ready ? "对手已经准备，确认后立即开战。" : "双方都确认后才会开始10秒布阵倒计时。";
}

function availableShopPropIds() {
  return PROPS.filter((prop) => prop.id >= 2 && prop.id <= 24)
    .filter((prop) => prop.id === 23 || ownedLevel(prop.id) === 0 || (prop.id === 22 && ownedLevel(22) < 3))
    .map((prop) => prop.id);
}

function propPrice(id: number) {
  const prop = PROPS[id]!;
  if (id === 22) return prop.upgradePrices?.[ownedLevel(22)] ?? prop.price;
  return prop.price;
}

function propWeight(id: number, mode: "pool" | "winner") {
  const prop = PROPS[id]!;
  if (id === 22) {
    const level = ownedLevel(22);
    return (mode === "pool" ? prop.upgradeJa?.[level] : prop.upgradeHa?.[level]) ?? 0;
  }
  return (mode === "pool" ? prop.ja : prop.ha) ?? 0;
}

function weightedPick(ids: readonly number[], mode: "pool" | "winner") {
  const total = ids.reduce((sum, id) => sum + propWeight(id, mode), 0);
  if (total <= 0) return ids[0];
  let roll = Math.random() * total;
  for (const id of ids) {
    roll -= propWeight(id, mode);
    if (roll < 0) return id;
  }
  return ids.at(-1);
}

function createLotteryPool() {
  const remaining = availableShopPropIds();
  const result: number[] = [];
  while (remaining.length && result.length < 8) {
    const id = weightedPick(remaining, "pool");
    if (id === undefined) break;
    result.push(id);
    remaining.splice(remaining.indexOf(id), 1);
  }
  return result;
}

function createShop(matchKey: string) {
  const candidates = availableShopPropIds();
  const offers: ShopOffer[] = [];
  while (candidates.length && offers.length < 3) {
    const index = Math.floor(Math.random() * candidates.length);
    const [id] = candidates.splice(index, 1);
    if (id !== undefined) offers.push({ id, freeByAd: Math.random() < 0.1 });
  }
  return { matchKey, offers, lotteryIds: createLotteryPool(), lotteryUsed: false };
}

function grantProp(id: number) {
  if (id === 23) {
    economy.stamina = Math.min(30, economy.stamina + 10);
    showToast("行军丹已直接使用，体力 +10");
    return;
  }
  const existing = economy.ownedProps.find((entry) => entry.id === id);
  if (existing) {
    if (id === 22 && existing.level < 3) existing.level += 1;
  } else economy.ownedProps.push({ id, level: 1 });
  propLoadout = pruneLoadout(propLoadout);
  renderPropPicker();
  renderEconomy();
}

function renderShop() {
  const pending = economy.pendingShop;
  if (!pending) return;
  renderEconomy();
  get("shop-offers").innerHTML = pending.offers.map((offer, index) => {
    const prop = PROPS[offer.id]!;
    const price = propPrice(offer.id);
    const unavailable = offer.id === 23
      ? economy.stamina >= 30
      : offer.id === 22 ? ownedLevel(22) >= 3 : ownedLevel(offer.id) > 0;
    const disabled = Boolean(offer.claimed || unavailable || (!offer.freeByAd && economy.gold < price));
    const action = offer.claimed ? "已获得" : unavailable ? "已满级/已持有" : offer.freeByAd ? "直接领取（原广告）" : `${price} 金币购买`;
    return `<article class="shop-offer" style="--prop-color:${PROP_RARITY_COLORS[prop.rarity]}"><i>${prop.name[0]}</i><span>${PROP_RARITY_NAMES[prop.rarity]}</span><h3>${prop.name}${offer.id === 22 ? ` · 下一级${Math.min(3, ownedLevel(22) + 1)}` : ""}</h3><p>${prop.intro}</p><button type="button" data-buy-offer="${index}" ${disabled ? "disabled" : ""}>${action}</button></article>`;
  }).join("");
  get("lottery-slots").innerHTML = pending.lotteryIds.map((id, index) => {
    const prop = PROPS[id]!;
    const won = pending.lotteryUsed && pending.lotteryWinnerId === id;
    return `<span class="${won ? "is-winner" : ""}" style="--prop-color:${PROP_RARITY_COLORS[prop.rarity]}" data-lottery-index="${index}">${prop.name}</span>`;
  }).join("");
  get<HTMLButtonElement>("lottery-draw").disabled = pending.lotteryUsed || pending.lotteryIds.length === 0;
  get("lottery-draw").textContent = pending.lotteryUsed
    ? `已抽中：${PROPS[pending.lotteryWinnerId ?? -1]?.name ?? "道具"}` : "直接抽奖（原广告/分享）";
}

function showPostgame() {
  const overlay = get<HTMLElement>("postgame-overlay");
  const resultPane = get<HTMLElement>("result-pane");
  const shopPane = get<HTMLElement>("shop-pane");
  lobby.hidden = true;
  battleShell.hidden = false;
  overlay.hidden = false;
  if (economy.pendingResult) {
    const pending = economy.pendingResult;
    resultPane.hidden = false; shopPane.hidden = true;
    get("postgame-eyebrow").textContent = "战斗结算";
    get("postgame-title").textContent = pending.won ? "守城成功" : "阿斗失守";
    get("result-gold").textContent = String(pending.baseReward);
  } else if (economy.pendingShop) {
    resultPane.hidden = true; shopPane.hidden = false;
    get("postgame-eyebrow").textContent = "战后商店";
    get("postgame-title").textContent = "选取今日道具";
    renderShop();
  } else overlay.hidden = true;
}

function beginResult(next: MatchSnapshot) {
  const matchKey = `${next.roomId}:${next.seed}:${slot}`;
  shownFinishedKey = matchKey;
  if (economy.completedMatchKeys.includes(matchKey) || economy.pendingResult?.matchKey === matchKey || economy.pendingShop?.matchKey === matchKey) {
    showPostgame();
    return;
  }
  const won = next.winner === slot;
  economy.pendingResult = { matchKey, won, baseReward: won ? 20 : 5 };
  scheduleCloudSave(true);
  showPostgame();
}

function claimResult(multiplier: 1 | 2) {
  const result = economy.pendingResult;
  if (!result) return;
  economy.gold += result.baseReward * multiplier;
  if (result.won) economy.winDay += 1; else economy.loseDay += 1;
  economy.totalMatches += 1;
  economy.completedMatchKeys = [...economy.completedMatchKeys.filter((key) => key !== result.matchKey), result.matchKey].slice(-50);
  economy.pendingShop = createShop(result.matchKey);
  delete economy.pendingResult;
  renderEconomy();
  scheduleCloudSave(true);
  showPostgame();
}

function finishShopAndReturn() {
  delete economy.pendingShop;
  practice?.stop(); online?.close();
  practice = null; online = null; commandSink = null; snapshot = null; activeMode = null; loadoutSentKey = ""; shownFinishedKey = ""; roomPlayers = []; roomStarted = false;
  localStorage.removeItem(scopedStorageKey(ACTIVE_MODE_KEY));
  localStorage.removeItem(scopedStorageKey(PRACTICE_SAVE_KEY));
  localStorage.removeItem(scopedStorageKey(ONLINE_SESSION_KEY));
  get<HTMLElement>("postgame-overlay").hidden = true;
  hideUnitInspector();
  battleShell.hidden = true; lobby.hidden = false;
  renderEconomy(); renderPropPicker();
  scheduleCloudSave(true);
  window.scrollTo({ top: 0, behavior: "instant" });
  if (invitedRoom) void enterInvitedRoom();
}

function updateSnapshot(next: MatchSnapshot) {
  snapshot = next;
  roomStarted = activeMode === "online";
  get<HTMLElement>("match-ready-panel").hidden = true;
  const mine = next.players[slot]; const opponent = next.players[slot === 0 ? 1 : 0];
  get("my-buns").textContent = String(mine.buns);
  get("last-event").textContent = mine.lastEvent;
  get("map-title").textContent = MAP_LAYOUTS[next.mapIndex]?.name ?? "巨鹿";
  get("opponent-status").textContent = `${opponent.units.length} 部队 · 第 ${opponent.wave} 波`;
  get("wave").textContent = mine.phase === "preparing"
    ? `${Math.max(0, Math.ceil(mine.prepareMs / 1000))} 秒准备`
    : `${mine.wave} / ${GAME_CONFIG.maxWaves}`;
  game.events.emit("battle:snapshot", next, slot);
  renderActiveProps();
  const loadoutKey = `${next.roomId}:${slot}`;
  if (activeMode === "online" && !mine.props?.configured && loadoutSentKey !== loadoutKey) {
    loadoutSentKey = loadoutKey;
    commandSink?.({ type: "SET_PROP_LOADOUT", loadout: propLoadout, earlyAccountShovelBonus: receivesEarlyDailyShovels() });
  }
  savePractice();
  if (next.phase === "finished") {
    const finishKey = `${next.roomId}:${next.seed}:${slot}`;
    if (shownFinishedKey !== finishKey) beginResult(next);
  }
}

game.events.on("battle:recruit", () => commandSink?.({ type: "RECRUIT" }));
game.events.on("battle:inspect", (payload: { kind: string; level: number; unitId?: string; reserveId?: string; ownerSlot?: PlayerSlot }) => showUnitInspector(payload));
game.events.on("battle:inspect-hide", () => hideUnitInspector(false));
game.events.on("battle:prop-drop", (payload: ActivePropDropPayload) => {
  get("prop-target-hint").textContent = "按住道具，拖到高亮目标。";
  commandSink?.(commandForActivePropDrop(payload));
});
game.events.on("battle:prop-drop-miss", (payload: { propId: ActivePropId }) => {
  const instruction = activePropInstruction(payload.propId);
  get("prop-target-hint").textContent = instruction;
  showToast(`没有放到有效目标：${instruction}`);
});
game.events.on("battle:drop", (payload: BattleDropPayload) => {
  if (!snapshot || !commandSink) return;
  commandSink(commandForBattleDrop(payload));
});
game.events.on("battle:camp-drop", (payload: BattleCampDropPayload) => {
  if (!snapshot || !commandSink) return;
  commandSink(commandForBattleCampDrop(payload));
});

for (const pickerId of ["active-prop-picker", "passive-prop-picker"]) {
  get(pickerId).addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("select")) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-prop-id]");
    if (button) toggleProp(Number(button.dataset.propId));
  });
}
const activePropBar = get("active-prop-bar");
activePropBar.addEventListener("pointerdown", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-use-prop]");
  if (button) beginActivePropPointer(event, button);
});
document.addEventListener("pointermove", moveActivePropPointer, { passive: false });
document.addEventListener("pointerup", (event) => finishActivePropPointer(event));
document.addEventListener("pointercancel", (event) => finishActivePropPointer(event, true));
activePropBar.addEventListener("click", (event) => {
  if (suppressActivePropClick) { event.preventDefault(); return; }
  const supply = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-claim-shovels]");
  if (supply && !supply.disabled) { commandSink?.({ type: "CLAIM_SHOVEL_SUPPLY" }); return; }
  const bulldozer = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-claim-bulldozer]");
  if (bulldozer && !bulldozer.disabled) { commandSink?.({ type: "CLAIM_BULLDOZER_SUPPLY" }); return; }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-use-prop]");
  if (button && !button.disabled) useActiveProp(Number(button.dataset.useProp) as ActivePropId);
});
get("claim-normal").addEventListener("click", () => claimResult(1));
get("claim-double").addEventListener("click", () => claimResult(2));
get("shop-offers").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-buy-offer]");
  const pending = economy.pendingShop;
  if (!button || !pending) return;
  const offer = pending.offers[Number(button.dataset.buyOffer)];
  if (!offer || offer.claimed) return;
  const price = propPrice(offer.id);
  if (!offer.freeByAd && economy.gold < price) { showToast("金币不足"); return; }
  if (offer.id === 23 && economy.stamina >= 30) { showToast("体力已满"); return; }
  if (offer.id !== 23 && (offer.id === 22 ? ownedLevel(22) >= 3 : ownedLevel(offer.id) > 0)) return;
  if (!offer.freeByAd) economy.gold -= price;
  grantProp(offer.id);
  if (offer.id !== 23) offer.claimed = true;
  renderShop(); renderPropPicker();
  scheduleCloudSave(true);
});
get("lottery-draw").addEventListener("click", () => {
  const pending = economy.pendingShop;
  if (!pending || pending.lotteryUsed || !pending.lotteryIds.length) return;
  const winner = weightedPick(pending.lotteryIds, "winner");
  if (winner === undefined) return;
  pending.lotteryUsed = true; pending.lotteryWinnerId = winner;
  grantProp(winner);
  renderShop(); renderPropPicker();
  scheduleCloudSave(true);
});
get("shop-close").addEventListener("click", finishShopAndReturn);

get("practice").addEventListener("click", () => startPractice());
get("quick").addEventListener("click", () => void onlineAction("quick"));
get("create-room").addEventListener("click", () => void onlineAction("create"));
get("join-room").addEventListener("click", () => void onlineAction("join"));
document.querySelectorAll<HTMLButtonElement>("[data-copy-room-code]").forEach((button) => {
  button.addEventListener("click", () => {
    const code = currentRoomCode();
    if (code) void copyRoomText(code, `房间号 ${code} 已复制`);
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-copy-room-link]").forEach((button) => {
  button.addEventListener("click", () => {
    const code = currentRoomCode();
    if (code) void copyRoomText(createRoomInviteUrl(location.href, code), "邀请链接已复制，好友打开后直接进入");
  });
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
get("unit-inspector-close").addEventListener("click", () => hideUnitInspector());
get<HTMLButtonElement>("match-ready").addEventListener("click", async () => {
  if (!online || activeMode !== "online" || snapshot) return;
  const button = get<HTMLButtonElement>("match-ready");
  button.disabled = true;
  button.textContent = "正在确认…";
  try {
    const result = await online.ready();
    if (!result.ok) throw new Error(result.message ?? "准备失败");
    const mine = roomPlayers.find((player) => player.slot === slot);
    if (mine) mine.ready = true;
    renderReadyState();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "准备状态提交失败");
    renderReadyState();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (activePropPointer) {
    const pointerId = activePropPointer.gesture.pointerId;
    finishActivePropPointer(new PointerEvent("pointercancel", { pointerId }), true);
  }
  hideUnitInspector();
});
get("exit-match").addEventListener("click", async () => {
  practice?.stop(); online?.close();
  practice = null; online = null; commandSink = null; snapshot = null; activeMode = null; roomStarted = false;
  loadoutSentKey = "";
  roomPlayers = [];
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
  lobbyNote.textContent = "创建房间后把6位房号发给好友，也可以直接随机匹配。";
  window.scrollTo({ top: 0, behavior: "instant" });
});

type SavedOnlineSession = { roomId?: string; token?: string };

function readSavedOnlineSession() {
  try {
    return JSON.parse(localStorage.getItem(scopedStorageKey(ONLINE_SESSION_KEY)) ?? "null") as SavedOnlineSession | null;
  } catch { return null; }
}

async function resumeOnlineSession(saved: SavedOnlineSession): Promise<boolean> {
  try {
    if (!saved.roomId || !saved.token) throw new Error("没有可恢复的房间凭证");
    online = createOnlineClient(); bindOnline(online);
    const result = await online.resume(saved.roomId, saved.token);
    if (!result.ok || result.slot === undefined || !result.roomId) throw new Error(result.message ?? "房间已失效");
    slot = result.slot; activeMode = "online"; commandSink = (command) => online?.send(command);
    enterBattle("真人房间 · 已重连", true);
    get("room-banner").hidden = false; renderRoomId(result.roomId);
    get("last-event").textContent = "已恢复原房间进度";
    renderReadyState();
    return true;
  } catch (error) {
    online?.close();
    online = null;
    lobbyNote.textContent = `原房间暂时无法恢复，重连凭证和最近快照已保留：${error instanceof Error ? error.message : "未知错误"}`;
    return false;
  }
}

async function enterInvitedRoom(): Promise<boolean> {
  if (!invitedRoom) return false;
  get<HTMLInputElement>("room-code").value = invitedRoom;
  const saved = readSavedOnlineSession();
  const entered = saved?.roomId?.toUpperCase() === invitedRoom
    ? await resumeOnlineSession(saved)
    : await onlineAction("join");
  if (entered) {
    history.replaceState(history.state, "", removeRoomInviteFromUrl(location.href));
    invitedRoom = null;
  }
  return entered;
}

async function restoreActiveSession(remoteProgress: CloudProgress | null): Promise<boolean> {
  const localSave = readPracticeSave();
  const remoteSave = remoteProgress?.practiceSnapshot
    ? { savedAt: remoteProgress.savedAt, snapshot: remoteProgress.practiceSnapshot }
    : null;
  const newestPractice = remoteSave && (!localSave || remoteSave.savedAt >= localSave.savedAt) ? remoteSave : localSave;
  const mode = remoteProgress?.activeMode ?? localStorage.getItem(scopedStorageKey(ACTIVE_MODE_KEY));
  if (mode === "practice") {
    if (newestPractice) { startPractice(newestPractice.snapshot); return true; }
    localStorage.removeItem(scopedStorageKey(ACTIVE_MODE_KEY));
  }
  if (mode !== "online") return false;
  return resumeOnlineSession(readSavedOnlineSession() ?? {});
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
  const remoteDayKey = profile.progress?.economy?.dayKey;
  economy = normalizeEconomy(profile.progress?.economy);
  try {
    const local = JSON.parse(localStorage.getItem(scopedStorageKey(PROP_LOADOUT_KEY)) ?? "null");
    propLoadout = pruneLoadout(normalizeStoredLoadout(profile.progress?.propLoadout ?? local));
  } catch { propLoadout = pruneLoadout(normalizeStoredLoadout(profile.progress?.propLoadout)); }
  renderPropPicker();
  renderActiveProps();
  renderEconomy();
  get("player-name").textContent = profile.username;
  setCloudStatus("云端已连接", "ok");
  authScreen.hidden = true;
  lobby.hidden = false;
  if (remoteDayKey !== economy.dayKey) scheduleCloudSave(true);
  if (economy.pendingResult || economy.pendingShop) { showPostgame(); return; }
  if (invitedRoom) {
    await enterInvitedRoom();
    return;
  }
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

if (invitedRoom) {
  get<HTMLInputElement>("room-code").value = invitedRoom;
  get("auth-message").textContent = `已识别房间 ${invitedRoom}，登录后将自动加入。`;
}

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

if (interactionTestMode) {
  propLoadout = { active: [8, 5], passive: [] };
  authScreen.hidden = true;
  lobby.hidden = false;
  game.events.once("battle:scene-ready", () => {
    practice?.stop();
    if (practice) updateSnapshot(practice.snapshot);
  });
  startPractice();
} else {
  void initializeAuth();
}
