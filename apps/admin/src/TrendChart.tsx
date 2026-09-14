import { useMemo, useState } from "react";
import type { OperationsHistoryPoint } from "@adou/shared";
import { formatBytes, formatClock, formatRate } from "./format";

interface Series {
  key: "onlineUsers" | "battles" | "commandsPerMinute";
  label: string;
  color: string;
}

const SERIES: Series[] = [
  { key: "onlineUsers", label: "在线人数", color: "#15935b" },
  { key: "battles", label: "对战中", color: "#9b7132" },
  { key: "commandsPerMinute", label: "每分钟指令", color: "#3978c8" },
];

export function TrendChart({ points }: { points: OperationsHistoryPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chart = useMemo(() => {
    const width = 920;
    const height = 258;
    const left = 48;
    const right = 20;
    const top = 20;
    const bottom = 38;
    const max = Math.max(1, ...points.flatMap((point) => [point.onlineUsers, point.battles, point.commandsPerMinute]));
    const x = (index: number) => left + (index / Math.max(1, points.length - 1)) * (width - left - right);
    const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
    const path = (key: Series["key"]) => points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
    return { width, height, left, right, top, bottom, max, x, y, path };
  }, [points]);

  const active = activeIndex === null ? null : points[activeIndex];
  const tickIndexes = [...new Set(points.length <= 1
    ? [0]
    : [0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <section className="trend-panel" aria-labelledby="trend-title">
      <header className="panel-heading trend-heading">
        <h2 id="trend-title">近60分钟趋势</h2>
        <div className="chart-legend" aria-label="图例">
          {SERIES.map((series) => <span key={series.key}><i style={{ background: series.color }} />{series.label}</span>)}
        </div>
      </header>
      <div className="chart-wrap">
        {points.length < 2 && <div className="chart-empty">正在等待足够的实时采样</div>}
        <svg className="trend-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="在线人数、对战中房间和每分钟指令趋势">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = chart.top + ratio * (chart.height - chart.top - chart.bottom);
            const value = Math.round(chart.max * (1 - ratio));
            return <g key={ratio}><line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className="grid-line"/><text x={chart.left - 10} y={y + 4} textAnchor="end">{value}</text></g>;
          })}
          {SERIES.map((series) => <path key={series.key} d={chart.path(series.key)} stroke={series.color} className="series-line" />)}
          {points.map((point, index) => (
            <rect
              key={point.at}
              x={chart.x(index) - Math.max(4, (chart.width - chart.left - chart.right) / Math.max(1, points.length) / 2)}
              y={chart.top}
              width={Math.max(8, (chart.width - chart.left - chart.right) / Math.max(1, points.length))}
              height={chart.height - chart.top - chart.bottom}
              fill="transparent"
              tabIndex={0}
              aria-label={`${formatClock(point.at)}，在线${point.onlineUsers}人，对战${point.battles}间，每分钟${formatRate(point.commandsPerMinute)}条指令`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            />
          ))}
          {tickIndexes.map((index) => points[index] && <text key={index} x={chart.x(index)} y={chart.height - 10} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{formatClock(points[index]!.at).slice(0, 5)}</text>)}
          {active && activeIndex !== null && (
            <g className="chart-tooltip" transform={`translate(${Math.min(chart.width - 182, Math.max(chart.left, chart.x(activeIndex) - 82))},${chart.top + 8})`}>
              <rect width="174" height="78" rx="6" />
              <text x="12" y="19">{formatClock(active.at)}</text>
              <text x="12" y="39">在线 {active.onlineUsers} · 对战 {active.battles}</text>
              <text x="12" y="59">指令 {formatRate(active.commandsPerMinute)}/分</text>
              <text x="12" y="75">下行 {formatBytes(active.estimatedOutboundBytesPerMinute)}/分</text>
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
