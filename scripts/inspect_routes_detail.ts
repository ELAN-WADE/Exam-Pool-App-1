import fs from "fs";

const serverContent = fs.readFileSync("server.ts", "utf-8");
const lines = serverContent.split("\n");

// Look for route definitions around the lines found
const targetLines = [991, 1130, 1154, 1298, 1400, 1562, 1928, 2006, 2347, 2493, 2522, 3551];

for (const lineNum of targetLines) {
  const start = Math.max(0, lineNum - 15);
  const end = Math.min(lines.length, lineNum + 25);
  console.log(`\n=================== ROUTE AROUND LINE ${lineNum} ===================`);
  for (let i = start; i < end; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}
