/**
 * Key backup and restore with passphrase encryption
 */

import { stringToArrayBuffer, arrayBufferToBase64, base64ToArrayBuffer, arrayBufferToString } from './symmetric';
import { generateSalt, generateIV, aesGcmEncrypt, aesGcmDecrypt } from './symmetric';

interface BackupData {
  ecdhPrivateJwk: JsonWebKey;
  rsaPrivateJwk: JsonWebKey;
}

interface SealedBackup {
  ciphertext: string;
  iv: string;
  salt: string;
}

/**
 * Derive key from passphrase using PBKDF2
 */
async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 200000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Export and seal private keys with passphrase
 */
export async function exportKeysSealed(
  ecdhPrivateJwk: JsonWebKey,
  rsaPrivateJwk: JsonWebKey,
  passphrase: string
): Promise<Blob> {
  const backupData: BackupData = {
    ecdhPrivateJwk,
    rsaPrivateJwk,
  };

  const salt = generateSalt();
  const iv = generateIV();
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const plaintext = stringToArrayBuffer(JSON.stringify(backupData));
  const ciphertext = await aesGcmEncrypt(key, iv, plaintext);

  const sealed: SealedBackup = {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  };

  const blob = new Blob([JSON.stringify(sealed, null, 2)], {
    type: "application/json",
  });

  return blob;
}

/**
 * Import and unseal private keys with passphrase
 */
export async function importKeysSealed(
  blob: Blob,
  passphrase: string
): Promise<BackupData> {
  const text = await blob.text();
  const sealed: SealedBackup = JSON.parse(text);

  const salt = new Uint8Array(base64ToArrayBuffer(sealed.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(sealed.iv));
  const ciphertext = base64ToArrayBuffer(sealed.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt);

  try {
    const plaintext = await aesGcmDecrypt(key, iv, ciphertext);
    const backupData: BackupData = JSON.parse(arrayBufferToString(plaintext));
    return backupData;
  } catch (error) {
    throw new Error("Invalid passphrase or corrupted backup file");
  }
}
