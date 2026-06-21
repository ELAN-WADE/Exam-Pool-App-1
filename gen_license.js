import { writeFileSync } from "fs";

const header = { alg: "RS256" };
const payload = {
  iss: "exampool.ng",
  sub: "SCH-LAG-001",
  tier: "full_bundle",
  hw_fp: "mock-hw-fingerprint", // Matches the mock hardware fingerprint in server.ts
  devices: ["fp1", "fp2", "fp3"],
  content_packs: ["jamb", "waec", "neco"],
  max_devices: 150,
  iat: Math.floor(Date.now() / 1000),
  exp: null,
  jti: "ep-lic-999888777"
};

const b64Header = Buffer.from(JSON.stringify(header)).toString("base64");
const b64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
const signature = Buffer.from("mock-signature").toString("base64");

const jwt = `${b64Header}.${b64Payload}.${signature}`;

const licenseObj = {
  jwt: jwt
};

writeFileSync("license.json", JSON.stringify(licenseObj, null, 2));
console.log("Created license.json with JWT:", jwt);
