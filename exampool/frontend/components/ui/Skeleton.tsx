import React from "react";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width = "100%", height = "100%", borderRadius = "var(--radius-sm)", className = "", style }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className} ${styles.skeletonComponent}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius,
        ...style,
      }}
    />
  );
}
