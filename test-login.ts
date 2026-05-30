const testLogin = async () => {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "Password123!" }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("Fetch failed:", e);
  }
};
testLogin();
