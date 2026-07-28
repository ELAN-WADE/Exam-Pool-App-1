"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";

export interface AcademicSession {
  id: number;
  name: string;
  is_active: number;
  status: string;
  created_at?: string;
}

export interface AcademicTerm {
  id: number;
  session_id: number;
  name: "First Term" | "Second Term" | "Third Term" | string;
  start_date?: string;
  end_date?: string;
  is_active: number;
  status: string;
  registration_open?: number;
}

interface AcademicContextType {
  activeSession: AcademicSession | null;
  activeTerm: AcademicTerm | null;
  selectedSession: AcademicSession | null;
  selectedTerm: AcademicTerm | null;
  sessions: AcademicSession[];
  terms: AcademicTerm[];
  setSelectedSession: (session: AcademicSession | null) => void;
  setSelectedTerm: (term: AcademicTerm | null) => void;
  refreshAcademic: () => Promise<void>;
  loading: boolean;
}

const AcademicContext = createContext<AcademicContextType>({
  activeSession: null,
  activeTerm: null,
  selectedSession: null,
  selectedTerm: null,
  sessions: [],
  terms: [],
  setSelectedSession: () => {},
  setSelectedTerm: () => {},
  refreshAcademic: async () => {},
  loading: true,
});

export const AcademicProvider = ({ children }: { children: React.ReactNode }) => {
  const [activeSession, setActiveSession] = useState<AcademicSession | null>(null);
  const [activeTerm, setActiveTerm] = useState<AcademicTerm | null>(null);
  const [selectedSession, setSelectedSession] = useState<AcademicSession | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshAcademic = useCallback(async () => {
    try {
      setLoading(true);
      const resActive = await api.getActiveAcademic();
      const resAll = await api.getAcademicSessions().catch(() => ({ sessions: [], terms: [] }));
      
      if (resAll) {
        setSessions(resAll.sessions || []);
        setTerms(resAll.terms || []);
      }

      if (resActive) {
        if (resActive.activeSession) {
          setActiveSession(resActive.activeSession);
          setSelectedSession((prev) => prev || resActive.activeSession);
        }
        if (resActive.activeTerm) {
          setActiveTerm(resActive.activeTerm);
          setSelectedTerm((prev) => prev || resActive.activeTerm);
        }
      }
    } catch (e) {
      console.warn("AcademicContext initialization warning:", e);
      // Fallback defaults so app never hangs
      const defaultSession = { id: 1, name: "2026/2027", is_active: 1, status: "active" };
      const defaultTerm = { id: 1, session_id: 1, name: "First Term", is_active: 1, status: "active" };
      setActiveSession(defaultSession);
      setSelectedSession(defaultSession);
      setActiveTerm(defaultTerm);
      setSelectedTerm(defaultTerm);
      setSessions([defaultSession]);
      setTerms([defaultTerm]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAcademic();
  }, [refreshAcademic]);

  return (
    <AcademicContext.Provider
      value={{
        activeSession,
        activeTerm,
        selectedSession,
        selectedTerm,
        sessions,
        terms,
        setSelectedSession,
        setSelectedTerm,
        refreshAcademic,
        loading,
      }}
    >
      {children}
    </AcademicContext.Provider>
  );
};

export const useAcademic = () => useContext(AcademicContext);
