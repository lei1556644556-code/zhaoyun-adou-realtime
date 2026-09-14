import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OperationsMetricsSnapshot, OperationsRoomState, OperationsRoomSummary } from "@adou/shared";
import { AdminApiError, streamMetrics } from "./api";
import { formatBytes, formatClock, formatDuration, formatInteger, formatRate } from "./format";
import { Icon, type IconName } from "./icons";
import { TrendChart } from "./TrendChart";

const TOKEN_KEY = "adou.admin.token";
type ConnectionState = "connecting" | "live" | "retrying";
type RoomFilter = "all" | OperationsRoomState;

const ROOM_LABELS: Record<OperationsRoomState, string> = {
  waiting: "等待",
  ready: "准备",
  battle: "对战中",
  finished: "已结束",
};

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  });
}

function MetricCard({ icon, label, value, detail }: { icon: IconName; label: string; value: string; detail: string }) {
  return <article className="metric-card"><Icon name={icon}/><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function StatusDot({ tone = "good" }: { tone?: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

function Login({ message, onLogin }: { message: string; onLogin: (value: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onLogin(value.trim());
  };
  return <main className="login-shell">
    <form className="login-panel" onSubmit={submit}>
      <Icon name="lock" className="login-icon"/>
      <h1>赵云与阿斗 · 实时运维</h1>
      <p>输入服务器配置的运维令牌</p>
      <label htmlFor="admin-token">运维令牌</label>
      <input id="admin-token" type="password" autoComplete="current-password" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
      {message && <div className="login-error" role="alert">{message}</div>}
      <button type="submit">进入后台</button>
    </form>
  </main>;
}

function HealthPanel({ metrics }: { metrics: OperationsMetricsSnapshot }) {
  const lag = metrics.health.eventLoopDelayMs;
  const lagTone: "good" | "warn" | "bad" = lag >= 250 ? "bad" : lag >= 100 ? "warn" : "good";
  const rows = [
    { label: "运行时长", value: formatDuration(metrics.health.uptimeMs), tone: "good" as const },
    { label: "事件循环延迟", value: `${lag.toFixed(1)} ms`, tone: lagTone },
    { label: "内存", value: `${formatBytes(metrics.health.heapUsedBytes)} / ${formatBytes(metrics.health.rssBytes)}`, tone: "good" as const },
    { label: "数据库持久化", value: metrics.health.persistenceEnabled ? "已启用" : "未配置", tone: metrics.health.persistenceEnabled ? "good" as const : "warn" as const },
    { label: "认证", value: metrics.health.authenticationRequired ? "已启用" : "开发模式", tone: metrics.health.authenticationRequired ? "good" as const : "warn" as const },
  ];
  return <aside className="health-panel" aria-labelledby="health-title">
    <header className="panel-heading"><h2 id="health-title">服务器健康</h2><span className={`health-state ${metrics.health.status}`}><StatusDot tone={metrics.health.status === "healthy" ? "good" : "warn"}/>{metrics.health.status === "healthy" ? "整体正常" : "需要关注"}</span></header>
    <dl>{rows.map((row) => <div key={row.label}><dt><StatusDot tone={row.tone}/>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <footer>协议 v{metrics.health.protocolVersion} · 规则 {metrics.health.rulesetVersion} · {metrics.health.nodeVersion}</footer>
  </aside>;
}

function RoomDetails({ room, onClose }: { room: OperationsRoomSummary | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [room?.roomId]);
  if (!room) return <aside className="room-details empty"><h2>房间详情</h2><p>选择一条房间记录查看双方状态。</p></aside>;
  const copy = async () => {
    await navigator.clipboard.writeText(room.roomId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <aside className="room-details" aria-label={`房间 ${room.roomId} 详情`}>
    <div className="sheet-handle" aria-hidden="true" />
    <header><div><span>房间详情</span><h2>{room.roomId}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭房间详情"><Icon name="close"/></button></header>
    <div className="room-detail-state"><span><StatusDot tone={room.state === "battle" ? "good" : room.state === "finished" ? "neutral" : "warn"}/>{ROOM_LABELS[room.state]}</span><button className="copy-button" onClick={() => void copy()}><Icon name="copy"/>{copied ? "已复制" : "复制房号"}</button></div>
    <div className="detail-stats"><div><span>房间时长</span><strong>{formatDuration(room.ageMs)}</strong></div><div><span>当前波次</span><strong>{room.wave ?? "—"}</strong></div><div><span>最后活动</span><strong>{formatClock(room.updatedAt)}</strong></div></div>
    <h3>玩家状态</h3>
    <div className="player-list">{room.players.length ? room.players.map((player) => <div key={player.slot}><strong>{player.name}</strong><span><StatusDot tone={player.connected ? "good" : "bad"}/>{player.connected ? "在线" : "离线"}</span><span><StatusDot tone={player.ready ? "good" : "neutral"}/>{player.ready ? "已准备" : "未准备"}</span></div>) : <p>尚无玩家进入</p>}</div>
  </aside>;
}

function RoomTable({ rooms, selectedId, onSelect }: { rooms: OperationsRoomSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className="room-table-wrap"><table className="room-table"><thead><tr><th>房号</th><th>状态</th><th>玩家</th><th>在线</th><th>波次</th><th>时长</th><th>最后活动</th></tr></thead><tbody>{rooms.map((room) => <tr key={room.roomId} className={selectedId === room.roomId ? "selected" : ""} onClick={() => onSelect(room.roomId)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(room.roomId); }}><td><strong>{room.roomId}</strong></td><td><span className={`room-state ${room.state}`}><StatusDot tone={room.state === "battle" ? "good" : room.state === "finished" ? "neutral" : "warn"}/>{ROOM_LABELS[room.state]}</span></td><td>{room.players.map((player) => player.name).join(" · ") || "—"}</td><td>{room.connectedPlayers} / {room.playerCount || 2}</td><td>{room.wave ?? "—"}</td><td>{formatDuration(room.ageMs)}</td><td>{formatClock(room.updatedAt)}</td></tr>)}</tbody></table>{rooms.length === 0 && <div className="table-empty">当前筛选条件下没有房间</div>}</div>;
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [loginMessage, setLoginMessage] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [metrics, setMetrics] = useState<OperationsMetricsSnapshot | null>(null);
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const run = async () => {
      while (!controller.signal.aborted) {
        setConnection("connecting");
        try {
          await streamMetrics(token, (next) => { setMetrics(next); setConnection("live"); }, controller.signal);
          if (!controller.signal.aborted) throw new Error("实时连接已断开");
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof AdminApiError && (error.status === 401 || error.status === 503)) {
            sessionStorage.removeItem(TOKEN_KEY);
            setLoginMessage(error.message);
            setMetrics(null);
            setToken("");
            return;
          }
          setConnection("retrying");
          await delay(2_000, controller.signal);
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [token]);

  const filteredRooms = useMemo(() => {
    if (!metrics) return [];
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return metrics.roomDetails.filter((room) => (filter === "all" || room.state === filter)
      && (!normalized || room.roomId.toLowerCase().includes(normalized)
        || room.players.some((player) => player.name.toLocaleLowerCase("zh-CN").includes(normalized))));
  }, [filter, metrics, query]);
  const selectedRoom = metrics?.roomDetails.find((room) => room.roomId === selectedId) ?? null;

  if (!token) return <Login message={loginMessage} onLogin={(value) => { sessionStorage.setItem(TOKEN_KEY, value); setLoginMessage(""); setToken(value); }} />;
  if (!metrics) return <main className="loading-shell"><div className="loading-mark"/><h1>赵云与阿斗 · 实时运维</h1><p>{connection === "retrying" ? "连接中断，正在重试" : "正在连接权威服务器"}</p><button onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }}>返回</button></main>;

  const metricCards = [
    { icon: "users" as const, label: "在线人数", value: formatInteger(metrics.onlineUsers), detail: `${metrics.socketConnections} 个连接` },
    { icon: "rooms" as const, label: "房间总数", value: formatInteger(metrics.rooms.total), detail: `${metrics.seatedOnlinePlayers} 人在房间` },
    { icon: "battle" as const, label: "对战中", value: formatInteger(metrics.rooms.battle), detail: `${metrics.totals.matchesStarted} 局已开战` },
    { icon: "wait" as const, label: "等待中", value: formatInteger(metrics.rooms.waiting), detail: `${metrics.rooms.ready} 间准备中` },
    { icon: "command" as const, label: "每分钟指令", value: formatRate(metrics.traffic.commandsPerMinute), detail: `拒绝率 ${(metrics.traffic.commandRejectRate * 100).toFixed(1)}%` },
    { icon: "traffic" as const, label: "估算下行流量", value: formatBytes(metrics.traffic.estimatedOutboundBytesPerMinute), detail: "应用层 / 分钟" },
  ];

  return <div className="app-shell">
    <header className="topbar"><h1>赵云与阿斗 · 实时运维</h1><div className="topbar-actions"><span className={`connection-state ${connection}`}><StatusDot tone={connection === "live" ? "good" : "warn"}/>{connection === "live" ? "实时" : "重连中"}</span><span>最后刷新 {formatClock(metrics.generatedAt)}</span><button className="lock-button" onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setMetrics(null); setToken(""); }}><Icon name="lock"/>锁定</button></div></header>
    <main>
      <section className="metric-grid" aria-label="核心实时指标">{metricCards.map((card) => <MetricCard key={card.label} {...card}/>)}</section>
      <div className="overview-grid"><div className="trend-column"><TrendChart points={metrics.history}/><div className="traffic-strip"><h3>流量诊断</h3><div><span>重同步 / 分</span><strong>{formatRate(metrics.traffic.resyncsPerMinute)}</strong></div><div><span>快照投递 / 分</span><strong>{formatRate(metrics.traffic.checkpointsPerMinute)}</strong></div><div><span>累计估算下行</span><strong>{formatBytes(metrics.totals.estimatedOutboundBytes)}</strong></div><div><span>断开连接</span><strong>{metrics.totals.disconnects}</strong></div></div></div><HealthPanel metrics={metrics}/></div>
      <section className={`rooms-panel ${selectedRoom ? "has-selection" : ""}`} aria-labelledby="rooms-title">
        <div className="rooms-main"><header className="rooms-toolbar"><h2 id="rooms-title">房间状态</h2><div className="filter-rail" role="group" aria-label="房间状态筛选">{(["all", "waiting", "ready", "battle", "finished"] as RoomFilter[]).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setSelectedId(null); }}>{value === "all" ? "全部" : ROOM_LABELS[value]}</button>)}</div><label className="search-box"><Icon name="search"/><span className="sr-only">搜索房号或玩家</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索房号或玩家"/></label><span className="room-count">共 {filteredRooms.length} 个房间</span></header><RoomTable rooms={filteredRooms} selectedId={selectedId} onSelect={setSelectedId}/></div>
        <RoomDetails room={selectedRoom} onClose={() => setSelectedId(null)}/>
      </section>
    </main>
  </div>;
}
