import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function Database() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    loadMessages();
  }, []);

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!error && data) {
      setMessages(data);
    }
  };

  const truncate = (str: string, len: number = 20) =>
    showFull ? str : str.length > len ? str.substring(0, len) + '...' : str;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/chats')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Database View</h1>
              <p className="text-muted-foreground">Proof of ciphertext-only storage</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFull(!showFull)}
          >
            {showFull ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {showFull ? 'Hide Full Data' : 'Show Full Data'}
          </Button>
        </div>

        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Zero-Knowledge Architecture</AlertTitle>
          <AlertDescription>
            This server stores <strong>no plaintext</strong>. All content is encrypted before upload. 
            Only ciphertext, IVs, wrapped keys, and hashes are stored. Decryption happens exclusively on the client.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Messages Table (Raw Database View)</CardTitle>
            <CardDescription>
              Direct view of encrypted messages as stored in the database
            </CardDescription>
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No messages in database yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Wrap Alg</TableHead>
                      <TableHead>Ciphertext</TableHead>
                      <TableHead>IV</TableHead>
                      <TableHead>Wrapped Key</TableHead>
                      <TableHead>Hash</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messages.map((msg) => (
                      <TableRow key={msg.id}>
                        <TableCell className="text-xs">
                          {new Date(msg.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{msg.wrap_alg}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px]">
                          {truncate(msg.ciphertext_base64, 40)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {truncate(msg.iv_base64, 20)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {truncate(msg.wrapped_key_base64, 20)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {truncate(msg.hash_hex, 16)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {showFull && messages.length > 0 && (
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle className="font-mono text-sm">Full Base64 Data (First Message)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs font-mono break-all">
              <div>
                <p className="text-muted-foreground mb-1">ciphertext_base64:</p>
                <p className="bg-background p-2 rounded">{messages[0].ciphertext_base64}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">iv_base64:</p>
                <p className="bg-background p-2 rounded">{messages[0].iv_base64}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">wrapped_key_base64:</p>
                <p className="bg-background p-2 rounded">{messages[0].wrapped_key_base64}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">hash_hex:</p>
                <p className="bg-background p-2 rounded">{messages[0].hash_hex}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
