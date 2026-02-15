import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  generateECDHKeypair,
  generateRSAKeypair,
  exportPublicJwk,
  exportPrivateJwk,
  importECDHPrivateJwk,
  importRSAPrivateJwk,
  KeyPair,
} from '@/lib/crypto';
import { sha256Hex } from '@/lib/crypto/hash';
import { User } from '@supabase/supabase-js';

interface CryptoKeys {
  ecdhKeyPair: KeyPair | null;
  rsaKeyPair: KeyPair | null;
}

interface CryptoKeysContextType {
  keys: CryptoKeys | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshKeys: () => Promise<void>;
}

const CryptoKeysContext = createContext<CryptoKeysContextType | undefined>(undefined);

const KEYS_STORAGE_KEY = 'e2e_private_keys';

export function CryptoKeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<CryptoKeys | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadOrGenerateKeys = async (userId: string) => {
    try {
      // Try to load from IndexedDB simulation (localStorage for now)
      const storedKeys = localStorage.getItem(`${KEYS_STORAGE_KEY}_${userId}`);
      
      if (storedKeys) {
        const parsed = JSON.parse(storedKeys);
        const ecdhPrivate = await importECDHPrivateJwk(parsed.ecdhPrivateJwk);
        const rsaPrivate = await importRSAPrivateJwk(parsed.rsaPrivateJwk);
        
        // Import public keys from JWK
        const ecdhPublic = await crypto.subtle.importKey(
          "jwk",
          parsed.ecdhPublicJwk,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          []
        );
        const rsaPublic = await crypto.subtle.importKey(
          "jwk",
          parsed.rsaPublicJwk,
          { name: "RSA-OAEP", hash: "SHA-256" },
          true,
          ["wrapKey"]
        );
        
        setKeys({
          ecdhKeyPair: { publicKey: ecdhPublic, privateKey: ecdhPrivate },
          rsaKeyPair: { publicKey: rsaPublic, privateKey: rsaPrivate },
        });
        return;
      }

      // Generate new keys
      const ecdhKeyPair = await generateECDHKeypair();
      const rsaKeyPair = await generateRSAKeypair();

      const ecdhPublicJwk = await exportPublicJwk(ecdhKeyPair.publicKey);
      const ecdhPrivateJwk = await exportPrivateJwk(ecdhKeyPair.privateKey);
      const rsaPublicJwk = await exportPublicJwk(rsaKeyPair.publicKey);
      const rsaPrivateJwk = await exportPrivateJwk(rsaKeyPair.privateKey);

      // Compute fingerprint
      const fingerprintData = JSON.stringify(ecdhPublicJwk) + JSON.stringify(rsaPublicJwk);
      const fingerprint = await sha256Hex(fingerprintData);

      // Store private keys locally
      localStorage.setItem(
        `${KEYS_STORAGE_KEY}_${userId}`,
        JSON.stringify({
          ecdhPrivateJwk,
          rsaPrivateJwk,
          ecdhPublicJwk,
          rsaPublicJwk,
        })
      );

      // Upload public keys to database
      const { error } = await supabase.from('user_keys').upsert([{
        user_id: userId,
        ecdh_public_key_jwk: ecdhPublicJwk as any,
        rsa_public_key_jwk: rsaPublicJwk as any,
        fingerprint,
      }]);

      if (error) throw error;

      setKeys({
        ecdhKeyPair,
        rsaKeyPair,
      });
    } catch (error) {
      console.error('Error loading/generating keys:', error);
    }
  };

  const refreshKeys = async () => {
    if (user) {
      await loadOrGenerateKeys(user.id);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setKeys(null);
    navigate('/auth');
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrGenerateKeys(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrGenerateKeys(session.user.id);
      } else {
        setKeys(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <CryptoKeysContext.Provider value={{ keys, user, loading, signOut, refreshKeys }}>
      {children}
    </CryptoKeysContext.Provider>
  );
}

export function useCryptoKeys() {
  const context = useContext(CryptoKeysContext);
  if (context === undefined) {
    throw new Error('useCryptoKeys must be used within a CryptoKeysProvider');
  }
  return context;
}
