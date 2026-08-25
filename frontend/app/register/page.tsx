"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { WarningIcon } from "../../components/icons/Icons";
import { GradeLevel } from "../../lib/types";
import styles from "./page.module.css";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successRegId, setSuccessRegId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.getGradeLevels().then((res) => {
      if (!controller.signal.aborted) {
        setGradeLevels(res.grades || []);
        if (res.grades?.length > 0) {
          setGradeLevelId(String(res.grades[0].id));
        }
      }
    }).catch(err => {
      if (!controller.signal.aborted) console.error(err);
    });
    return () => controller.abort();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.register({
        name,
        email,
        password,
        role,
        ...(role === "student" ? { grade_level_id: gradeLevelId ? Number(gradeLevelId) : null, dob } : { phone }),
      });
      setSuccessRegId(res.user.reg_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.leftPane}>
          <div className={styles.brand}>
            <div className={styles.brandIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            </div>
            ExamPool
          </div>
          <div className={styles.heroText}>
            <h1>Start your journey with ExamPool.</h1>
            <p>Join thousands of students and educators taking their exams to the next level.</p>
          </div>
          <div className={styles.decorativeCircles}>
            <div className={styles.circle1} />
            <div className={styles.circle2} />
          </div>
        </div>
        
        <div className={styles.rightPane}>
          <div className={styles.formWrapper}>
            <div className={styles.mobileBrand}>
              <div className={styles.brandIconMobile}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              </div>
              ExamPool
            </div>
            <h2>Create an account</h2>
            
            {successRegId ? (
              <div style={{ textAlign: "center", marginTop: "2rem" }}>
                <div style={{
                  background: "var(--color-success-subtle)",
                  color: "var(--color-success)",
                  padding: "1rem",
                  borderRadius: "8px",
                  marginBottom: "1.5rem"
                }}>
                  <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>Registration Successful!</p>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>Please save your Registration ID. You can use it to log in or reset your password.</p>
                </div>
                
                <div style={{
                  fontSize: "2rem",
                  fontWeight: 800,
                  letterSpacing: "2px",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  padding: "1rem",
                  borderRadius: "8px",
                  marginBottom: "2rem"
                }}>
                  {successRegId}
                </div>
                
                <button 
                  className="btn btn-primary" 
                  onClick={() => router.push("/")}
                  style={{ width: "100%", padding: "0.85rem" }}
                >
                  Proceed to Login
                </button>
              </div>
            ) : (
              <>
                <p className={styles.subtitle}>
                  Already have an account? <Link href="/" className={styles.link}>Log in</Link>
                </p>

                {error && (
                  <div className={styles.errorBanner}>
                    <WarningIcon width="16" height="16" />
                    {error}
                  </div>
                )}

                <form className={styles.form} onSubmit={onSubmit}>
                  <div className="field">
                    <label>Full Name</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required />
                  </div>
                  {role === "teacher" && (
                    <div className="field">
                      <label>Email Address</label>
                      <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@school.edu" required />
                    </div>
                  )}
                  <div className="field">
                    <label>Password</label>
                    <input
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      required
                    />
                  </div>
                  
                  <div className={styles.row}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>I am a...</label>
                      <select className="select" value={role} onChange={(e) => setRole(e.target.value as "student" | "teacher")}>
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                      </select>
                    </div>
                    {role === "student" && (
                      <>
                        <div className="field" style={{ flex: 1 }}>
                          <label>Grade / Class</label>
                          <select className="select" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)} required>
                            <option value="">Select a class...</option>
                            {gradeLevels.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field" style={{ flex: 1, marginTop: "0.5rem" }}>
                          <label>Date of Birth</label>
                          <input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
                        </div>
                      </>
                    )}
                    {role === "teacher" && (
                      <div className="field" style={{ flex: 1 }}>
                        <label>Phone Number</label>
                        <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1234567890" required />
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "0.5rem" }}>
                    <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "35%", padding: "0.85rem" }}>
                      {submitting ? "Creating..." : "Create account"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
