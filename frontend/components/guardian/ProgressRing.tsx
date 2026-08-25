"use client";

import { useEffect, useState } from "react";

type Props = {
  value: number;       // 0–100
  size?: number;       // px
  strokeWidth?: number; // px
  label?: string;
  showValue?: boolean;
  color?: string;
  trackColor?: string;
};

export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 5,
  label,
  showValue = true,
  color = "var(--g-primary, #6366F1)",
  trackColor = "var(--g-border, #E2E8F0)",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const getColor = (score: number) => {
    if (score >= 70) return "#10B981"; // success
    if (score >= 50) return "#F59E0B"; // warning
    return "#EF4444"; // danger
  };

  const resolvedColor = color === "var(--g-primary, #6366F1)" ? getColor(clamped) : color;

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={mounted ? offset : circumference}
          style={{
            transition: `stroke-dashoffset 600ms var(--g-ease, cubic-bezier(0.4,0,0.2,1))`,
          }}
        />
      </svg>
      {showValue && (
        <span
          style={{
            fontSize: size > 56 ? "0.9375rem" : "0.8125rem",
            fontWeight: 700,
            fontFamily: "var(--g-font-mono, monospace)",
            color: "var(--g-text, #0F172A)",
            lineHeight: 1,
            marginTop: "-0.25rem",
            letterSpacing: "-0.02em",
          }}
        >
          {clamped.toFixed(0)}%
        </span>
      )}
      {label && (
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 500,
            color: "var(--g-muted, #64748B)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            lineHeight: 1,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
