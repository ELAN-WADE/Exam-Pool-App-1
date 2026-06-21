"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../../components/KioskLogin.module.css";
import { api } from "../../lib/api";

type KioskState = "IDLE" | "AUTHENTICATING" | "ACTIVE" | "SWITCHING" | "COMPLETED";

export default function KioskLogin() {
  const [state, setState] = useState<KioskState>("IDLE");
  const [regId, setRegId] = useState("");
  const [error, setError] = useState("");
  const [seatNumber, setSeatNumber] = useState<string>("UNASSIGNED");
  const router = useRouter();

  // On Mount: Load Seat Number from query param or localStorage
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const seatParam = urlParams.get("seat");
    if (seatParam) {
      setSeatNumber(seatParam);
      localStorage.setItem("kiosk_seat", seatParam);
    } else {
      const savedSeat = localStorage.getItem("kiosk_seat");
      if (savedSeat) setSeatNumber(savedSeat);
    }

    // Ensure we are in a clean state upon entering IDLE
    purgeSessionState(seatParam || localStorage.getItem("kiosk_seat") || "UNASSIGNED");
  }, []);

  const purgeSessionState = (savedSeat: string) => {
    // Completely wipe Javascript storage
    localStorage.clear();
    sessionStorage.clear();
    
    // Restore ONLY the seat number
    localStorage.setItem("kiosk_seat", savedSeat);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setState("AUTHENTICATING");

    try {
      // Step 1: Login
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: regId, password: "password_mock" }),
      });

      if (!res.ok) throw new Error("Invalid Registration Number");

      const data = await res.json();
      const studentId = data.user.id;
      
      // We set the token so standard API client works
      localStorage.setItem("exampool_token", data.token);

      // Step 2: Start Kiosk Session
      const sessionRes = await fetch("/api/kiosk/session/start", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.token}`
        },
        body: JSON.stringify({
          pc_id: "KIOSK-" + seatNumber,
          seat_number: seatNumber,
          student_id: studentId,
          exam_id: null,
          hardware_fingerprint: navigator.userAgent // Simplistic fingerprint
        }),
      });

      if (sessionRes.ok) {
        setState("ACTIVE");
        router.push("/student/dashboard?kiosk=true");
      } else {
        throw new Error("Failed to start secure session. Seat may be in use.");
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setState("IDLE");
    }
  };

  const handleSwitchUser = async () => {
    setState("SWITCHING");
    try {
      const token = localStorage.getItem("exampool_token");
      if (token) {
        // Notify backend that session is ending
        await fetch("/api/kiosk/session/switch", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}` 
          },
          body: JSON.stringify({ pc_id: "KIOSK-" + seatNumber })
        });
      }
    } catch (e) {
      console.warn("Silent failure on switch notify");
    } finally {
      purgeSessionState(seatNumber);
      setState("COMPLETED");
      
      // Hard reload to completely purge heap memory within 2 seconds
      setTimeout(() => {
        window.location.href = "/kiosk";
      }, 1500);
    }
  };

  // Listen for special "kiosk_end_session" event from the exam-shell or dashboard
  useEffect(() => {
    const handleEndSession = () => handleSwitchUser();
    window.addEventListener("kiosk_end_session", handleEndSession);
    return () => window.removeEventListener("kiosk_end_session", handleEndSession);
  }, [seatNumber]);

  if (state === "SWITCHING" || state === "COMPLETED") {
    return (
      <div className={styles.kioskLoginContainer} style={{ justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 1rem", borderTopColor: "var(--color-primary)" }} />
          <h2 style={{ color: "var(--color-primary)" }}>Ending Session...</h2>
          <p style={{ color: "var(--color-muted)" }}>Clearing terminal data securely.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.kioskLoginContainer}>
      <div className={styles.kioskSeatBadge}>
        Seat {seatNumber}
      </div>

      <div className={styles.authPromptBox}>
        <h1 style={{ marginBottom: "1rem", color: "var(--color-primary)" }}>Naija Hybrid CBT Center</h1>
        <p style={{ color: "var(--color-muted)", fontSize: "1.2rem" }}>
          Tap your ID Card or enter your Registration Number to begin.
        </p>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            className={styles.formInput}
            placeholder="REG-123456"
            value={regId}
            onChange={(e) => setRegId(e.target.value.toUpperCase())}
            autoFocus
            disabled={state !== "IDLE"}
          />

          {error && <p style={{ color: "var(--color-danger)", marginBottom: "1rem" }}>{error}</p>}

          <button type="submit" className={styles.submitBtn} disabled={state !== "IDLE" || !regId}>
            {state === "AUTHENTICATING" ? "Authenticating..." : "Start Session"}
          </button>
        </form>
      </div>
      
      {/* Hidden button to simulate "Switch" from within the IDLE page for debugging/ops */}
      <button 
        onClick={handleSwitchUser} 
        style={{ position: "absolute", bottom: "1rem", right: "1rem", opacity: 0.1, cursor: "pointer" }}
        title="Force Refresh Terminal"
      >
        Force Refresh
      </button>
    </div>
  );
}
