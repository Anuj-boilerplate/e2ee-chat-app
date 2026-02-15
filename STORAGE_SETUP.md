# Supabase Storage Setup

To enable file upload functionality, you need to create a storage bucket in Supabase.

## 🚨 QUICK FIX (If you're getting RLS errors)

**If you see "new row violates row-level security policy" error:**

1. **Open `SETUP_STORAGE_NOW.sql` file in this project**
2. **Copy all the SQL code**
3. **Go to Supabase Dashboard → SQL Editor → New Query**
4. **Paste and run the SQL**
5. **Create the bucket manually** (see Step 1 below)

This will fix the RLS policy error immediately!

## Quick Setup (3 Steps)

### Step 1: Create the Bucket

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Storage** in the left sidebar
4. Click **"New bucket"** button (top right)
5. Enter bucket name: `encrypted-files` (must be exactly this name)
6. Make it **Private** (uncheck "Public bucket")
7. Click **"Create bucket"**

### Step 2: Set Up Storage Policies

After creating the bucket, you need to allow authenticated users to upload and download files.

Go to **Storage** → **Policies** → Select `encrypted-files` bucket → Click **"New Policy"**

Or use SQL in the SQL Editor:

#### Option A: Using SQL Editor (Recommended)

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **"New query"**
3. Paste this SQL and run it:

```sql
-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'encrypted-files');

-- Allow authenticated users to download files
CREATE POLICY "Authenticated users can download files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'encrypted-files');
```

#### Option B: Using Dashboard UI

1. Go to **Storage** → **Policies**
2. Select the `encrypted-files` bucket
3. Click **"New Policy"**
4. For Upload Policy:
   - Policy name: "Allow authenticated uploads"
   - Allowed operation: INSERT
   - Target roles: authenticated
   - Policy definition: `bucket_id = 'encrypted-files'`
5. Click **"Review"** then **"Save policy"**
6. Repeat for SELECT operation (download)

### Step 3: Verify

Try uploading a file in the chat. If you see an error, check:
- Bucket name is exactly `encrypted-files` (case-sensitive)
- Bucket is set to Private
- Policies are created for INSERT and SELECT operations

## Troubleshooting

**Error: "Bucket not found"**
- Make sure the bucket name is exactly `encrypted-files` (no spaces, lowercase)
- Check that the bucket exists in Storage → Buckets

**Error: "Permission denied"**
- Verify storage policies are set up correctly
- Make sure you're authenticated when testing

**Files not downloading**
- Check SELECT policy is enabled
- Verify the bucket is accessible to authenticated users

