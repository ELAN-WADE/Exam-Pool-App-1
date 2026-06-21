import { useMemo } from 'react';

// Generates a simple SHA-256 like hash from string for seeding
async function generateShuffleSeed(studentId: number, subjectId: number, examDateIso: string): Promise<string> {
  const input = `${studentId}-${subjectId}-${examDateIso}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  let hashHex = "";
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash = hash & hash;
    }
    hashHex = Math.abs(hash).toString(16).padStart(16, '0');
  }
  return hashHex.slice(0, 16);
}

// Mulberry32 PRNG
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Convert first 8 chars of hex string to a 32-bit integer seed
function seedFromString(seedStr: string): number {
  return parseInt(seedStr.slice(0, 8), 16) || 0;
}

export function useDeterministicShuffle<T>(seed: string | null, array: T[]): T[] {
  return useMemo(() => {
    if (!seed || !array || array.length === 0) return array;
    
    // Copy array
    const shuffled = [...array];
    const prng = mulberry32(seedFromString(seed));
    
    // Fisher-Yates with deterministic PRNG
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      const temp = shuffled[i] as T;
      shuffled[i] = shuffled[j] as T;
      shuffled[j] = temp;
    }
    
    return shuffled;
  }, [seed, array]);
}

export { generateShuffleSeed };
