const crypto = require("crypto");
const fs = require("fs");

async function deriveEpkgKeyNode(licenseKey, schoolId, version, saltHex) {
  const ikmString = `${licenseKey}${schoolId}${version}`;
  const ikm = Buffer.from(ikmString);
  const salt = Buffer.from(saltHex, "hex");
  const info = Buffer.from("exampool-content-v1");

  // HKDF-SHA256 equivalent
  return new Promise((resolve, reject) => {
    crypto.hkdf("sha256", ikm, salt, info, 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function createEpkg() {
  const licenseKey = "ep-lic-999888777";
  const schoolId = "SCH-LAG-001";
  const version = "1.0";
  
  const salt = crypto.randomBytes(16);
  const saltHex = salt.toString("hex");

  const key = await deriveEpkgKeyNode(licenseKey, schoolId, version, saltHex);

  const payload = {
    exam_body: "JAMB",
    subject: "Mathematics",
    subject_code: "MTH",
    year: 2024,
    paper_type: "objective",
    questions: [
      {
        question_text: "Find the derivative of $y = x^2$.",
        options: ["$2x$", "$x$", "$x^2/2$", "$2$"],
        correct_answer: "0",
        solution_text: "Using the power rule, the derivative of $x^n$ is $nx^{n-1}$. Thus, for $x^2$, it is $2x$.",
        difficulty: 2,
        topic_tag: "Calculus"
      },
      {
        question_text: "What is the capital of France? (Mock Math Question)",
        options: ["London", "Paris", "Berlin", "Madrid"],
        correct_answer: "1",
        solution_text: "Paris is the capital of France.",
        difficulty: 1,
        topic_tag: "General"
      }
    ]
  };

  const plaintext = Buffer.from(JSON.stringify(payload));
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const epkgData = {
    version: version,
    salt: saltHex,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("base64"),
    exam_body: payload.exam_body,
    subject: payload.subject,
    year: payload.year,
    content_count: payload.questions.length
  };

  fs.writeFileSync("sample_jamb_pack.epkg", JSON.stringify(epkgData, null, 2));
  console.log("Successfully created sample_jamb_pack.epkg");
}

createEpkg().catch(console.error);
