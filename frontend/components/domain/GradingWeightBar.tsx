import React from "react";

export type AssessmentItem = {
  name: string;
  weight: number;
};

export type GradingWeightBarProps = {
  items: AssessmentItem[];
  maxTotal?: number;
  className?: string;
};

const PALETTE = ["#4F46E5", "#165AF6", "#059669", "#D97706", "#7C3AED", "#EA580C"];

export function GradingWeightBar({
  items,
  maxTotal = 100,
  className = "",
}: GradingWeightBarProps) {
  const total = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const isValid = total === maxTotal;
  const isOver = total > maxTotal;
  const isUnder = total < maxTotal;

  return (
    <div className={`flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg ${className}`}>
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-slate-700">Assessment Weight Distribution</span>
        <div className="flex items-center gap-1.5 font-mono">
          <span>Total:</span>
          <span
            className={`font-bold px-1.5 py-0.5 rounded text-xs ${
              isValid
                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                : isOver
                ? "bg-rose-100 text-rose-800 border border-rose-300"
                : "bg-amber-100 text-amber-800 border border-amber-300"
            }`}
          >
            {total}% / {maxTotal}%
          </span>
        </div>
      </div>

      {/* Progress Stacked Bar */}
      <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden flex">
        {items.map((item, idx) => {
          const weight = Number(item.weight) || 0;
          if (weight <= 0) return null;
          const pct = Math.min((weight / maxTotal) * 100, 100);
          return (
            <div
              key={idx}
              style={{
                width: `${pct}%`,
                backgroundColor: PALETTE[idx % PALETTE.length],
              }}
              className="h-full transition-all duration-300 relative group"
              title={`${item.name || "Assessment"}: ${weight}%`}
            />
          );
        })}
      </div>

      {/* Legend & Status feedback */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-slate-600">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
              />
              <span>{item.name || `Item ${idx + 1}`}: <strong className="font-mono text-slate-900">{item.weight || 0}%</strong></span>
            </div>
          ))}
        </div>

        <div>
          {isValid ? (
            <span className="text-emerald-700 font-semibold text-xs flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Balanced (100%)
            </span>
          ) : isOver ? (
            <span className="text-rose-700 font-semibold text-xs flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Exceeds {maxTotal}% by {total - maxTotal}% — cannot save
            </span>
          ) : (
            <span className="text-amber-700 font-semibold text-xs flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Needs {maxTotal - total}% more to reach {maxTotal}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
