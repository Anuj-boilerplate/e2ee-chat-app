/**
 * Key generation and management utilities for E2E encryption
 * Uses WebCrypto API for all cryptographic operations
 */

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface KeyExport {
  ecdhPublicKeyJwk: JsonWebKey;
  ecdhPrivateKeyJwk: JsonWebKey;
  rsaPublicKeyJwk: JsonWebKey;
  rsaPrivateKeyJwk: JsonWebKey;
}

/**
 * Generate ECDH P-256 keypair for key agreement
 */
export async function generateECDHKeypair(): Promise<KeyPair> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true, // extractable
    ["deriveKey", "deriveBits"]
  );
  
  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
  };
}

/**
 * Generate RSA-OAEP 4096-bit keypair for key wrapping fallback
 */
export async function generateRSAKeypair(): Promise<KeyPair> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true, // extractable
    ["wrapKey", "unwrapKey"]
  );
  
  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
  };
}

/**
 * Export public key as JWK
 */
export async function exportPublicJwk(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey("jwk", key);
}

/**
 * Export private key as JWK
 */
export async function exportPrivateJwk(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey("jwk", key);
}

/**
 * Import public ECDH key from JWK
 */
export async function importECDHPublicJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

/**
 * Import private ECDH key from JWK
 */
export async function importECDHPrivateJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"]
  );
}

/**
 * Import public RSA key from JWK
 */
export async function importRSAPublicJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["wrapKey"]
  );
}

/**
 * Import private RSA key from JWK
 */
export async function importRSAPrivateJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["unwrapKey"]
  );
}

/**
 * Derive KEK (Key Encryption Key) using ECDH + HKDF
 */
export async function deriveKEK_ECDH(
  senderPriv: CryptoKey,
  recipientPub: CryptoKey,
  salt: Uint8Array,
  info: string
): Promise<CryptoKey> {
  // Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: recipientPub,
    },
    senderPriv,
    256 // 256 bits
  );

  // Import shared secret as raw key for HKDF
  const baseKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  // Derive KEK using HKDF
  const kek = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: salt.buffer as ArrayBuffer,
      info: new TextEncoder().encode(info).buffer as ArrayBuffer,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );

  return kek;
}
