"use client";

import { useEffect, useRef, useState } from "react";

export function Scratchpad({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const [color, setColor] = useState("#0F172A");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    if ("changedTouches" in e && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX - rect.left, y: e.changedTouches[0].clientY - rect.top };
    }
    if ("clientX" in e) {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    return null;
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const coords = getCoords(e);
    if (!coords) return;

    ctx.strokeStyle = color;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const coords = getCoords(e);
    if (!coords) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    draw(e);
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.beginPath();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const rect = canvas.getBoundingClientRect();
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.beginPath();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "84vw",
        maxWidth: "820px",
        height: "72vh",
        background: "#FFFFFF",
        borderRadius: "14px",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9999,
        border: "1px solid #CBD5E1",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          background: "#F8FAFC",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#0F172A" }}>
          Digital Examination Scratchpad
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ cursor: "pointer", border: "1px solid #CBD5E1", borderRadius: "4px", width: "26px", height: "26px", padding: 0 }}
            title="Pen Color"
          />
          <button
            onClick={clearCanvas}
            style={{
              padding: "5px 12px",
              background: "#FEE2E2",
              color: "#991B1B",
              border: "1px solid #FECACA",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.75rem",
            }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "5px 12px",
              background: "#0F172A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.75rem",
            }}
          >
            Close
          </button>
        </div>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" }}
          onMouseDown={startDrawing}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onMouseMove={draw}
          onTouchStart={startDrawing}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
          onTouchMove={draw}
        />
      </div>
    </div>
  );
}
