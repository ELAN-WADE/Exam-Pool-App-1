"use client";

import React, { useEffect, useRef } from "react";

interface ConfettiProps {
  trigger?: boolean;
  durationMs?: number;
  particleCount?: number;
  onComplete?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  shape: "rect" | "circle" | "star" | "strip";
  wobble: number;
  wobbleSpeed: number;
}

const COLORS = [
  "#3B82F6", // Electric Blue
  "#10B981", // Emerald
  "#F59E0B", // Bright Amber/Gold
  "#F43F5E", // Vibrant Rose/Coral
  "#8B5CF6", // Violet
  "#06B6D4", // Cyan
  "#EC4899", // Pink
];

export function ConfettiCelebration({
  trigger = true,
  durationMs = 4500,
  particleCount = 120,
  onComplete,
}: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!trigger) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas
    const width = (canvas.width = window.innerWidth);
    const height = (canvas.height = window.innerHeight);

    const particles: Particle[] = [];
    const shapes: ("rect" | "circle" | "star" | "strip")[] = ["rect", "circle", "star", "strip"];

    // Initialize 2 origin bursts (left and right cannon)
    for (let i = 0; i < particleCount; i++) {
      const fromLeft = i % 2 === 0;
      const originX = fromLeft ? width * 0.15 : width * 0.85;
      const originY = height * 0.85;

      const angle = fromLeft
        ? -Math.PI / 4 + (Math.random() - 0.5) * 0.6
        : (-3 * Math.PI) / 4 + (Math.random() - 0.5) * 0.6;
      const speed = 18 + Math.random() * 22;

      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 4,
        vy: Math.sin(angle) * speed - Math.random() * 6,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: shapes[Math.floor(Math.random() * shapes.length)],
        wobble: Math.random() * 10,
        wobbleSpeed: 0.05 + Math.random() * 0.08,
      });
    }

    const startTime = performance.now();
    const gravity = 0.42;
    const drag = 0.985;

    const render = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      ctx.clearRect(0, 0, width, height);

      let aliveCount = 0;

      for (const p of particles) {
        // Physics update
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx + Math.sin(p.wobble) * 1.5;
        p.y += p.vy;
        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotationSpeed;

        if (progress > 0.65) {
          p.opacity = Math.max(0, 1 - (progress - 0.65) / 0.35);
        }

        if (p.y < height + 40 && p.opacity > 0) {
          aliveCount++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;

          if (p.shape === "rect") {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          } else if (p.shape === "strip") {
            ctx.fillRect(-p.size / 4, -p.size, p.size / 2, p.size * 2);
          } else if (p.shape === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.shape === "star") {
            ctx.beginPath();
            for (let s = 0; s < 5; s++) {
              ctx.lineTo(
                Math.cos(((18 + s * 72) * Math.PI) / 180) * (p.size * 0.8),
                -Math.sin(((18 + s * 72) * Math.PI) / 180) * (p.size * 0.8)
              );
              ctx.lineTo(
                Math.cos(((54 + s * 72) * Math.PI) / 180) * (p.size * 0.4),
                -Math.sin(((54 + s * 72) * Math.PI) / 180) * (p.size * 0.4)
              );
            }
            ctx.closePath();
            ctx.fill();
          }

          ctx.restore();
        }
      }

      if (progress < 1 && aliveCount > 0) {
        animationFrameRef.current = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, width, height);
        if (onComplete) onComplete();
      }
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [trigger, durationMs, particleCount, onComplete]);

  if (!trigger) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
