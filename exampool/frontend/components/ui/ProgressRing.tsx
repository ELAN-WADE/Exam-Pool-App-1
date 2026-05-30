import React, { useEffect, useState } from "react";

interface ProgressRingProps {
  radius: number;
  stroke: number;
  progress: number;
  color?: string;
  backgroundColor?: string;
}

export function ProgressRing({ radius, stroke, progress, color = "var(--color-primary)", backgroundColor = "var(--color-surface-3)" }: ProgressRingProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (animatedProgress / 100) * circumference;

  useEffect(() => {
    // Animate to target progress on mount
    const timeout = setTimeout(() => {
      setAnimatedProgress(progress);
    }, 100);
    return () => clearTimeout(timeout);
  }, [progress]);

  return (
    <svg height={radius * 2} width={radius * 2} style={{ transform: "rotate(-90deg)" }}>
      <circle
        stroke={backgroundColor}
        fill="transparent"
        strokeWidth={stroke}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
      <circle
        stroke={color}
        fill="transparent"
        strokeWidth={stroke}
        strokeDasharray={circumference + " " + circumference}
        style={{ strokeDashoffset, transition: "stroke-dashoffset 1s var(--ease)" }}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
        strokeLinecap="round"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="var(--color-text)"
        fontSize={radius * 0.5}
        fontWeight="bold"
        style={{ transform: "rotate(90deg) translate(0px, -2px)", transformOrigin: "center" }}
      >
        {Math.round(animatedProgress)}%
      </text>
    </svg>
  );
}
