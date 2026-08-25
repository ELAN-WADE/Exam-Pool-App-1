"use client";

import { useState } from "react";

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === " ") {
      i++;
      continue;
    }
    if ("0123456789.".includes(expr[i])) {
      let num = "";
      while (i < expr.length && "0123456789.".includes(expr[i])) {
        num += expr[i++];
      }
      tokens.push(num);
    } else if ("+-*/()".includes(expr[i])) {
      tokens.push(expr[i++]);
    } else {
      throw new Error("Invalid character");
    }
  }
  return tokens;
}

function parseExpression(tokens: string[], pos: { i: number }): number {
  let left = parseTerm(tokens, pos);
  while (pos.i < tokens.length && (tokens[pos.i] === "+" || tokens[pos.i] === "-")) {
    const op = tokens[pos.i++];
    const right = parseTerm(tokens, pos);
    left = op === "+" ? left + right : left - right;
  }
  return left;
}

function parseTerm(tokens: string[], pos: { i: number }): number {
  let left = parseFactor(tokens, pos);
  while (pos.i < tokens.length && (tokens[pos.i] === "*" || tokens[pos.i] === "/")) {
    const op = tokens[pos.i++];
    const right = parseFactor(tokens, pos);
    left = op === "*" ? left * right : left / right;
  }
  return left;
}

function parseFactor(tokens: string[], pos: { i: number }): number {
  if (pos.i >= tokens.length) throw new Error("Unexpected end");
  if (tokens[pos.i] === "(") {
    pos.i++; // skip (
    const val = parseExpression(tokens, pos);
    if (pos.i >= tokens.length || tokens[pos.i] !== ")") throw new Error("Missing )");
    pos.i++; // skip )
    return val;
  }
  if (tokens[pos.i] === "-") {
    pos.i++;
    return -parseFactor(tokens, pos);
  }
  const num = parseFloat(tokens[pos.i]);
  if (isNaN(num)) throw new Error("Invalid number");
  pos.i++;
  return num;
}

function safeEval(expr: string): number {
  const sanitized = expr.replace(/[^0-9+\-*/.()]/g, "");
  if (!sanitized) throw new Error("Empty expression");
  const tokens = tokenize(sanitized);
  const pos = { i: 0 };
  const result = parseExpression(tokens, pos);
  if (pos.i < tokens.length) throw new Error("Unexpected token");
  return result;
}

export function Calculator({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState("0");

  const handleNum = (num: string) => {
    setDisplay((prev) => (prev === "0" ? num : prev + num));
  };

  const handleOp = (op: string) => {
    setDisplay((prev) => prev + op);
  };

  const calculate = () => {
    try {
      const result = safeEval(display);
      setDisplay(String(result));
    } catch {
      setDisplay("Error");
    }
  };

  const clear = () => setDisplay("0");

  const handleSci = (func: string) => {
    try {
      const val = parseFloat(display);
      if (isNaN(val)) return;
      let res = 0;
      if (func === "sin") res = Math.sin((val * Math.PI) / 180);
      if (func === "cos") res = Math.cos((val * Math.PI) / 180);
      if (func === "tan") res = Math.tan((val * Math.PI) / 180);
      if (func === "log") res = Math.log10(val);
      if (func === "sqrt") res = Math.sqrt(val);
      if (func === "sq") res = val * val;
      setDisplay(String(Number(res.toFixed(6))));
    } catch {
      setDisplay("Error");
    }
  };

  const backspace = () => {
    setDisplay((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        width: "320px",
        background: "#0F172A",
        borderRadius: "14px",
        boxShadow: "0 20px 30px -10px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        zIndex: 9998,
        border: "1px solid #334155",
        color: "#FFFFFF",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ color: "#94A3B8", fontSize: "0.6875rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Scientific Calculator
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", color: "#94A3B8", border: "none", cursor: "pointer", fontSize: "14px", padding: "2px 6px" }}
          aria-label="Close calculator"
        >
          ✕
        </button>
      </div>

      <div
        style={{
          background: "#1E293B",
          padding: "12px 14px",
          borderRadius: "8px",
          textAlign: "right",
          fontSize: "1.5rem",
          fontFamily: "var(--font-mono, monospace)",
          fontWeight: 700,
          color: "#F8FAFC",
          marginBottom: "14px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          border: "1px solid #334155",
        }}
      >
        {display}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
        <button onClick={() => handleSci("sin")} style={btnStyleSci}>sin</button>
        <button onClick={() => handleSci("cos")} style={btnStyleSci}>cos</button>
        <button onClick={() => handleSci("tan")} style={btnStyleSci}>tan</button>
        <button onClick={() => handleSci("log")} style={btnStyleSci}>log</button>

        <button onClick={() => handleSci("sqrt")} style={btnStyleSci}>√</button>
        <button onClick={() => handleSci("sq")} style={btnStyleSci}>x²</button>
        <button onClick={() => handleOp("(")} style={btnStyleSci}>(</button>
        <button onClick={() => handleOp(")")} style={btnStyleSci}>)</button>

        <button onClick={() => handleNum("7")} style={btnStyleNum}>7</button>
        <button onClick={() => handleNum("8")} style={btnStyleNum}>8</button>
        <button onClick={() => handleNum("9")} style={btnStyleNum}>9</button>
        <button onClick={() => handleOp("/")} style={btnStyleOp}>÷</button>

        <button onClick={() => handleNum("4")} style={btnStyleNum}>4</button>
        <button onClick={() => handleNum("5")} style={btnStyleNum}>5</button>
        <button onClick={() => handleNum("6")} style={btnStyleNum}>6</button>
        <button onClick={() => handleOp("*")} style={btnStyleOp}>×</button>

        <button onClick={() => handleNum("1")} style={btnStyleNum}>1</button>
        <button onClick={() => handleNum("2")} style={btnStyleNum}>2</button>
        <button onClick={() => handleNum("3")} style={btnStyleNum}>3</button>
        <button onClick={() => handleOp("-")} style={btnStyleOp}>−</button>

        <button onClick={clear} style={{ ...btnStyleSci, background: "#EF4444", color: "#FFFFFF", fontWeight: 700 }}>C</button>
        <button onClick={() => handleNum("0")} style={btnStyleNum}>0</button>
        <button onClick={() => handleNum(".")} style={btnStyleNum}>.</button>
        <button onClick={() => handleOp("+")} style={btnStyleOp}>+</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "6px" }}>
        <button onClick={backspace} style={{ ...btnStyleSci, background: "#475569", color: "#FFFFFF" }}>⌫</button>
        <button
          onClick={calculate}
          style={{
            padding: "10px",
            background: "#10B981",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "6px",
            fontSize: "1.125rem",
            cursor: "pointer",
            fontWeight: 800,
            transition: "all 120ms ease",
          }}
        >
          =
        </button>
      </div>
    </div>
  );
}

const btnStyleNum = {
  padding: "9px 0",
  background: "#1E293B",
  color: "#F8FAFC",
  border: "1px solid #334155",
  borderRadius: "6px",
  fontSize: "0.9375rem",
  cursor: "pointer",
  fontWeight: 700 as const,
  fontFamily: "var(--font-mono, monospace)",
};

const btnStyleOp = {
  padding: "9px 0",
  background: "#F59E0B",
  color: "#0F172A",
  border: "none",
  borderRadius: "6px",
  fontSize: "0.9375rem",
  cursor: "pointer",
  fontWeight: 800 as const,
};

const btnStyleSci = {
  padding: "9px 0",
  background: "#334155",
  color: "#CBD5E1",
  border: "none",
  borderRadius: "6px",
  fontSize: "0.8125rem",
  cursor: "pointer",
  fontWeight: 600 as const,
};
