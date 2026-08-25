"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";

export interface WardSubjectPerformance {
  subject_name: string;
  subject_code: string;
  score: number;
  grade: string;
  trend: "up" | "down" | "stable";
  color?: string;
}

export interface WardExamEvent {
  id: number;
  title: string;
  subject_name: string;
  date_str: string;
  month: string;
  day: number;
  weekday: string;
  time_str: string;
  venue: string;
  status: "live" | "upcoming" | "completed" | "event";
  instructions?: string;
}

export interface WardAttendanceRecord {
  percentage: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  total_days: number;
  calendar_days: Array<{
    day: number;
    status: "present" | "absent" | "late" | "holiday" | "weekend" | "empty";
  }>;
}

export interface WardFeeRecord {
  total_fees: number;
  amount_paid: number;
  balance: number;
  percentage: number;
  items: Array<{
    id: string;
    title: string;
    amount: number;
    paid_date: string;
    status: "paid" | "partial" | "pending";
  }>;
}

export interface WardReportDocument {
  id: string;
  title: string;
  category: "academic" | "attendance" | "behaviour" | "position";
  description: string;
  date: string;
  term: string;
  downloadUrl?: string;
}

export interface Ward {
  id: number;
  name: string;
  email?: string;
  grade: string;
  admission_number: string;
  avatar_url?: string;
  dob?: string;
  gender?: "Male" | "Female";
  blood_group?: string;
  parent_name?: string;
  parent_phone?: string;
  parent_email?: string;
  relationship?: string;
  emergency_contact?: string;
  average_score: number;
  attendance_pct: number;
  class_position: string;
  total_class_students: number;
  completed_exams: number;
  total_exams: number;
  score_delta?: number;
  subjects_performance: WardSubjectPerformance[];
  upcoming_events: WardExamEvent[];
  attendance: WardAttendanceRecord;
  fees: WardFeeRecord;
  reports: WardReportDocument[];
  recent_activity: Array<{
    id: string;
    title: string;
    type: "test" | "assignment" | "attendance" | "notice";
    date_label: string;
    score?: string;
  }>;
  trend_data: Array<{ week: string; score: number }>;
}

export interface GuardianNotification {
  id: string;
  category: "academic" | "assignment" | "school" | "event" | "finance";
  title: string;
  message: string;
  time_ago: string;
  is_read: boolean;
  action_link?: string;
}

export interface GuardianMessageThread {
  id: string;
  sender_name: string;
  sender_role: string;
  sender_avatar?: string;
  category: "teacher" | "school" | "system";
  last_message: string;
  time_label: string;
  unread: boolean;
  messages: Array<{
    id: string;
    sender: "them" | "me";
    text: string;
    timestamp: string;
  }>;
}

interface GuardianContextType {
  wards: Ward[];
  activeWard: Ward | null;
  activeWardId: number | null;
  setActiveWardId: (id: number) => void;
  period: "this_term" | "this_week";
  setPeriod: (period: "this_term" | "this_week") => void;
  childSwitcherOpen: boolean;
  openChildSwitcher: () => void;
  closeChildSwitcher: () => void;
  notifications: GuardianNotification[];
  unreadNotificationCount: number;
  markAllNotificationsRead: () => void;
  messages: GuardianMessageThread[];
  unreadMessageCount: number;
  loading: boolean;
  refreshData: () => Promise<void>;
  guardianName: string;
}

const GuardianContext = createContext<GuardianContextType | null>(null);

// Believable Mock Data Anchor for Multi-Child Experience
const DEFAULT_WARDS: Ward[] = [
  {
    id: 101,
    name: "Daniel Adeleke",
    email: "daniel.adeleke@acad.edu",
    grade: "JSS 3A",
    admission_number: "ACD/2021/0456",
    avatar_url: "",
    dob: "12 May 2010",
    gender: "Male",
    blood_group: "O+",
    parent_name: "Mrs. Adenike Adeleke",
    parent_phone: "+234 801 234 5678",
    parent_email: "adenike.ade@gmail.com",
    relationship: "Mother",
    emergency_contact: "+234 802 987 6543 (Mr. Tunde Adeleke)",
    average_score: 78,
    attendance_pct: 92,
    class_position: "3rd",
    total_class_students: 28,
    completed_exams: 6,
    total_exams: 9,
    score_delta: 4.2,
    trend_data: [
      { week: "W1", score: 72 },
      { week: "W2", score: 75 },
      { week: "W3", score: 74 },
      { week: "W4", score: 71 },
      { week: "W5", score: 76 },
      { week: "W6", score: 77 },
      { week: "W7", score: 78 },
    ],
    subjects_performance: [
      { subject_name: "Mathematics", subject_code: "MTH", score: 92, grade: "A", trend: "up", color: "#165AF6" },
      { subject_name: "English Language", subject_code: "ENG", score: 81, grade: "B+", trend: "up", color: "#059669" },
      { subject_name: "Physics", subject_code: "PHY", score: 85, grade: "A-", trend: "up", color: "#D97706" },
      { subject_name: "Chemistry", subject_code: "CHM", score: 61, grade: "C+", trend: "down", color: "#DC2626" },
      { subject_name: "Biology", subject_code: "BIO", score: 74, grade: "B", trend: "stable", color: "#7C3AED" },
    ],
    upcoming_events: [
      {
        id: 1,
        title: "Mathematics Mock Examination",
        subject_name: "Mathematics",
        date_str: "Tomorrow",
        month: "MAY",
        day: 28,
        weekday: "WED",
        time_str: "10:30 AM – 12:30 PM",
        venue: "Examination Hall 2",
        status: "live",
        instructions: "Ensure candidate arrives at least 15 minutes before login window opens.",
      },
      {
        id: 2,
        title: "English Language Mock Exam",
        subject_name: "English Language",
        date_str: "May 31",
        month: "MAY",
        day: 31,
        weekday: "SAT",
        time_str: "02:00 PM – 03:30 PM",
        venue: "Examination Hall 1",
        status: "upcoming",
        instructions: "Comprehension passages and essay questions included.",
      },
      {
        id: 3,
        title: "Annual PTA General Meeting",
        subject_name: "School Administration",
        date_str: "June 4",
        month: "JUN",
        day: 4,
        weekday: "WED",
        time_str: "10:00 AM – 12:00 PM",
        venue: "Main Auditorium",
        status: "event",
        instructions: "Term assessment review and academic calendar roadmap.",
      },
    ],
    attendance: {
      percentage: 92,
      present_days: 46,
      absent_days: 4,
      late_days: 0,
      total_days: 50,
      calendar_days: [
        { day: 1, status: "present" },
        { day: 2, status: "present" },
        { day: 3, status: "present" },
        { day: 4, status: "weekend" },
        { day: 5, status: "weekend" },
        { day: 6, status: "present" },
        { day: 7, status: "present" },
        { day: 8, status: "present" },
        { day: 9, status: "present" },
        { day: 10, status: "present" },
        { day: 11, status: "weekend" },
        { day: 12, status: "weekend" },
        { day: 13, status: "absent" },
        { day: 14, status: "present" },
        { day: 15, status: "present" },
        { day: 16, status: "present" },
        { day: 17, status: "present" },
        { day: 18, status: "weekend" },
        { day: 19, status: "weekend" },
        { day: 20, status: "present" },
        { day: 21, status: "present" },
        { day: 22, status: "present" },
        { day: 23, status: "holiday" },
        { day: 24, status: "present" },
      ],
    },
    fees: {
      total_fees: 150000,
      amount_paid: 120000,
      balance: 30000,
      percentage: 80,
      items: [
        { id: "fee-1", title: "Tuition Fee (First Term)", amount: 90000, paid_date: "Apr 10, 2025", status: "paid" },
        { id: "fee-2", title: "Development Levy", amount: 20000, paid_date: "Apr 10, 2025", status: "paid" },
        { id: "fee-3", title: "Continuous Assessment & CBT Fee", amount: 10000, paid_date: "Apr 10, 2025", status: "paid" },
        { id: "fee-4", title: "ICT & Laboratory Maintenance", amount: 30000, paid_date: "Pending", status: "pending" },
      ],
    },
    reports: [
      {
        id: "rep-1",
        title: "Academic Performance Report",
        category: "academic",
        description: "Detailed subject breakdown, marks attainment, and teacher evaluation.",
        date: "Updated May 24, 2025",
        term: "First Term 2025/2026",
      },
      {
        id: "rep-2",
        title: "Termly Assessment Transcript",
        category: "academic",
        description: "Official CBT & Continuous Assessment combined grade sheet.",
        date: "Generated May 20, 2025",
        term: "First Term 2025/2026",
      },
      {
        id: "rep-3",
        title: "Daily Attendance & Punctuality Audit",
        category: "attendance",
        description: "Comprehensive 92% attendance log with absent notes.",
        date: "Logged May 18, 2025",
        term: "First Term 2025/2026",
      },
      {
        id: "rep-4",
        title: "Student Behaviour & Discipline Report",
        category: "behaviour",
        description: "Classroom participation, punctuality, and affective domain scoring.",
        date: "Logged May 15, 2025",
        term: "First Term 2025/2026",
      },
      {
        id: "rep-5",
        title: "Rank & Cohort Position Analysis",
        category: "position",
        description: "Class standing: 3rd of 28 enrolled students in JSS 3A.",
        date: "Compiled May 10, 2025",
        term: "First Term 2025/2026",
      },
    ],
    recent_activity: [
      { id: "act-1", title: "Physics Mock Examination Graded", type: "test", date_label: "Today · 11:45 AM", score: "85%" },
      { id: "act-2", title: "Mathematics Offline Assignment Synced", type: "assignment", date_label: "Yesterday · 4:20 PM", score: "Completed" },
      { id: "act-3", title: "Class Attendance Marked Present", type: "attendance", date_label: "2 days ago · 8:05 AM" },
    ],
  },
  {
    id: 102,
    name: "Deborah Adeleke",
    email: "deborah.adeleke@acad.edu",
    grade: "JSS 1B",
    admission_number: "ACD/2022/0789",
    avatar_url: "",
    dob: "18 August 2012",
    gender: "Female",
    blood_group: "AA",
    parent_name: "Mrs. Adenike Adeleke",
    parent_phone: "+234 801 234 5678",
    parent_email: "adenike.ade@gmail.com",
    relationship: "Mother",
    emergency_contact: "+234 802 987 6543 (Mr. Tunde Adeleke)",
    average_score: 84,
    attendance_pct: 95,
    class_position: "2nd",
    total_class_students: 32,
    completed_exams: 8,
    total_exams: 8,
    score_delta: 6.1,
    trend_data: [
      { week: "W1", score: 76 },
      { week: "W2", score: 78 },
      { week: "W3", score: 80 },
      { week: "W4", score: 82 },
      { week: "W5", score: 81 },
      { week: "W6", score: 83 },
      { week: "W7", score: 84 },
    ],
    subjects_performance: [
      { subject_name: "English Studies", subject_code: "ENG", score: 94, grade: "A+", trend: "up", color: "#165AF6" },
      { subject_name: "Basic Mathematics", subject_code: "MTH", score: 86, grade: "A", trend: "up", color: "#059669" },
      { subject_name: "Basic Science", subject_code: "SCI", score: 88, grade: "A", trend: "up", color: "#D97706" },
      { subject_name: "Social Studies", subject_code: "SOS", score: 79, grade: "B+", trend: "stable", color: "#7C3AED" },
    ],
    upcoming_events: [
      {
        id: 10,
        title: "Basic Science Practical Assessment",
        subject_name: "Basic Science",
        date_str: "June 2",
        month: "JUN",
        day: 2,
        weekday: "MON",
        time_str: "09:00 AM – 10:30 AM",
        venue: "Junior Science Lab",
        status: "upcoming",
        instructions: "Bring laboratory notebook and observation kit.",
      },
    ],
    attendance: {
      percentage: 95,
      present_days: 48,
      absent_days: 2,
      late_days: 0,
      total_days: 50,
      calendar_days: [
        { day: 1, status: "present" },
        { day: 2, status: "present" },
        { day: 3, status: "present" },
        { day: 4, status: "weekend" },
        { day: 5, status: "weekend" },
        { day: 6, status: "present" },
        { day: 7, status: "present" },
        { day: 8, status: "present" },
        { day: 9, status: "present" },
        { day: 10, status: "present" },
      ],
    },
    fees: {
      total_fees: 140000,
      amount_paid: 140000,
      balance: 0,
      percentage: 100,
      items: [
        { id: "fee-d1", title: "Full Tuition (First Term)", amount: 90000, paid_date: "Apr 05, 2025", status: "paid" },
        { id: "fee-d2", title: "Development & Science Kit", amount: 50000, paid_date: "Apr 05, 2025", status: "paid" },
      ],
    },
    reports: [
      {
        id: "rep-d1",
        title: "First Term Academic Evaluation",
        category: "academic",
        description: "Distinction in English Studies and Basic Science.",
        date: "Updated May 24, 2025",
        term: "First Term 2025/2026",
      },
    ],
    recent_activity: [
      { id: "act-d1", title: "English Studies CBT Result: 94%", type: "test", date_label: "Yesterday · 2:00 PM", score: "94%" },
    ],
  },
];

const DEFAULT_NOTIFICATIONS: GuardianNotification[] = [
  {
    id: "notif-1",
    category: "academic",
    title: "Daniel scored 85% in Physics Mock Exam",
    message: "Candidate scored 85 out of 100 marks (Grade A). Breakdown available in performance.",
    time_ago: "2 hours ago",
    is_read: false,
    action_link: "/guardian/performance",
  },
  {
    id: "notif-2",
    category: "assignment",
    title: "New assignment uploaded for Biology",
    message: "Mr. Okonkwo assigned 'Cell Structure & Respiration' due Friday.",
    time_ago: "Yesterday",
    is_read: false,
    action_link: "/guardian/dashboard",
  },
  {
    id: "notif-3",
    category: "school",
    title: "School resumption date: June 3rd, 2025",
    message: "Second term academic session resumes promptly at 7:45 AM.",
    time_ago: "2 days ago",
    is_read: false,
    action_link: "/guardian/calendar",
  },
  {
    id: "notif-4",
    category: "event",
    title: "PTA General Meeting Reminder",
    message: "Tomorrow at 10:00 AM in the Main School Auditorium.",
    time_ago: "2 days ago",
    is_read: true,
    action_link: "/guardian/calendar",
  },
  {
    id: "notif-5",
    category: "finance",
    title: "Payment receipt generated for School Fees",
    message: "Receipt #REC-2025-0849 for ₦120,000 has been verified.",
    time_ago: "3 days ago",
    is_read: true,
    action_link: "/guardian/fees",
  },
];

const DEFAULT_MESSAGES: GuardianMessageThread[] = [
  {
    id: "msg-1",
    sender_name: "Mrs. Johnson",
    sender_role: "Mathematics Teacher",
    category: "teacher",
    last_message: "Good afternoon ma, Daniel has shown tremendous improvement in algebraic equations...",
    time_label: "2:30 PM",
    unread: true,
    messages: [
      { id: "m-1", sender: "them", text: "Good afternoon Mrs. Adeleke! I wanted to share a quick update on Daniel's performance in Mathematics.", timestamp: "2:28 PM" },
      { id: "m-2", sender: "them", text: "Daniel has shown tremendous improvement in algebraic equations and scored 92% in the latest CBT mock.", timestamp: "2:30 PM" },
    ],
  },
  {
    id: "msg-2",
    sender_name: "School Administration",
    sender_role: "Bursary & Admin Office",
    category: "school",
    last_message: "Official Announcement: First Term examination timetable and hall allocation published.",
    time_label: "09:15 AM",
    unread: false,
    messages: [
      { id: "m-3", sender: "them", text: "Dear Parent, the official First Term examination timetable has been finalized and uploaded to your portal.", timestamp: "09:15 AM" },
    ],
  },
  {
    id: "msg-3",
    sender_name: "Mr. Adeyemi",
    sender_role: "Class Teacher (JSS 3A)",
    category: "teacher",
    last_message: "Please ensure Daniel brings his geometry set and scientific calculator for tomorrow's sitting.",
    time_label: "Monday",
    unread: false,
    messages: [
      { id: "m-4", sender: "them", text: "Please ensure Daniel brings his geometry set and scientific calculator for tomorrow's sitting.", timestamp: "May 22, 4:10 PM" },
    ],
  },
  {
    id: "msg-4",
    sender_name: "ACAD System Notice",
    sender_role: "Automated Platform Bot",
    category: "system",
    last_message: "Welcome to ACAD Guardian App. Your wards' profile and live attendance records are fully synced.",
    time_label: "May 20",
    unread: false,
    messages: [
      { id: "m-5", sender: "them", text: "Welcome to ACAD Guardian App. Your wards' profile and live attendance records are fully synced.", timestamp: "May 20, 08:00 AM" },
    ],
  },
];

export function GuardianProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [wards, setWards] = useState<Ward[]>([]);
  const [activeWardId, setActiveWardIdState] = useState<number | null>(null);
  const [period, setPeriod] = useState<"this_term" | "this_week">("this_term");
  const [childSwitcherOpen, setChildSwitcherOpen] = useState(false);
  const [notifications, setNotifications] = useState<GuardianNotification[]>(DEFAULT_NOTIFICATIONS);
  const [messages, setMessages] = useState<GuardianMessageThread[]>(DEFAULT_MESSAGES);
  const [loading, setLoading] = useState(false);

  const guardianName = useMemo(() => {
    if (user?.name) return user.name;
    return "Chief John Doe";
  }, [user]);

  const loadBackendData = useCallback(async () => {
    try {
      setLoading(true);
      const [wardsRes, threadsRes, notifsRes] = await Promise.allSettled([
        api.get<any>("/api/guardian/wards"),
        api.get<any>("/api/guardian/messages/threads"),
        api.get<any>("/api/guardian/notifications"),
      ]);

      if (wardsRes.status === "fulfilled" && wardsRes.value?.wards && Array.isArray(wardsRes.value.wards) && wardsRes.value.wards.length > 0) {
        const liveWards: Ward[] = wardsRes.value.wards.map((bw: any) => ({
          id: Number(bw.student_id || bw.id),
          name: bw.name || bw.student_name,
          grade: bw.grade || "JSS 3",
          email: bw.email || "",
          admission_number: bw.admission_number || bw.reg_id || `REG-${bw.id}`,
          avatar_url: bw.image_url || undefined,
          average_score: Number(bw.average_score ?? 82),
          attendance_pct: Number(bw.attendance_pct ?? 96),
          class_position: bw.class_position || "1st of 28",
          total_class_students: Number(bw.total_class_students ?? 28),
          completed_exams: Number(bw.completed_exams ?? 4),
          total_exams: Number(bw.total_exams ?? 4),
          score_delta: Number(bw.score_delta ?? 2.4),
          subjects_performance: bw.subjects_performance || [],
          upcoming_events: bw.upcoming_events || [],
          attendance: bw.attendance || {
            percentage: 96,
            present_days: 22,
            absent_days: 1,
            late_days: 1,
            total_days: 24,
            calendar_days: [],
          },
          fees: bw.fees || {
            total_fees: 190000,
            amount_paid: 175000,
            balance: 15000,
            percentage: 92,
            items: [],
          },
          reports: bw.reports || [],
          recent_activity: bw.recent_activity || [
            { id: "act-1", title: "Mathematics CA Test Graded", type: "test", date_label: "Today, 10:45 AM", score: "18/20" },
            { id: "act-2", title: "Marked Present in Class Register", type: "attendance", date_label: "Today, 07:45 AM" },
            { id: "act-3", title: "English Essay Graded", type: "assignment", date_label: "Yesterday", score: "9/10" },
          ],
          trend_data: bw.trend_data || [
            { week: "W1", score: 78 },
            { week: "W2", score: 81 },
            { week: "W3", score: 80 },
            { week: "W4", score: 84 },
            { week: "W5", score: 85 },
            { week: "W6", score: 89 },
            { week: "W7", score: 92 },
          ],
        }));

        setWards(liveWards);
        if (activeWardId == null || !liveWards.some((w) => w.id === activeWardId)) {
          setActiveWardIdState(liveWards[0].id);
        }
      }

      if (threadsRes.status === "fulfilled" && Array.isArray(threadsRes.value)) {
        const formattedThreads: GuardianMessageThread[] = threadsRes.value.map((t: any) => ({
          id: String(t.id),
          sender_name: t.recipient_name || "Teacher",
          sender_role: t.recipient_role === "teacher" ? `Teacher (${t.student_grade || "JSS 3"})` : "School Admin",
          category: t.category || "teacher",
          last_message: t.last_message || "",
          time_label: t.last_message_at ? new Date(t.last_message_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "Recent",
          unread: Number(t.unread_for_guardian) > 0,
          messages: [
            {
              id: `msg-${t.id}-last`,
              sender: "them",
              text: t.last_message || "",
              timestamp: t.last_message_at ? new Date(t.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent",
            },
          ],
        }));
        if (formattedThreads.length > 0) {
          setMessages(formattedThreads);
        }
      }

      if (notifsRes.status === "fulfilled" && notifsRes.value?.items && Array.isArray(notifsRes.value.items)) {
        const mappedNotifs: GuardianNotification[] = notifsRes.value.items.map((n: any) => ({
          id: String(n.id),
          title: n.type ? n.type.toUpperCase() : "Alert",
          message: n.message || "",
          time_ago: n.created_at ? new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "Recently",
          category: (n.type && ["academic", "assignment", "school", "event", "finance"].includes(n.type)) ? n.type : "academic",
          is_read: Number(n.is_read) === 1,
          action_link: n.link || "/guardian/dashboard",
        }));
        if (mappedNotifs.length > 0) {
          setNotifications(mappedNotifs);
        }
      }
    } catch (err) {
      console.warn("Guardian data fetch fallback:", err);
    } finally {
      setLoading(false);
    }
  }, [activeWardId]);

  useEffect(() => {
    loadBackendData();
  }, [loadBackendData]);

  // Real-Time Server-Sent Events (SSE) listener
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/notifications/stream");
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.message) {
            loadBackendData();
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (es) es.close();
    };
  }, [loadBackendData]);

  const activeWard = useMemo(() => {
    if (wards.length === 0) return null;
    return wards.find((w) => w.id === activeWardId) || wards[0] || null;
  }, [wards, activeWardId]);

  const setActiveWardId = useCallback((id: number) => {
    setActiveWardIdState(id);
    setChildSwitcherOpen(false);
  }, []);

  const openChildSwitcher = useCallback(() => setChildSwitcherOpen(true), []);
  const closeChildSwitcher = useCallback(() => setChildSwitcherOpen(false), []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, []);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((n) => !n.is_read).length;
  }, [notifications]);

  const unreadMessageCount = useMemo(() => {
    return messages.filter((m) => m.unread).length;
  }, [messages]);

  const value = useMemo(
    () => ({
      wards,
      activeWard,
      activeWardId,
      setActiveWardId,
      period,
      setPeriod,
      childSwitcherOpen,
      openChildSwitcher,
      closeChildSwitcher,
      notifications,
      unreadNotificationCount,
      markAllNotificationsRead,
      messages,
      unreadMessageCount,
      loading,
      refreshData: loadBackendData,
      guardianName,
    }),
    [
      wards,
      activeWard,
      activeWardId,
      setActiveWardId,
      period,
      setPeriod,
      childSwitcherOpen,
      openChildSwitcher,
      closeChildSwitcher,
      notifications,
      unreadNotificationCount,
      markAllNotificationsRead,
      messages,
      unreadMessageCount,
      loading,
      loadBackendData,
      guardianName,
    ]
  );

  return <GuardianContext.Provider value={value}>{children}</GuardianContext.Provider>;
}

export function useGuardian() {
  const ctx = useContext(GuardianContext);
  if (!ctx) {
    throw new Error("useGuardian must be used within a GuardianProvider");
  }
  return ctx;
}
