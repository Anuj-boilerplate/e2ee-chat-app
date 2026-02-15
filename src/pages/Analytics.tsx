import { useState, useEffect } from 'react';
import { useCryptoKeys } from '@/hooks/useCryptoKeys';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Play, AlertCircle, RefreshCw, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { genAesGcmKey, aesGcmEncrypt, aesGcmDecrypt, generateIV, base64ToArrayBuffer, arrayBufferToString, stringToArrayBuffer } from '@/lib/crypto/symmetric';
import { testHashCollisions, bitDifferencePercent, flipRandomBit, sha256Hex } from '@/lib/crypto/hash';
import { importECDHPublicJwk, importRSAPublicJwk, deriveKEK_ECDH } from '@/lib/crypto';
import { unwrapAesKeyWithECDH, unwrapAesKeyWithRSA } from '@/lib/crypto/wrap';

// Helper function to unwrap key with both encrypt and decrypt permissions for analytics
const unwrapAesKeyForAnalytics = async (
  wrappedKey: ArrayBuffer,
  wrapAlg: string,
  userPrivECDH: CryptoKey | null,
  userPrivRSA: CryptoKey | null,
  otherPartyPubECDH: CryptoKey | null,
  salt: Uint8Array
): Promise<CryptoKey | null> => {
  try {
    if (wrapAlg === 'ECDH' && userPrivECDH && otherPartyPubECDH) {
      const kek = await deriveKEK_ECDH(userPrivECDH, otherPartyPubECDH, salt, "wrap");
      return await crypto.subtle.unwrapKey(
        "raw",
        wrappedKey,
        kek,
        {
          name: "AES-GCM",
          iv: salt.slice(0, 12),
        },
        { name: "AES-GCM", length: 256 },
        false, // not extractable
        ["encrypt", "decrypt"] // Both permissions for analytics
      );
    } else if (wrapAlg === 'RSA-OAEP' && userPrivRSA) {
      return await crypto.subtle.unwrapKey(
        "raw",
        wrappedKey,
        userPrivRSA,
        { name: "RSA-OAEP" },
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"] // Both permissions for analytics
      );
    }
    return null;
  } catch (error) {
    console.error('Error unwrapping key for analytics:', error);
    return null;
  }
};

interface MessageAnalytics {
  id: string;
  sender_id: string;
  recipient_id: string;
  created_at: string;
  wrap_alg: string;
  ciphertext_size: number;
  decrypted_size: number;
  decryption_time_ms: number;
  hash_verified: boolean;
  decryption_success: boolean;
  sender_name?: string;
  recipient_name?: string;
  is_file: boolean;
  file_size?: number;
  file_type?: string;
  diffusion?: number;
  confusion?: number;
  collision_resistant: boolean;
}

export default function Analytics() {
  const { user, keys } = useCryptoKeys();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [benchmarkResults, setBenchmarkResults] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [messageAnalytics, setMessageAnalytics] = useState<MessageAnalytics[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const runBenchmark = async () => {
    setRunning(true);
    setError(null);
    setBenchmarkResults(null);
    setProgress('Initializing benchmark...');

    const results: any = {
      textEncrypt: [],
      textDecrypt: [],
      fileEncrypt: [],
      fileDecrypt: [],
      diffusion: 0,
      confusion: 0,
      collisions: null,
    };

    try {
      // Text encryption/decryption benchmarks
      setProgress('Running text encryption/decryption benchmarks (100 iterations)...');
      for (let i = 0; i < 100; i++) {
        try {
          const text = 'Hello, this is a test message for encryption benchmarking!';
          const key = await genAesGcmKey();
          const iv = generateIV();
          const data = new TextEncoder().encode(text).buffer;

          const encStart = performance.now();
          const ciphertext = await aesGcmEncrypt(key, iv, data);
          const encEnd = performance.now();
          results.textEncrypt.push(encEnd - encStart);

          const decStart = performance.now();
          await aesGcmDecrypt(key, iv, ciphertext);
          const decEnd = performance.now();
          results.textDecrypt.push(decEnd - decStart);
        } catch (err) {
          console.error(`Error in text benchmark iteration ${i}:`, err);
          throw new Error(`Text benchmark failed at iteration ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      // File encryption/decryption (512 KB)
      setProgress('Running file encryption/decryption benchmarks (20 iterations)...');
      
      // Helper function to generate large random data (crypto.getRandomValues has 64KB limit)
      const generateLargeRandomData = (sizeBytes: number): ArrayBuffer => {
        const chunkSize = 64 * 1024; // 64KB chunks
        const chunks = Math.ceil(sizeBytes / chunkSize);
        const result = new Uint8Array(sizeBytes);
        
        for (let i = 0; i < chunks; i++) {
          const chunkStart = i * chunkSize;
          const chunkEnd = Math.min(chunkStart + chunkSize, sizeBytes);
          const chunkSizeActual = chunkEnd - chunkStart;
          const chunk = crypto.getRandomValues(new Uint8Array(chunkSizeActual));
          result.set(chunk, chunkStart);
        }
        
        return result.buffer;
      };
      
      for (let i = 0; i < 20; i++) {
        try {
          const fileData = generateLargeRandomData(512 * 1024);
          const key = await genAesGcmKey();
          const iv = generateIV();

          const encStart = performance.now();
          const ciphertext = await aesGcmEncrypt(key, iv, fileData);
          const encEnd = performance.now();
          results.fileEncrypt.push(encEnd - encStart);

          const decStart = performance.now();
          await aesGcmDecrypt(key, iv, ciphertext);
          const decEnd = performance.now();
          results.fileDecrypt.push(decEnd - decStart);
        } catch (err) {
          console.error(`Error in file benchmark iteration ${i}:`, err);
          throw new Error(`File benchmark failed at iteration ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      // Diffusion test
      setProgress('Running diffusion test...');
      try {
        const plaintext = new TextEncoder().encode('Test message for diffusion').buffer;
        const key = await genAesGcmKey();
        const iv = generateIV();
        const ciphertext1 = await aesGcmEncrypt(key, iv, plaintext);
        const flippedPlaintext = flipRandomBit(plaintext);
        const ciphertext2 = await aesGcmEncrypt(key, iv, flippedPlaintext);
        results.diffusion = bitDifferencePercent(ciphertext1, ciphertext2);
      } catch (err) {
        console.error('Error in diffusion test:', err);
        throw new Error(`Diffusion test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      // Confusion test
      setProgress('Running confusion test...');
      try {
        const plaintext = new TextEncoder().encode('Test message for diffusion').buffer;
        const key = await genAesGcmKey();
        const iv = generateIV();
        const ciphertext1 = await aesGcmEncrypt(key, iv, plaintext);
        const key2 = await genAesGcmKey();
        const ciphertext3 = await aesGcmEncrypt(key2, iv, plaintext);
        results.confusion = bitDifferencePercent(ciphertext1, ciphertext3);
      } catch (err) {
        console.error('Error in confusion test:', err);
        throw new Error(`Confusion test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      // Collision test
      setProgress('Running hash collision test (2048 hashes)...');
      try {
        results.collisions = await testHashCollisions(2048);
      } catch (err) {
        console.error('Error in collision test:', err);
        throw new Error(`Collision test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      setProgress('Benchmark complete!');
      setBenchmarkResults(results);
      toast({
        title: 'Benchmark Complete',
        description: 'All cryptographic tests completed successfully',
      });
    } catch (error) {
      console.error('Benchmark error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(errorMessage);
      toast({
        title: 'Benchmark Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const loadMessageAnalytics = async () => {
    if (!user || !keys) {
      toast({
        title: 'Error',
        description: 'User or keys not loaded',
        variant: 'destructive',
      });
      return;
    }

    setLoadingMessages(true);
    setError(null);

    try {
      // Load all messages the user can access
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (messagesError) throw messagesError;

      if (!messages || messages.length === 0) {
        setMessageAnalytics([]);
        toast({
          title: 'No messages',
          description: 'No messages found to analyze',
        });
        setLoadingMessages(false);
        return;
      }

      // Load user keys for all participants
      const userIds = new Set<string>();
      messages.forEach((msg: any) => {
        userIds.add(msg.sender_id);
        userIds.add(msg.recipient_id);
      });

      const { data: userKeys } = await supabase
        .from('user_keys')
        .select('user_id, display_name')
        .in('user_id', Array.from(userIds));

      const userKeyMap = new Map(
        userKeys?.map((uk: any) => [uk.user_id, uk.display_name || 'User']) || []
      );

      // Collect all hashes for collision checking
      const allHashes = new Set<string>();
      messages.forEach((m: any) => allHashes.add(m.hash_hex));

      // Analyze each message
      const analytics: MessageAnalytics[] = [];

      for (const msg of messages) {
        try {
          const decryptionStart = performance.now();

          // Decode message data
          const iv = new Uint8Array(base64ToArrayBuffer(msg.iv_base64));
          const salt = new Uint8Array(base64ToArrayBuffer(msg.salt_base64));
          const ciphertext = base64ToArrayBuffer(msg.ciphertext_base64);
          const wrappedKey = base64ToArrayBuffer(msg.wrapped_key_base64);

          // Verify hash
          const computedHash = await sha256Hex(msg.ciphertext_base64);
          const hashVerified = computedHash === msg.hash_hex;

          // Get other party's public key for ECDH unwrapping
          const otherPartyId = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id;
          const { data: otherPartyKeys } = await supabase
            .from('user_keys')
            .select('ecdh_public_key_jwk')
            .eq('user_id', otherPartyId)
            .single();

          let otherPartyEcdhPub: CryptoKey | null = null;
          if (otherPartyKeys && msg.wrap_alg === 'ECDH') {
            try {
              otherPartyEcdhPub = await importECDHPublicJwk(otherPartyKeys.ecdh_public_key_jwk as JsonWebKey);
            } catch (err) {
              console.error('Error importing other party ECDH key:', err);
            }
          }

          // Unwrap and decrypt (for decryption, we use the standard unwrap functions)
          let decrypted: string = '';
          let decryptionSuccess = false;
          let aesKeyForAnalytics: CryptoKey | null = null;

          try {
            // Decrypt using standard unwrap (decrypt only)
            let aesKeyForDecrypt: CryptoKey;
            if (msg.wrap_alg === 'ECDH' && otherPartyEcdhPub) {
              aesKeyForDecrypt = await unwrapAesKeyWithECDH(wrappedKey, keys.ecdhKeyPair!.privateKey, otherPartyEcdhPub, salt);
            } else {
              aesKeyForDecrypt = await unwrapAesKeyWithRSA(wrappedKey, keys.rsaKeyPair!.privateKey);
            }

            const decryptedBuffer = await aesGcmDecrypt(aesKeyForDecrypt, iv, ciphertext);
            decrypted = arrayBufferToString(decryptedBuffer);
            decryptionSuccess = true;

            // Unwrap again with both permissions for analytics
            aesKeyForAnalytics = await unwrapAesKeyForAnalytics(
              wrappedKey,
              msg.wrap_alg,
              keys.ecdhKeyPair?.privateKey || null,
              keys.rsaKeyPair?.privateKey || null,
              otherPartyEcdhPub,
              salt
            );
          } catch (decryptError) {
            console.error('Decryption error for message:', msg.id, decryptError);
            decryptionSuccess = false;
          }

          const decryptionEnd = performance.now();
          const decryptionTime = decryptionEnd - decryptionStart;

          // Calculate diffusion (flip 1 bit, re-encrypt, compare)
          let diffusion = 0;
          let confusion = 0;
          
          if (decryptionSuccess && decrypted.length > 0 && aesKeyForAnalytics) {
            try {
              const plaintext = stringToArrayBuffer(decrypted);
              const ciphertext1 = base64ToArrayBuffer(msg.ciphertext_base64);
              
              // Diffusion: Flip one bit in plaintext, re-encrypt with same key/IV, compare
              const flippedPlaintext = flipRandomBit(plaintext);
              const ciphertext2 = await aesGcmEncrypt(aesKeyForAnalytics, iv, flippedPlaintext);
              diffusion = bitDifferencePercent(ciphertext1, ciphertext2);

              // Confusion: Re-encrypt with different key, compare
              const newKey = await genAesGcmKey();
              const ciphertext3 = await aesGcmEncrypt(newKey, iv, plaintext);
              confusion = bitDifferencePercent(ciphertext1, ciphertext3);
            } catch (err) {
              console.error('Error calculating security properties for message:', msg.id, err);
            }
          }

          // Check collision resistance (hash uniqueness)
          const hashCount = Array.from(allHashes).filter(h => h === msg.hash_hex).length;
          const collisionResistant = hashCount === 1;

          analytics.push({
            id: msg.id,
            sender_id: msg.sender_id,
            recipient_id: msg.recipient_id,
            created_at: msg.created_at,
            wrap_alg: msg.wrap_alg,
            ciphertext_size: msg.ciphertext_base64.length,
            decrypted_size: decrypted.length,
            decryption_time_ms: decryptionTime,
            hash_verified: hashVerified,
            decryption_success: decryptionSuccess,
            sender_name: userKeyMap.get(msg.sender_id),
            recipient_name: userKeyMap.get(msg.recipient_id),
            is_file: !!msg.file_meta,
            file_size: msg.file_meta?.size,
            file_type: msg.file_meta?.type,
            diffusion: diffusion > 0 ? diffusion : undefined,
            confusion: confusion > 0 ? confusion : undefined,
            collision_resistant: collisionResistant,
          });
        } catch (err) {
          console.error('Error analyzing message:', msg.id, err);
            const hashCount = Array.from(allHashes).filter(h => h === msg.hash_hex).length;
            analytics.push({
              id: msg.id,
              sender_id: msg.sender_id,
              recipient_id: msg.recipient_id,
              created_at: msg.created_at,
              wrap_alg: msg.wrap_alg,
              ciphertext_size: msg.ciphertext_base64.length,
              decrypted_size: 0,
              decryption_time_ms: 0,
              hash_verified: false,
              decryption_success: false,
              sender_name: userKeyMap.get(msg.sender_id),
              recipient_name: userKeyMap.get(msg.recipient_id),
              is_file: !!msg.file_meta,
              file_size: msg.file_meta?.size,
              file_type: msg.file_meta?.type,
              collision_resistant: hashCount === 1,
            });
        }
      }

      setMessageAnalytics(analytics);
      toast({
        title: 'Messages Analyzed',
        description: `Analyzed ${analytics.length} messages`,
      });
    } catch (err) {
      console.error('Error loading message analytics:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load messages';
      setError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (user && keys) {
      loadMessageAnalytics();
    }
  }, [user, keys]);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/chats')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Crypto Analytics Dashboard</h1>
              <p className="text-muted-foreground">Performance metrics and security validation</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Benchmark Suite</CardTitle>
            <CardDescription>
              Run comprehensive cryptographic performance and security tests
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runBenchmark} disabled={running} className="w-full">
              <Play className="mr-2 h-4 w-4" />
              {running ? 'Running benchmarks...' : 'Run Benchmark Suite'}
            </Button>
            
            {progress && (
              <div className="text-sm text-muted-foreground">
                {progress}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Benchmark Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {benchmarkResults && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Text Encryption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average:</span>
                  <span className="font-mono">{avg(benchmarkResults.textEncrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P95:</span>
                  <span className="font-mono">{p95(benchmarkResults.textEncrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Samples:</span>
                  <span className="font-mono">{benchmarkResults.textEncrypt.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Text Decryption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average:</span>
                  <span className="font-mono">{avg(benchmarkResults.textDecrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P95:</span>
                  <span className="font-mono">{p95(benchmarkResults.textDecrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Samples:</span>
                  <span className="font-mono">{benchmarkResults.textDecrypt.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>File (512 KB) Encryption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average:</span>
                  <span className="font-mono">{avg(benchmarkResults.fileEncrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P95:</span>
                  <span className="font-mono">{p95(benchmarkResults.fileEncrypt).toFixed(3)} ms</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>File (512 KB) Decryption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average:</span>
                  <span className="font-mono">{avg(benchmarkResults.fileDecrypt).toFixed(3)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">P95:</span>
                  <span className="font-mono">{p95(benchmarkResults.fileDecrypt).toFixed(3)} ms</span>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Cryptographic Properties</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Diffusion (1-bit change)</p>
                  <p className="text-2xl font-bold text-primary">
                    {benchmarkResults.diffusion.toFixed(2)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Bits changed in ciphertext</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Confusion (key change)</p>
                  <p className="text-2xl font-bold text-primary">
                    {benchmarkResults.confusion.toFixed(2)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Bits changed with new key</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">SHA-256 Collisions</p>
                  <p className="text-2xl font-bold text-green-500">
                    {benchmarkResults.collisions.collisions}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tested {benchmarkResults.collisions.tested} hashes
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Message Analytics Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Message Analytics</CardTitle>
                <CardDescription>
                  Cryptographic statistics for each individual message
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadMessageAnalytics}
                disabled={loadingMessages || !user || !keys}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loadingMessages ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMessages ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading and analyzing messages...
              </div>
            ) : messageAnalytics.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No messages found</p>
                <p className="text-sm">Send some messages to see analytics</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Total Messages</p>
                    <p className="text-2xl font-bold">{messageAnalytics.length}</p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Avg Decrypt Time</p>
                    <p className="text-2xl font-bold">
                      {avg(messageAnalytics.map(m => m.decryption_time_ms)).toFixed(2)} ms
                    </p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Successfully Decrypted</p>
                    <p className="text-2xl font-bold text-green-500">
                      {messageAnalytics.filter(m => m.decryption_success).length}
                    </p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">Hash Verified</p>
                    <p className="text-2xl font-bold text-green-500">
                      {messageAnalytics.filter(m => m.hash_verified).length}
                    </p>
                  </div>
                </div>

                {/* Message Table */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Sender</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Algorithm</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Ciphertext</TableHead>
                        <TableHead>Decrypted</TableHead>
                        <TableHead>Decrypt Time</TableHead>
                        <TableHead>Diffusion</TableHead>
                        <TableHead>Confusion</TableHead>
                        <TableHead>Collision</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {messageAnalytics.map((msg) => (
                        <TableRow key={msg.id}>
                          <TableCell className="text-xs">
                            {new Date(msg.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            {msg.sender_id === user?.id ? 'You' : msg.sender_name || 'Unknown'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {msg.recipient_id === user?.id ? 'You' : msg.recipient_name || 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{msg.wrap_alg}</Badge>
                          </TableCell>
                          <TableCell>
                            {msg.is_file ? (
                              <Badge variant="secondary">
                                {msg.file_type?.startsWith('image/') ? '🖼️ Image' : '📄 File'}
                              </Badge>
                            ) : (
                              <Badge variant="outline">Text</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {formatBytes(msg.ciphertext_size)}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {msg.decryption_success ? formatBytes(msg.decrypted_size * 2) : '-'}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {msg.decryption_success ? `${msg.decryption_time_ms.toFixed(2)} ms` : '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {msg.diffusion !== undefined ? (
                              <span className={msg.diffusion >= 45 ? 'text-green-500' : 'text-yellow-500'}>
                                {msg.diffusion.toFixed(1)}%
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {msg.confusion !== undefined ? (
                              <span className={msg.confusion >= 45 ? 'text-green-500' : 'text-yellow-500'}>
                                {msg.confusion.toFixed(1)}%
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {msg.collision_resistant ? (
                              <Badge variant="outline" className="border-green-500">✓ Unique</Badge>
                            ) : (
                              <Badge variant="outline" className="border-red-500">✗ Collision</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {msg.decryption_success ? (
                                <Badge variant="default" className="bg-green-500">Decrypted</Badge>
                              ) : (
                                <Badge variant="destructive">Failed</Badge>
                              )}
                              {msg.hash_verified ? (
                                <Badge variant="outline" className="border-green-500">✓ Hash</Badge>
                              ) : (
                                <Badge variant="outline" className="border-red-500">✗ Hash</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
