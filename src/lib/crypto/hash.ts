/**
 * Hashing utilities for integrity verification and analytics
 */

/**
 * Compute SHA-256 hash and return as hex string
 */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate Hamming distance between two ArrayBuffers (in bits)
 */
export function hammingDistanceBits(a: ArrayBuffer, b: ArrayBuffer): number {
  const bytesA = new Uint8Array(a);
  const bytesB = new Uint8Array(b);
  
  if (bytesA.length !== bytesB.length) {
    throw new Error('Buffers must be same length for Hamming distance');
  }
  
  let distance = 0;
  for (let i = 0; i < bytesA.length; i++) {
    const xor = bytesA[i] ^ bytesB[i];
    // Count set bits in XOR result
    distance += xor.toString(2).split('1').length - 1;
  }
  
  return distance;
}

/**
 * Calculate percentage of bits that differ between two ArrayBuffers
 */
export function bitDifferencePercent(a: ArrayBuffer, b: ArrayBuffer): number {
  const distance = hammingDistanceBits(a, b);
  const totalBits = new Uint8Array(a).length * 8;
  return (distance / totalBits) * 100;
}

/**
 * Flip a random bit in an ArrayBuffer (for diffusion testing)
 */
export function flipRandomBit(data: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(data);
  const copy = new Uint8Array(bytes);
  
  const byteIndex = Math.floor(Math.random() * copy.length);
  const bitIndex = Math.floor(Math.random() * 8);
  
  copy[byteIndex] ^= (1 << bitIndex);
  
  return copy.buffer;
}

/**
 * Test for hash collisions with random inputs
 */
export async function testHashCollisions(count: number = 2048): Promise<{
  tested: number;
  collisions: number;
  uniqueHashes: number;
}> {
  const hashes = new Set<string>();
  let collisions = 0;
  
  for (let i = 0; i < count; i++) {
    const randomData = crypto.getRandomValues(new Uint8Array(64));
    const hash = await sha256Hex(randomData.buffer);
    
    if (hashes.has(hash)) {
      collisions++;
    } else {
      hashes.add(hash);
    }
  }
  
  return {
    tested: count,
    collisions,
    uniqueHashes: hashes.size,
  };
}
