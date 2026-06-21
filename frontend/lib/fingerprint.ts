/**
 * Generates a mock hardware fingerprint for the frontend client.
 * In a true Native wrapper (like Electron/Tauri), this would access the MAC address and CPU serial.
 * For the browser client, we use a consistent hash based on the User-Agent and Canvas fingerprinting,
 * which provides a stable 'device' identity for the Practice Home tier device registration.
 */

export async function generateHardwareFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    new Date().getTimezoneOffset().toString(),
    typeof window !== 'undefined' ? window.screen.colorDepth.toString() : '',
    typeof window !== 'undefined' ? window.screen.width + 'x' + window.screen.height : ''
  ];

  // Canvas fingerprinting for a unique device identifier
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('ExamPool Fingerprint', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('ExamPool Fingerprint', 4, 17);
        components.push(canvas.toDataURL());
      }
    }
  } catch (e) {
    // Ignore canvas errors
  }

  const rawString = components.join('|');
  let hashHex = "";
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback for non-secure contexts (HTTP on local network)
    let hash = 0;
    for (let i = 0; i < rawString.length; i++) {
      const char = rawString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    hashHex = Math.abs(hash).toString(16).padStart(8, '0');
  }
  
  // Return an 8-character device hash
  return `DEV-${hashHex.slice(0, 8).toUpperCase()}`;
}
