-- Policy: Allow authenticated users to upload files (INSERT)
CREATE POLICY "Authenticated users can upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'encrypted-files');

-- Policy: Allow authenticated users to download files (SELECT)
CREATE POLICY "Authenticated users can download files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'encrypted-files');

-- Policy: Allow authenticated users to delete files (DELETE)
CREATE POLICY "Authenticated users can delete files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'encrypted-files');

-- Policy: Allow authenticated users to update files (UPDATE)
CREATE POLICY "Authenticated users can update files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'encrypted-files')
WITH CHECK (bucket_id = 'encrypted-files');
