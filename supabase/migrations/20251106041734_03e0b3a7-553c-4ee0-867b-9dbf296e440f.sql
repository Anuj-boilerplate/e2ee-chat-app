-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users public keys table
create table public.user_keys (
  user_id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  photo_url text,
  ecdh_public_key_jwk jsonb not null,
  rsa_public_key_jwk jsonb not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.user_keys enable row level security;

-- Policies for user_keys (public readable, user can only update their own)
create policy "Public keys are viewable by everyone"
  on public.user_keys for select
  using (true);

create policy "Users can insert their own public keys"
  on public.user_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own public keys"
  on public.user_keys for update
  using (auth.uid() = user_id);

-- Chats table
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  room_id text unique not null,
  participant_a uuid references auth.users(id) on delete cascade not null,
  participant_b uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.chats enable row level security;

-- Policies for chats (only participants can see)
create policy "Users can view their own chats"
  on public.chats for select
  using (auth.uid() = participant_a or auth.uid() = participant_b);

create policy "Users can create chats"
  on public.chats for insert
  with check (auth.uid() = participant_a or auth.uid() = participant_b);

-- Messages table
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender_id uuid references auth.users(id) on delete cascade not null,
  recipient_id uuid references auth.users(id) on delete cascade not null,
  ciphertext_base64 text not null,
  iv_base64 text not null,
  wrapped_key_base64 text not null,
  wrap_alg text not null,
  salt_base64 text not null,
  hash_hex text not null,
  file_url text,
  file_meta jsonb,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.messages enable row level security;

-- Policies for messages (only participants can see)
create policy "Users can view messages in their chats"
  on public.messages for select
  using (
    auth.uid() = sender_id or auth.uid() = recipient_id
  );

create policy "Users can send messages"
  on public.messages for insert
  with check (auth.uid() = sender_id);

-- Enable realtime
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;

-- Function to update updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger for user_keys
create trigger update_user_keys_updated_at
  before update on public.user_keys
  for each row
  execute function public.update_updated_at_column();