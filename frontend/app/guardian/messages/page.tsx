"use client";

import React, { useState, useEffect, useRef } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian, type GuardianMessageThread } from "../../../components/guardian/GuardianContext";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

interface Contact {
  id: number;
  name: string;
  role: string;
  role_label: string;
  student_id: number;
  category: string;
}

export default function GuardianMessagesPage() {
  return (
    <RequireRole role="guardian">
      <MessagesList />
    </RequireRole>
  );
}

function MessagesList() {
  const { messages, activeWard, refreshData } = useGuardian();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeThread, setActiveThread] = useState<GuardianMessageThread | null>(null);
  const [threadMessages, setThreadMessages] = useState<Array<{ id: string; sender: "me" | "them"; text: string; timestamp: string }>>([]);
  const [newMsgText, setNewMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  const filteredThreads = messages.filter((m) => {
    if (selectedFilter !== "all" && m.category !== selectedFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        m.sender_name.toLowerCase().includes(q) ||
        m.sender_role.toLowerCase().includes(q) ||
        m.last_message.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Load available contacts for new conversation
  useEffect(() => {
    if (!activeWard) return;
    api.get<Contact[]>(`/api/guardian/messages/contacts?ward_id=${activeWard.id}`)
      .then((data) => {
        if (Array.isArray(data)) setContacts(data);
      })
      .catch(() => {});
  }, [activeWard]);

  // Load full messages when thread is selected
  const handleOpenThread = async (thread: GuardianMessageThread) => {
    setActiveThread(thread);
    setThreadMessages(thread.messages || []);
    try {
      const res = await api.get<{ thread: any; messages: any[] }>(`/api/guardian/messages/threads/${thread.id}`);
      if (res?.messages) {
        const formatted = res.messages.map((m: any) => ({
          id: String(m.id),
          sender: (m.sender_role === "guardian" ? "me" : "them") as "me" | "them",
          text: m.text,
          timestamp: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now",
        }));
        setThreadMessages(formatted);
      }
    } catch {}
  };

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [threadMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMsgText.trim() || !activeThread || sending) return;

    const textToSend = newMsgText.trim();
    setNewMsgText("");
    setSending(true);

    const optimisticMsg = {
      id: `msg-${Date.now()}`,
      sender: "me" as const,
      text: textToSend,
      timestamp: "Just now",
    };
    setThreadMessages((prev) => [...prev, optimisticMsg]);

    try {
      await api.post(`/api/guardian/messages/threads/${activeThread.id}`, { text: textToSend });
      refreshData();
    } catch {
      // Revert if error
    } finally {
      setSending(false);
    }
  };

  const handleStartConversationWithContact = async (contact: Contact) => {
    if (!activeWard) return;
    try {
      setShowNewChatModal(false);
      const res = await api.post<{ threadId: number; text: string }>(`/api/guardian/messages/new-thread`, {
        recipient_id: contact.id,
        student_id: activeWard.id,
        text: `Hello ${contact.name}, this is an inquiry regarding ${activeWard.name}.`,
        category: contact.category || "teacher",
        subject: `Inquiry regarding ${activeWard.name}`,
      });
      await refreshData();
      if (res?.threadId) {
        const newThreadObj: GuardianMessageThread = {
          id: String(res.threadId),
          sender_name: contact.name,
          sender_role: contact.role_label,
          category: contact.category as any,
          last_message: res.text,
          time_label: "Just now",
          unread: false,
          messages: [{ id: "m-init", sender: "me", text: res.text, timestamp: "Just now" }],
        };
        handleOpenThread(newThreadObj);
      }
    } catch (err: any) {
      alert(err.message || "Failed to start conversation");
    }
  };

  return (
    <div className={styles.container}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 className={styles.pageTitle} style={{ margin: 0 }}>Messages & Enquiries</h1>
        {contacts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowNewChatModal(true)}
            style={{
              padding: "0.45rem 0.85rem",
              background: "#165AF6",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            <span>+ New Chat</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className={styles.searchBox}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search teachers, admins or messages..."
          className={styles.searchInput}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Filter Pills */}
      <div className={styles.filterPills}>
        {["all", "teacher", "school", "system"].map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.filterPill} ${selectedFilter === cat ? styles.filterPillActive : ""}`}
            onClick={() => setSelectedFilter(cat)}
          >
            {cat === "all"
              ? "All Chats"
              : cat === "teacher"
              ? "Teachers"
              : cat === "school"
              ? "School Admin"
              : "System Notices"}
          </button>
        ))}
      </div>

      {/* Thread List */}
      <div className={styles.threadList}>
        {filteredThreads.map((thread) => (
          <div
            key={thread.id}
            className={`${styles.threadCard} ${thread.unread ? styles.threadCardActive : ""}`}
            onClick={() => handleOpenThread(thread)}
          >
            <div className={styles.threadLeft}>
              <div className={styles.avatarCircle}>{thread.sender_name.charAt(0)}</div>
              <div className={styles.threadMeta}>
                <div className={styles.threadNameRow}>
                  <span className={styles.senderName}>{thread.sender_name}</span>
                </div>
                <span className={styles.senderRole}>{thread.sender_role}</span>
                <span className={styles.lastMsg}>{thread.last_message}</span>
              </div>
            </div>

            <div className={styles.threadRight}>
              <span className={styles.timeLabel}>{thread.time_label}</span>
              {thread.unread && <span className={styles.unreadBadge} />}
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Chat Modal */}
      {activeThread && (
        <div className={styles.chatModalOverlay} onClick={() => setActiveThread(null)}>
          <div className={styles.chatModalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.chatHeader}>
              <div>
                <div className={styles.chatHeaderName}>{activeThread.sender_name}</div>
                <div className={styles.chatHeaderRole}>{activeThread.sender_role}</div>
              </div>
              <button
                type="button"
                className={styles.chatCloseBtn}
                onClick={() => setActiveThread(null)}
              >
                ✕
              </button>
            </div>

            <div className={styles.chatBody} ref={chatBodyRef}>
              {threadMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={msg.sender === "me" ? styles.bubbleMe : styles.bubbleThem}
                >
                  <p style={{ margin: 0 }}>{msg.text}</p>
                  <span style={{ fontSize: "0.625rem", opacity: 0.7, display: "block", textAlign: "right", marginTop: 4 }}>
                    {msg.timestamp}
                  </span>
                </div>
              ))}
            </div>

            <form className={styles.chatFooter} onSubmit={handleSendMessage}>
              <input
                type="text"
                placeholder="Type a message to teacher..."
                className={styles.chatInput}
                value={newMsgText}
                onChange={(e) => setNewMsgText(e.target.value)}
                disabled={sending}
              />
              <button type="submit" className={styles.sendBtn} disabled={sending}>
                {sending ? "..." : "Send"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* New Conversation Modal */}
      {showNewChatModal && (
        <div className={styles.chatModalOverlay} onClick={() => setShowNewChatModal(false)}>
          <div className={styles.chatModalContainer} onClick={(e) => e.stopPropagation()} style={{ maxHeight: "400px" }}>
            <div className={styles.chatHeader}>
              <div>
                <div className={styles.chatHeaderName}>Message Teachers & School</div>
                <div className={styles.chatHeaderRole}>Select recipient for {activeWard?.name}</div>
              </div>
              <button type="button" className={styles.chatCloseBtn} onClick={() => setShowNewChatModal(false)}>
                ✕
              </button>
            </div>

            <div className={styles.chatBody} style={{ padding: "0.75rem" }}>
              {contacts.map((c) => (
                <div
                  key={c.id}
                  onClick={() => handleStartConversationWithContact(c)}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    border: "1px solid #E2E8F0",
                    marginBottom: "0.5rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#F8FAFC",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#165AF6")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#E2E8F0")}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0F172A" }}>{c.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748B" }}>{c.role_label}</div>
                  </div>
                  <span style={{ fontSize: "0.8125rem", color: "#165AF6", fontWeight: 600 }}>Message →</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
