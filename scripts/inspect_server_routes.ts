import fs from "fs";

const serverContent = fs.readFileSync("server.ts", "utf-8");

// Search for searchParams and query handling
const lines = serverContent.split("\n");
console.log("=== INSPECTING SERVER.TS QUERY PARAMS & ACADEMIC SWITCHING ROUTES ===");

lines.forEach((line, idx) => {
  if (line.includes("searchParams") && (line.includes("session") || line.includes("term") || line.includes("academic") || line.includes("subject") || line.includes("user"))) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
