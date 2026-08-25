import os from "os";
import nodeCrypto from "node:crypto";

// ExamPool v4.1 Cryptographic Utilities
// Zero-dependency using Bun's native Web Crypto API support

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy... (MOCK PUBLIC KEY)
-----END PUBLIC KEY-----`;

/**
 * Computes a deterministic, tamper-resistant Hardware Fingerprint of the physical host machine.
 * Combines CPU model/arch, memory tier, platform, and primary non-internal MAC addresses.
 * Used to lock software installations and prevent unauthorized cloning/sharing across devices.
 */
export function getSystemHardwareFingerprint(): string {
  try {
    const ifaces = os.networkInterfaces();
    const macs: string[] = [];
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name] ?? []) {
        if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
          macs.push(net.mac.toLowerCase());
        }
      }
    }
    macs.sort();
    const cpu = (os.cpus()?.[0]?.model || "generic-cpu").trim().replace(/\s+/g, " ");
    const arch = os.arch();
    const platform = os.platform();
    const memTier = Math.round(os.totalmem() / (1024 * 1024 * 1024)); // rounded to GB
    
    // Deterministic raw hardware identity string
    const rawHW = `EXAMPOOL_HWFP_V2:${platform}:${arch}:${cpu}:${memTier}GB:${macs.join("|")}`;
    const hash = nodeCrypto.createHash("sha256").update(rawHW).digest("hex");
    
    // Format into a human-readable 4x4 segmented token: EP-HW-XXXX-XXXX-XXXX-XXXX
    const p1 = hash.substring(0, 4).toUpperCase();
    const p2 = hash.substring(4, 8).toUpperCase();
    const p3 = hash.substring(8, 12).toUpperCase();
    const p4 = hash.substring(12, 16).toUpperCase();
    return `EP-HW-${p1}-${p2}-${p3}-${p4}`;
  } catch {
    return "EP-HW-STANDALONE-NODE-001";
  }
}

/**
 * Validates a Master License File (MLF) JWT natively
 */
export async function validateMLF(jwt: string, currentHardwareFingerprint: string): Promise<any> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid MLF format: expected 3-part signed token");

  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Invalid MLF format: missing JWT segments");

  const header = JSON.parse(atob(headerB64)) as { alg?: string };
  const payload = JSON.parse(atob(payloadB64)) as Record<string, unknown>;
  const signature = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

  if (header.alg !== "RS256" && header.alg !== "HS256") {
    throw new Error("MLF must be signed with RS256 or HS256");
  }

  // [SECURITY HARDENING] Real RSA signature verification if MLF_PUBLIC_KEY is provided
  let key: CryptoKey | null = null;
  try {
    const pem = process.env.MLF_PUBLIC_KEY;
    if (pem) {
      const cleanB64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s/g, "");
      const der = Buffer.from(cleanB64, "base64");
      key = await crypto.subtle.importKey(
        "spki",
        der,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
    }
  } catch {}

  let isValid = true;
  if (key) {
    isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!isValid) throw new Error("MLF Signature Invalid or Tampered");
  }

  /** Shape of a decoded ExamPool Master License File payload */
  interface MLFPayload {
    tier: string;
    hw_fp?: string;
    exp?: number | null;
    sub?: string;
    jti?: string;
    iat?: number;
    max_devices?: number;
    [key: string]: unknown;
  }

  const mlfPayload = payload as MLFPayload;

  // [HARDWARE LOCK ENFORCEMENT] Validate Hardware Fingerprint
  // Prevents sharing the software by locking the license to the specific physical server
  if (mlfPayload.hw_fp && mlfPayload.hw_fp !== "*" && mlfPayload.hw_fp !== currentHardwareFingerprint) {
    throw new Error(`Machine Hardware Mismatch: License is bound to '${mlfPayload.hw_fp}', but this machine is '${currentHardwareFingerprint}'. Software cannot be transferred or shared.`);
  }

  // Validate Expiry
  if (mlfPayload.exp != null && Date.now() / 1000 > mlfPayload.exp) {
    throw new Error("MLF License has Expired. Please contact ExamPool for renewal.");
  }

  return mlfPayload;
}

/**
 * Derives the AES-256-GCM key for decrypting a legacy .epkg payload (if needed)
 */
export async function deriveEpkgKey(licenseKey: string, schoolId: string, version: string, saltHex: string): Promise<CryptoKey> {
  const ikmString = `${licenseKey}${schoolId}${version}`;
  const ikm = new TextEncoder().encode(ikmString);
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  const info = new TextEncoder().encode("exampool-content-v1");

  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"]
  );

  return derivedKey;
}