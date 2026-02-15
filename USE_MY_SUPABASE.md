# Using Your Own Supabase Project

## Where is the database?

The app has **no local database**. Everything lives in **Supabase**:

- **Auth** – sign up / sign in (Supabase Auth)
- **Database** – `user_keys`, `chats`, `messages` (Supabase Postgres)
- **Realtime** – live message updates (Supabase Realtime)
- **Storage** – encrypted files/images (Supabase Storage, optional; app can fall back to inline storage)

The app connects to Supabase using two environment variables. Point those at **your** Supabase project and run the migrations there; then the app runs entirely on your server.

---

## Steps to run on YOUR Supabase server

### 1. Create a Supabase project (if you haven’t)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard).
2. **New project** → choose org, name, password, region.
3. Wait until the project is ready.

### 2. Get your project URL and anon key

1. In the dashboard, open **Project Settings** (gear icon).
2. Go to **API**.
3. Copy:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon public** key (under "Project API keys")

### 3. Create the database schema (tables + RLS)

1. In the dashboard, open **SQL Editor**.
2. **New query**.
3. Paste the **entire** contents of:
   - `supabase/migrations/20251106041734_03e0b3a7-553c-4ee0-867b-9dbf296e440f.sql`
4. **Run**.
5. Create another **New query**.
6. Paste the contents of:
   - `supabase/migrations/20251106041800_storage_policies.sql`
7. **Run** (this only adds storage policies; the bucket is created in the next step).

### 4. Create the storage bucket (for file/image uploads)

1. In the dashboard, go to **Storage**.
2. **New bucket**.
3. Name: **`encrypted-files`** (exactly).
4. Leave it **Private** (do not enable “Public bucket”).
5. **Create bucket**.

(If you skip this, the app can still send images by storing them inline in the `messages` table; storage is optional but recommended for larger files.)

### 5. Configure the app to use your Supabase

In the **project root** (same folder as `package.json`), create or edit **`.env`**:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_public_key_here
```

Replace:

- `YOUR_PROJECT_REF` with your project’s ref (from the Project URL).
- `your_anon_public_key_here` with the **anon public** key from step 2.

Do **not** commit `.env` (it should be in `.gitignore`).

### 6. Run the app

```bash
npm install
npm run dev
```

Open the app (e.g. `http://localhost:5173`), sign up, and use the app. All data will be stored in **your** Supabase project (auth, database, realtime, and storage if you created the bucket).

---

## Summary

| What            | Where it lives                    | How you point the app to it        |
|-----------------|-----------------------------------|------------------------------------|
| Database        | Your Supabase Postgres            | Run migrations (step 3), set .env  |
| Auth            | Your Supabase Auth                | Same .env                          |
| Realtime        | Your Supabase Realtime            | Same .env                          |
| File storage    | Your Supabase Storage (optional)  | Create `encrypted-files` bucket    |

**Single source of truth:** the `.env` file.  
`VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are read in `src/integrations/supabase/client.ts`; every `supabase` call in the app uses that client, so the whole app runs on the Supabase project those variables describe.
