import fs from "fs";
import readline from "readline";

async function extract() {
  const fileStream = fs.createReadStream("scripts/raw_ocr.jsonl");
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let textBlocks: string[] = [];

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.content && entry.content.includes("==Start of PDF==")) {
        textBlocks.push(entry.content);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  console.log(`Found ${textBlocks.length} messages containing PDF data.`);

  let fullText = textBlocks.join("\n\n");
  
  // Save all to a massive file for inspection
  fs.writeFileSync("scripts/all_ocr.txt", fullText);
  console.log("Wrote all_ocr.txt. Size:", fullText.length);
}

extract().catch(console.error);
