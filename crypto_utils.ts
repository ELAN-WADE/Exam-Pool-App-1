// ExamPool v4.1 Cryptographic Utilities
// Zero-dependency using Bun's native Web Crypto API support

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy... (MOCK PUBLIC KEY)
-----END PUBLIC KEY-----`;

/**
 * Imports the RS256 PEM public key into a CryptoKey for WebCrypto API
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  // In a real implementation, we'd base64 decode the PEM body and import.
  // Using a mock return for the structure.
  return crypto.subtle.importKey(
    "spki",
    new Uint8Array(256), // Mock ArrayBuffer
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/**
 * Validates a Master License File (MLF) JWT natively
 */
export async function validateMLF(jwt: string, currentHardwareFingerprint: string): Promise<any> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error("Invalid MLF format");

  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Invalid MLF format: missing JWT segments");

  const header = JSON.parse(atob(headerB64)) as { alg?: string };
  const payload = JSON.parse(atob(payloadB64)) as Record<string, unknown>;
  const signature = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  if (header.alg !== 'RS256') throw new Error("MLF must be RS256");

  // [SECURITY FIX VULN-01] Signature verification was mocked as `true`, meaning any JWT
  // (including forged ones) passed validation. The real RSA path below must be wired up
  // before production use. Until then, isValid = false ensures the guard below always fires
  // and callers receive an explicit error rather than silently granted access.
  //
  // To activate real verification, uncomment the block below and supply a valid PUBLIC_KEY_PEM:
  // const key = await importPublicKey(PUBLIC_KEY_PEM);
  // const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  // const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  const isValid = false; // MOCK — signature NOT verified; replace with real crypto before production

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

  if (!isValid) throw new Error("MLF Signature Invalid or Tampered");

  // Validate Hardware Fingerprint (if full core/lan bundle)
  if (mlfPayload.tier !== 'practice_home' && mlfPayload.hw_fp !== currentHardwareFingerprint) {
    throw new Error("MLF Hardware Fingerprint Mismatch");
  }

  // Validate Expiry
  if (mlfPayload.exp != null && Date.now() / 1000 > mlfPayload.exp) {
    throw new Error("MLF Expired");
  }

  return mlfPayload;
}

/**
 * Derives the AES-256-GCM key for decrypting a .epkg payload
 */
export async function deriveEpkgKey(licenseKey: string, schoolId: string, version: string, saltHex: string): Promise<CryptoKey> {
  const ikmString = `${licenseKey}${schoolId}${version}`;
  const ikm = new TextEncoder().encode(ikmString);
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  const info = new TextEncoder().encode("exampool-content-v1");

  // 1. Import IKM
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);

  // 2. Derive AES Key using HKDF-SHA256
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
