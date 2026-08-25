"use client";

import React from "react";
import { SparklesIcon, CrownIcon } from "../icons/Icons";

export interface ActiveGoldBadgeProps {
  type?: "session" | "term" | "custom";
  label?: string;
  size?: "sm" | "md" | "lg";
  glowing?: boolean;
  showDot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ActiveGoldBadge({
  type = "session",
  label,
  size = "sm",
  glowing = true,
  showDot = true,
  icon,
  className = "",
  style = {},
}: ActiveGoldBadgeProps) {
  const defaultLabel =
    label ||
    (type === "session"
      ? "Active Session"
      : type === "term"
      ? "Active Term"
      : "Active");

  const isSmall = size === "sm";
  const isLarge = size === "lg";

  const padding = isSmall
    ? "0.15rem 0.5rem"
    : isLarge
    ? "0.35rem 0.85rem"
    : "0.22rem 0.65rem";
  const fontSize = isSmall ? "0.65rem" : isLarge ? "0.8125rem" : "0.72rem";
  const iconSize = isSmall ? 10 : isLarge ? 14 : 12;

  const defaultIcon =
    icon !== undefined ? (
      icon
    ) : type === "session" ? (
      <CrownIcon width={iconSize} height={iconSize} />
    ) : (
      <SparklesIcon width={iconSize} height={iconSize} />
    );

  return (
    <span
      className={`gold-active-badge ${glowing ? "gold-active-badge-glowing" : ""} ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isSmall ? "0.3rem" : "0.4rem",
        fontSize,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding,
        borderRadius: "9999px",
        background: "var(--color-gold-bg, rgba(234, 179, 8, 0.10))",
        border: "1px solid var(--color-gold-border, rgba(202, 138, 4, 0.35))",
        color: "var(--color-gold-text, #B45309)",
        boxShadow: glowing
          ? "0 0 12px rgba(234, 179, 8, 0.22), 0 1px 3px rgba(234, 179, 8, 0.08)"
          : "0 1px 2px rgba(234, 179, 8, 0.08)",
        lineHeight: 1.2,
        userSelect: "none",
        ...style,
      }}
    >
      {showDot && (
        <span
          style={{
            width: isSmall ? 5 : 6,
            height: isSmall ? 5 : 6,
            borderRadius: "50%",
            background: "var(--color-gold, #EAB308)",
            boxShadow: "0 0 6px rgba(234, 179, 8, 0.8)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
      )}
      {defaultIcon && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-gold-dark, #CA8A04)",
            flexShrink: 0,
          }}
        >
          {defaultIcon}
        </span>
      )}
      <span>{defaultLabel}</span>
    </span>
  );
}
