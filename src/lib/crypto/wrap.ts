/**
 * Key wrapping utilities for encrypting message keys
 */

import { deriveKEK_ECDH } from './keys';

/**
 * Wrap AES key using ECDH-derived KEK
 */
export async function wrapAesKeyWithECDH(
  aesKey: CryptoKey,
  senderPrivECDH: CryptoKey,
  recipientPubECDH: CryptoKey,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  const kek = await deriveKEK_ECDH(
    senderPrivECDH,
    recipientPubECDH,
    salt,
    "wrap"
  );
  
  return await crypto.subtle.wrapKey("raw", aesKey, kek, {
    name: "AES-GCM",
    iv: salt.slice(0, 12), // Use first 12 bytes of salt as IV
  });
}

/**
 * Unwrap AES key using ECDH-derived KEK
 */
export async function unwrapAesKeyWithECDH(
  wrappedKey: ArrayBuffer,
  recipientPrivECDH: CryptoKey,
  senderPubECDH: CryptoKey,
  salt: Uint8Array
): Promise<CryptoKey> {
  const kek = await deriveKEK_ECDH(
    recipientPrivECDH,
    senderPubECDH,
    salt,
    "wrap"
  );
  
  return await crypto.subtle.unwrapKey(
    "raw",
    wrappedKey,
    kek,
    {
      name: "AES-GCM",
      iv: salt.slice(0, 12),
    },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

/**
 * Wrap AES key using RSA-OAEP (fallback method)
 */
export async function wrapAesKeyWithRSA(
  aesKey: CryptoKey,
  recipientRsaPub: CryptoKey
): Promise<ArrayBuffer> {
  return await crypto.subtle.wrapKey("raw", aesKey, recipientRsaPub, {
    name: "RSA-OAEP",
  });
}

/**
 * Unwrap AES key using RSA-OAEP (fallback method)
 */
export async function unwrapAesKeyWithRSA(
  wrappedKey: ArrayBuffer,
  recipientRsaPriv: CryptoKey
): Promise<CryptoKey> {
  return await crypto.subtle.unwrapKey(
    "raw",
    wrappedKey,
    recipientRsaPriv,
    { name: "RSA-OAEP" },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}
