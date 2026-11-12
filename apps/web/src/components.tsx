import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Inbox, RefreshCw, X } from "lucide-react";
import {
  stageLabels,
  type Stage,
} from "../../../packages/core/src/contracts.ts";

export const formatMoney = (minor: string, currency = "INR") => {
  const amount = BigInt(minor),
    sign = amount < 0n ? "-" : "",
    absolute = amount < 0n ? -amount : amount;
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "AED ";
  return `${sign}${symbol}${new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US").format(absolute / 100n)}${absolute % 100n ? `.${(absolute % 100n).toString().padStart(2, "0")}` : ""}`;
};
export const dateLabel = (date: string, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(date));
export const timeLabel = (date: string, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(date));
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-icon">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M8 24V8h8a6 6 0 0 1 0 12h-4m5-4 8 8M11 12v8" />
        </svg>
      </span>
      {!compact && (
        <span>
          RevenuePilot<span className="brand-ai">AI</span>
        </span>
      )}
    </div>
  );
}
export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`stage-badge stage-${stage}`}>
      <i />
      {stageLabels[stage]}
    </span>
  );
}
export function Channel({ name }: { name: string }) {
  const mono =
    name === "Meta Ads"
      ? "m"
      : name === "Google Ads"
        ? "G"
        : name === "YouTube Ads"
          ? "▶"
          : name === "Organic"
            ? "↗"
            : name === "Referral"
              ? "↔"
              : "·";
  return (
    <span className="channel">
      <span
        className={`channel-icon channel-${name.split(" ")[0].toLowerCase()}`}
      >
        {mono}
      </span>
      {name}
    </span>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="error-box">
      {message}
      {retry && (
        <button
          className="btn btn-sm btn-outline-secondary ms-3"
          onClick={retry}
        >
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-block" role="status">
      <div className="spinner-border text-primary spinner-border-sm" /> Loading
      your workspace…
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      d.close();
    };
  }, []);
  return (
    <dialog ref={ref} className="rp-dialog" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field-label">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <article className={`metric-card ${accent ? "accent" : ""}`}>
      <div className="metric-title">
        {label}
        <span>{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}
export function MoneyType({ kind }: { kind: string }) {
  return (
    <span className={kind === "capture" ? "text-teal" : "text-amber"}>
      {kind === "capture" ? (
        <ArrowDownLeft size={15} />
      ) : (
        <ArrowUpRight size={15} />
      )}{" "}
      {kind === "capture" ? "Receipt" : "Refund"}
    </span>
  );
}
export function TrendChart({
  points,
  metric,
}: {
  points: { date: string; leads: number; enrolled: number }[];
  metric: "leads" | "enrolled";
}) {
  const max = Math.max(4, ...points.map((p) => p[metric])),
    top = Math.ceil(max / 4) * 4,
    w = 720,
    h = 205;
  const coordinates = points.map((p, i) => [
    42 + (i * (w - 70)) / Math.max(1, points.length - 1),
    h - 26 - (p[metric] / top) * (h - 50),
  ]);
  const line = coordinates
    .map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`)
    .join(" ");
  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${w} ${h + 20}`}
      role="img"
      aria-label={`${metric === "leads" ? "New leads" : "Currently enrolled leads by acquisition date"} over ${points.length} days. Total ${points.reduce((n, p) => n + p[metric], 0)}.`}
    >
      <defs>
        <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8672e2" stopOpacity=".22" />
          <stop offset="100%" stopColor="#8672e2" stopOpacity=".015" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = h - 26 - (i / 4) * (h - 50);
        return (
          <g key={i}>
            <line
              x1="42"
              x2={w - 28}
              y1={y}
              y2={y}
              stroke="#e9ebf2"
              strokeDasharray="3 4"
            />
            <text x="12" y={y + 4}>
              {(top * i) / 4}
            </text>
          </g>
        );
      })}
      {coordinates.length > 0 && (
        <>
          <path
            d={`${line} L${coordinates.at(-1)![0]},${h - 26} L42,${h - 26} Z`}
            fill="url(#area-fill)"
          />
          <path
            d={line}
            stroke="#7863d8"
            fill="none"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </>
      )}
      {points
        .filter(
          (_, i) =>
            i === 0 ||
            i === points.length - 1 ||
            i % Math.max(1, Math.floor(points.length / 5)) === 0,
        )
        .map((p) => {
          const i = points.indexOf(p);
          return (
            <text
              key={p.date}
              x={coordinates[i][0]}
              y={h + 8}
              textAnchor="middle"
            >
              {dateLabel(p.date, "UTC")}
            </text>
          );
        })}
    </svg>
  );
}
