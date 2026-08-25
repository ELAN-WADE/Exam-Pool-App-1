import fs from "fs";

const serverContent = fs.readFileSync("server.ts", "utf-8");
const lines = serverContent.split("\n");

const targetLines = [991, 1130, 1154, 1298, 1400, 1562];

for (const lineNum of targetLines) {
  const start = Math.max(0, lineNum - 10);
  const end = Math.min(lines.length, lineNum + 20);
  console.log(`\n=================== ROUTE AROUND LINE ${lineNum} ===================`);
  for (let i = start; i < end; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}
