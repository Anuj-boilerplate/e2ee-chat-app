import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCryptoKeys } from '@/hooks/useCryptoKeys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Shield, CheckCircle2, XCircle } from 'lucide-react';
import { exportPublicJwk } from '@/lib/crypto';
import { sha256Hex } from '@/lib/crypto/hash';

export default function Verify() {
  const navigate = useNavigate();
  const { keys, user } = useCryptoKeys();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const verifyKeys = async () => {
    if (!keys || !user) {
      setVerified(false);
      return;
    }

    try {
      // Export public keys
      const ecdhPublicJwk = await exportPublicJwk(keys.ecdhKeyPair!.publicKey);
      const rsaPublicJwk = await exportPublicJwk(keys.rsaKeyPair!.publicKey);

      // Compute fingerprint
      const fingerprintData = JSON.stringify(ecdhPublicJwk) + JSON.stringify(rsaPublicJwk);
      const computedFingerprint = await sha256Hex(fingerprintData);

      setFingerprint(computedFingerprint);

      // Verify keys are valid
      const hasValidKeys = !!(
        keys.ecdhKeyPair?.publicKey &&
        keys.ecdhKeyPair?.privateKey &&
        keys.rsaKeyPair?.publicKey &&
        keys.rsaKeyPair?.privateKey
      );

      setVerified(hasValidKeys);
    } catch (error) {
      console.error('Error verifying keys:', error);
      setVerified(false);
    }
  };

  useEffect(() => {
    verifyKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, user]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/chats')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Verify Keys</h1>
            <p className="text-muted-foreground">Verify your cryptographic key pair</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Key Verification</CardTitle>
            <CardDescription>
              Verify that your encryption keys are properly generated and stored
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">ECDH Key Pair</span>
              {verified === true && keys?.ecdhKeyPair ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : verified === false ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Shield className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">RSA Key Pair</span>
              {verified === true && keys?.rsaKeyPair ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : verified === false ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Shield className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            {fingerprint && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Fingerprint</p>
                <p className="font-mono text-sm break-all">{fingerprint}</p>
              </div>
            )}

            <Button onClick={verifyKeys} className="w-full">
              Verify Keys
            </Button>

            {verified === true && (
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✓ Your keys are valid and ready to use
                </p>
              </div>
            )}

            {verified === false && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">
                  ✗ Key verification failed. Please refresh or contact support.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

