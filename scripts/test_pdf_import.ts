import fs from "fs";

async function testPdf() {
  const m = await import("pdf-parse");
  const pdfParse = m.PDFParse || m.default || m;
  console.log(typeof pdfParse);
  
  const buffer = fs.readFileSync("C:\\Users\\DELL\\.gemini\\antigravity-ide\\brain\\a0fe3b15-4969-4bb0-b15d-5b605c4d1883\\media__1784960234824.pdf");
  
  if (typeof pdfParse === 'function') {
      try {
          const data = await pdfParse(buffer);
          console.log(data.text.substring(0, 100));
      } catch (e) {
          console.error("Error with pdfParse:", e);
      }
  } else {
      console.log("Could not find function.");
  }
}

testPdf();
