import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCryptoKeys } from '@/hooks/useCryptoKeys';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Shield, MessageSquare, Database, Key, Settings, LogOut, BarChart3 } from 'lucide-react';

export default function ChatList() {
  const { user, signOut } = useCryptoKeys();
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      loadUsers();
    }
  }, [user]);

  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('user_keys')
      .select('*')
      .neq('user_id', user?.id);
    
    if (!error && data) {
      setUsers(data);
    }
  };

  const filteredUsers = users.filter(u =>
    (u.display_name || u.user_id).toLowerCase().includes(search.toLowerCase())
  );

  const startChat = (recipientId: string) => {
    navigate(`/chat/${recipientId}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-[0_0_20px_hsl(var(--primary)/0.3)]">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">SecureChat</h1>
              <p className="text-xs text-muted-foreground">End-to-end encrypted</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')}>
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/database')}>
              <Database className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/verify')}>
              <Key className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto flex-1 px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">Start a conversation</h2>
            <p className="text-muted-foreground">
              All messages are encrypted end-to-end. Server stores only ciphertext.
            </p>
          </div>

          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />

          <div className="grid gap-3">
            {filteredUsers.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No other users yet</p>
                  <p className="text-sm text-muted-foreground">Create another account to test</p>
                </CardContent>
              </Card>
            ) : (
              filteredUsers.map((u) => (
                <Card
                  key={u.user_id}
                  className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
                  onClick={() => startChat(u.user_id)}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                        <MessageSquare className="h-5 w-5 text-secondary-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{u.display_name || 'User'}</p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {u.fingerprint?.substring(0, 16)}...
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">
                      Chat
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
