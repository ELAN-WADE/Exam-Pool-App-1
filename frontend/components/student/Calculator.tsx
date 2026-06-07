"use client";

import { useState } from "react";

export function Calculator({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState("0");
  const [memory, setMemory] = useState<number | null>(null);

  const handleNum = (num: string) => {
    setDisplay(prev => prev === "0" ? num : prev + num);
  };

  const handleOp = (op: string) => {
    setDisplay(prev => prev + op);
  };

  const calculate = () => {
    try {
      // Basic safe eval equivalent using Function for a simple calculator
      // Note: In a real app, use a safer math parser, but for this demo:
      const sanitized = display.replace(/[^0-9+\-*/.()]/g, '');
      const result = new Function('return ' + sanitized)();
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
      switch(func) {
        case 'sin': res = Math.sin(val); break;
        case 'cos': res = Math.cos(val); break;
        case 'tan': res = Math.tan(val); break;
        case 'sqrt': res = Math.sqrt(val); break;
        case 'log': res = Math.log10(val); break;
        case 'ln': res = Math.log(val); break;
        case 'sq': res = val * val; break;
      }
      setDisplay(String(res));
    } catch {
      setDisplay("Error");
    }
  };

  return (
    <div style={{
      position: "fixed", bottom: "30px", right: "30px",
      width: "320px", background: "#1f2937", borderRadius: "12px",
      boxShadow: "0 20px 25px -5px rgba(0,0,0,0.5)", padding: "16px",
      display: "flex", flexDirection: "column", zIndex: 9998,
      border: "1px solid #374151"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ color: "#9ca3af", fontSize: "12px", fontWeight: "bold" }}>SCIENTIFIC CALCULATOR</div>
        <button onClick={onClose} style={{ background: "transparent", color: "#9ca3af", border: "none", cursor: "pointer", fontSize: "14px" }}>✕</button>
      </div>
      
      <div style={{ 
        background: "#e5e7eb", padding: "15px", borderRadius: "8px", 
        textAlign: "right", fontSize: "24px", fontFamily: "monospace", 
        marginBottom: "16px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" 
      }}>
        {display}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        <button onClick={() => handleSci('sin')} style={btnStyleSci}>sin</button>
        <button onClick={() => handleSci('cos')} style={btnStyleSci}>cos</button>
        <button onClick={() => handleSci('tan')} style={btnStyleSci}>tan</button>
        <button onClick={() => handleSci('log')} style={btnStyleSci}>log</button>

        <button onClick={() => handleSci('sqrt')} style={btnStyleSci}>√</button>
        <button onClick={() => handleSci('sq')} style={btnStyleSci}>x²</button>
        <button onClick={() => handleOp('(')} style={btnStyleSci}>(</button>
        <button onClick={() => handleOp(')')} style={btnStyleSci}>)</button>

        <button onClick={() => handleNum('7')} style={btnStyleNum}>7</button>
        <button onClick={() => handleNum('8')} style={btnStyleNum}>8</button>
        <button onClick={() => handleNum('9')} style={btnStyleNum}>9</button>
        <button onClick={() => handleOp('/')} style={btnStyleOp}>÷</button>

        <button onClick={() => handleNum('4')} style={btnStyleNum}>4</button>
        <button onClick={() => handleNum('5')} style={btnStyleNum}>5</button>
        <button onClick={() => handleNum('6')} style={btnStyleNum}>6</button>
        <button onClick={() => handleOp('*')} style={btnStyleOp}>×</button>

        <button onClick={() => handleNum('1')} style={btnStyleNum}>1</button>
        <button onClick={() => handleNum('2')} style={btnStyleNum}>2</button>
        <button onClick={() => handleNum('3')} style={btnStyleNum}>3</button>
        <button onClick={() => handleOp('-')} style={btnStyleOp}>−</button>

        <button onClick={clear} style={{...btnStyleSci, background: "#ef4444", color: "#fff"}}>C</button>
        <button onClick={() => handleNum('0')} style={btnStyleNum}>0</button>
        <button onClick={() => handleNum('.')} style={btnStyleNum}>.</button>
        <button onClick={() => handleOp('+')} style={btnStyleOp}>+</button>
      </div>
      <button onClick={calculate} style={{ marginTop: "8px", width: "100%", padding: "12px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", fontSize: "18px", cursor: "pointer", fontWeight: "bold" }}>=</button>
    </div>
  );
}

const btnStyleNum = {
  padding: "10px 0", background: "#374151", color: "#f3f4f6", border: "none", borderRadius: "6px", fontSize: "16px", cursor: "pointer", fontWeight: "bold"
};
const btnStyleOp = {
  padding: "10px 0", background: "#f59e0b", color: "#fff", border: "none", borderRadius: "6px", fontSize: "16px", cursor: "pointer", fontWeight: "bold"
};
const btnStyleSci = {
  padding: "10px 0", background: "#4b5563", color: "#d1d5db", border: "none", borderRadius: "6px", fontSize: "14px", cursor: "pointer"
};
