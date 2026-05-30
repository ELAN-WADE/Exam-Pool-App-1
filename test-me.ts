const testMe = async () => {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "Password123!" }),
    });
    console.log("Login Status:", res.status);
    const cookie = res.headers.get("set-cookie");
    console.log("Cookie:", cookie);
    
    const meRes = await fetch("http://127.0.0.1:8000/api/auth/me", {
      headers: { "Cookie": cookie || "" }
    });
    console.log("Me Status:", meRes.status);
    const meText = await meRes.text();
    console.log("Me Response:", meText);
  } catch (e) {
    console.error("Fetch failed:", e);
  }
};
testMe();
