-- ============================================
-- QUICK FIX: Run this SQL in Supabase Dashboard
-- ============================================
-- 
-- Instructions:
-- 1. Go to https://supabase.com/dashboard
-- 2. Select your project
-- 3. Go to SQL Editor
-- 4. Click "New query"
-- 5. Paste this entire file
-- 6. Click "Run" or press Ctrl+Enter
--
-- ============================================

-- Step 1: Create storage policies for encrypted-files bucket
-- (The bucket must be created first via Dashboard → Storage → New Bucket)

-- Allow authenticated users to upload files
CREATE POLICY IF NOT EXISTS "Authenticated users can upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'encrypted-files');

-- Allow authenticated users to download files
CREATE POLICY IF NOT EXISTS "Authenticated users can download files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'encrypted-files');

-- Allow authenticated users to delete their own files
CREATE POLICY IF NOT EXISTS "Authenticated users can delete files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'encrypted-files');

-- Allow authenticated users to update their own files
CREATE POLICY IF NOT EXISTS "Authenticated users can update files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'encrypted-files')
WITH CHECK (bucket_id = 'encrypted-files');

-- ============================================
-- IMPORTANT: Also create the bucket manually:
-- ============================================
-- 1. Go to Storage in Supabase Dashboard
-- 2. Click "New bucket"
-- 3. Name: encrypted-files (exactly, lowercase)
-- 4. Make it PRIVATE (uncheck "Public bucket")
-- 5. Click "Create bucket"
-- ============================================

