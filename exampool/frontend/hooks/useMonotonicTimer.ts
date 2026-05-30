"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Monotonic countdown timer.
 *
 * FIXES vs. previous version:
 * 1. `onExpire` is stored in a ref so changing it (e.g. when `answers` state
 *    changes on the parent) does NOT restart the timer or reset startRef.
 * 2. The effect only re-runs when `initialSeconds` changes — i.e. when the
 *    exam page re-seeds it from server time on load/resume.
 */
export function useMonotonicTimer(initialSeconds: number, onExpire: () => void) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const startRef    = useRef(performance.now());
  const initialRef  = useRef(initialSeconds);
  const expireRef   = useRef(onExpire);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep expire callback fresh without restarting the timer
  useEffect(() => { expireRef.current = onExpire; }, [onExpire]);

  // Only (re)start when the seeded duration actually changes
  useEffect(() => {
    if (initialSeconds <= 0) {
      setRemaining(0);
      expireRef.current();
      return;
    }
    startRef.current   = performance.now();
    initialRef.current = initialSeconds;
    setRemaining(initialSeconds);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const elapsed = Math.floor((performance.now() - startRef.current) / 1000);
      const left    = Math.max(0, initialRef.current - elapsed);
      setRemaining(left);
      if (left === 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        expireRef.current();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeconds]);

  return remaining;
}
