import fs from "fs";
import path from "path";
const pdf = require("pdf-parse");

async function identifyPdfs() {
  const dir = "C:\\Users\\DELL\\.gemini\\antigravity-ide\\brain\\a0fe3b15-4969-4bb0-b15d-5b605c4d1883";
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pdf"));

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      console.log(`\n=== File: ${file} ===`);
      console.log(data.text.substring(0, 200).replace(/\n/g, " "));
    } catch (e) {
      console.error(`Error parsing ${file}:`, e);
    }
  }
}

identifyPdfs().catch(console.error);
