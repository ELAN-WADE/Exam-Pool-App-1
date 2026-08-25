'use client';

import React, { useState, useEffect } from 'react';
import styles from '../../../components/SeatMap.module.css';
import { RequireRole } from '../../../components/auth/RequireRole';
import { fetchWithAuth, API_BASE } from '../../../lib/api';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

interface SeatMapCell {
  pc_id: string;
  seat_number: number | null;
  status: 'idle' | 'active' | 'attention' | 'completed';
  current_student_id: number | null;
  current_exam_id: number | null;
}

export default function SeatMapDashboardRoute() {
  return (
    <RequireRole role="operator">
      <SeatMapDashboard />
    </RequireRole>
  );
}

function SeatMapDashboard() {
  const [seats, setSeats] = useState<SeatMapCell[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState<{ open: boolean; pcId: string } | null>(null);

  const fetchSeats = async () => {
    try {
      const data = await fetchWithAuth('/api/kiosk/seat-map');
      setSeats(data.pcs || []);
      setError('');
    } catch (err) {
      setError('Failed to fetch seat map');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeats();

    // [FIX] EventSource doesn't accept `withCredentials` and only works same-origin.
    // Use a fetch-based SSE reader (same pattern as NotificationBell) so the live
    // stream works with an external NEXT_PUBLIC_API_URL too. Falls back to polling.
    const controller = new AbortController();
    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30000;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const connectSSE = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/notifications/stream`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // Server error — retry with backoff
          if (!controller.signal.aborted && reconnectAttempts < 10) {
            const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
            reconnectAttempts++;
            reconnectTimer = setTimeout(connectSSE, delay);
          }
          return;
        }

        reconnectAttempts = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const rawJson = dataLine.slice(6).trim();
            if (!rawJson || rawJson === ": keepalive") continue;
            // Any notification means an event happened — refresh the seat map.
            fetchSeats();
          }
        }

        // Stream ended — reconnect with backoff
        if (!controller.signal.aborted && reconnectAttempts < 10) {
          const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
          reconnectAttempts++;
          reconnectTimer = setTimeout(connectSSE, delay);
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        // Network error — retry with backoff
        if (!controller.signal.aborted && reconnectAttempts < 10) {
          const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
          reconnectAttempts++;
          reconnectTimer = setTimeout(connectSSE, delay);
        } else if (!controller.signal.aborted && !pollingTimer) {
          // Give up on SSE — fall back to polling
          console.warn("SSE failed, falling back to polling");
          pollingTimer = setInterval(fetchSeats, 5000);
        }
      }
    };

    connectSSE();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollingTimer) clearInterval(pollingTimer);
      controller.abort();
    };
  }, []);

  const handleForceSubmit = async (pcId: string) => {
    setConfirmState({ open: true, pcId });
  };

  const confirmForceSubmit = async () => {
    const pcId = confirmState?.pcId;
    setConfirmState(null);
    if (!pcId) return;
    try {
      await fetchWithAuth('/api/kiosk/session/end', {
        method: 'POST',
        body: JSON.stringify({ pc_id: pcId })
      });
      fetchSeats();
    } catch {
      setError('Failed to force submit');
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ marginBottom: '1rem' }}>CBT Center Dashboard</h1>
      <ConfirmDialog
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmForceSubmit}
        title="Force Submit"
        message={`Force submit exam on ${confirmState?.pcId || ""}?`}
      />
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {loading ? (
        <div className="loadingWrap"><div className="spinner" /></div>
      ) : (
        <div className={styles.seatMapGrid}>
          {seats.map((seat) => {
            let seatClass = styles.seatIdle;
            if (seat.status === 'active') seatClass = styles.seatActive;
            else if (seat.status === 'completed') seatClass = styles.seatCompleted;
            else if (seat.status === 'attention') seatClass = styles.seatAttention;

            return (
              <div key={seat.pc_id} className={`${styles.seatCard} ${seatClass}`}>
                <div className={styles.seatHeader}>
                  <span>Seat {seat.seat_number || 'N/A'}</span>
                  <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>{seat.status}</span>
                </div>
                <div style={{ flex: 1, fontSize: '0.9rem', marginTop: '0.5rem' }}>
                  {seat.current_student_id ? `Student ID: ${seat.current_student_id}` : 'Empty'}
                </div>

                {seat.status === 'active' && (
                  <button
                    onClick={() => handleForceSubmit(seat.pc_id)}
                    style={{ marginTop: '0.5rem', padding: '0.25rem', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Force Submit
                  </button>
                )}
              </div>
            );
          })}
          {seats.length === 0 && <p>No active kiosk sessions registered.</p>}
        </div>
      )}
    </div>
  );
}
