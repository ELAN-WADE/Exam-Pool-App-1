import { deriveEpkgKey } from "./crypto_utils.ts";
import fs from "fs";

async function testDecrypt() {
  const fileText = fs.readFileSync("sample_jamb_pack.epkg", "utf-8");
  const epkg = JSON.parse(fileText);

  const jti = "ep-lic-999888777";
  const sub = "SCH-LAG-001";

  console.log("Deriving key...");
  const key = await deriveEpkgKey(jti, sub, epkg.version, epkg.salt);

  console.log("Key derived:", key);
  
  const iv = new Uint8Array(epkg.iv.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []);
  const authTag = new Uint8Array(epkg.authTag.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []);
  const ciphertextBytes = Uint8Array.from(atob(epkg.ciphertext), c => c.charCodeAt(0));
  
  const combined = new Uint8Array(ciphertextBytes.length + authTag.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTag, ciphertextBytes.length);

  console.log("Decrypting...");
  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      combined
    );
    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    console.log("Decrypted successfully:", decryptedText.substring(0, 100));
  } catch (err) {
    console.error("Decryption failed:", err);
  }
}

testDecrypt();
