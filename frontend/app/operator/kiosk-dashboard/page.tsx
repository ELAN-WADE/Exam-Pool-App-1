'use client';

import React, { useState, useEffect } from 'react';
import styles from '../../../components/SeatMap.module.css';
import { fetchWithAuth } from '../../../lib/api';

interface SeatMapCell {
  pc_id: string;
  seat_number: number | null;
  status: 'idle' | 'active' | 'attention' | 'completed';
  current_student_id: number | null;
  current_exam_id: number | null;
}

export default function SeatMapDashboard() {
  const [seats, setSeats] = useState<SeatMapCell[]>([]);
  const [error, setError] = useState('');

  // Fallback Polling / Initial Load
  const fetchSeats = async () => {
    try {
      const data = await fetchWithAuth('/api/kiosk/seat-map');
      setSeats(data.pcs || []);
    } catch (err) {
      setError('Failed to fetch seat map');
    }
  };

  useEffect(() => {
    fetchSeats();
    
    // Setup Server-Sent Events for real-time updates
    const eventSource = new EventSource('/api/notifications/stream', { withCredentials: true });
    
    eventSource.onmessage = (event) => {
      // In a full implementation, we'd parse event.data and update specific seats.
      // For now, any broadcast triggers a fast re-fetch.
      fetchSeats();
    };

    eventSource.onerror = () => {
      // If SSE fails, fallback to strict polling
      console.warn("SSE failed, falling back to polling");
      eventSource.close();
      const interval = setInterval(fetchSeats, 5000);
      return () => clearInterval(interval);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleForceSubmit = async (pcId: string) => {
    if (confirm(`Force submit exam on ${pcId}?`)) {
      // Hit switch API to force end
      await fetchWithAuth('/api/kiosk/session/end', {
        method: 'POST',
        body: JSON.stringify({ pc_id: pcId })
      });
      fetchSeats();
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ marginBottom: '1rem' }}>CBT Center Dashboard</h1>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      
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
    </div>
  );
}
