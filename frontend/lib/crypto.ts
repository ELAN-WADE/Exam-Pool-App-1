import forge from 'node-forge';

/**
 * Derives the AES-256-GCM key using standard RFC 5869 HKDF-SHA256.
 * Implemented via node-forge to support insecure HTTP contexts where WebCrypto is disabled.
 */
export async function deriveEpkgKey(licenseKey: string, schoolId: string, version: string, saltHex: string): Promise<string> {
  const ikmString = `${licenseKey}${schoolId}${version}`;
  const ikmBuf = forge.util.createBuffer(ikmString, 'utf8');
  
  let saltBytes = '';
  if (saltHex) {
    saltBytes = forge.util.hexToBytes(saltHex);
  } else {
    // 32 bytes of zeros if no salt
    saltBytes = forge.util.hexToBytes('00'.repeat(32));
  }

  // 1. HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
  const prkHmac = forge.hmac.create();
  prkHmac.start('sha256', saltBytes);
  prkHmac.update(ikmBuf.getBytes());
  const prk = prkHmac.digest().getBytes();

  // 2. HKDF-Expand: OKM = HMAC-SHA256(PRK, info + 0x01)
  const infoBuf = forge.util.createBuffer("exampool-content-v1", 'utf8');
  const okmHmac = forge.hmac.create();
  okmHmac.start('sha256', prk);
  okmHmac.update(infoBuf.getBytes());
  okmHmac.update(String.fromCharCode(1)); // 0x01
  
  return okmHmac.digest().getBytes(); // 32 bytes binary string
}

export async function decryptEpkg(pkg: any): Promise<any> {
  // Derive the 32-byte key string
  const keyStr = await deriveEpkgKey("ep-lic-999888777", "SCH-LAG-001", pkg.version, pkg.salt);
  
  const ivBytes = forge.util.hexToBytes(pkg.iv);
  const authTagBytes = forge.util.hexToBytes(pkg.authTag);
  const cipherBytes = forge.util.decode64(pkg.ciphertext);

  // Initialize node-forge AES-GCM decipher
  const decipher = forge.cipher.createDecipher('AES-GCM', keyStr);
  
  decipher.start({
    iv: ivBytes,
    tagLength: 128, // 16 bytes auth tag
    tag: forge.util.createBuffer(authTagBytes, 'raw')
  });
  
  decipher.update(forge.util.createBuffer(cipherBytes, 'raw'));
  const pass = decipher.finish();
  
  if (!pass) {
    throw new Error("Decryption failed. The package may be tampered with or the license is invalid.");
  }

  const decryptedText = forge.util.decodeUtf8(decipher.output.getBytes());
  return JSON.parse(decryptedText);
}
