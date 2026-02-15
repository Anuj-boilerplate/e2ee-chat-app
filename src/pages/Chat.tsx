import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCryptoKeys } from '@/hooks/useCryptoKeys';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Send, Shield, Image, File, X, Lock, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  genAesGcmKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
  generateIV,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToArrayBuffer,
  arrayBufferToString,
} from '@/lib/crypto/symmetric';
import {
  importECDHPublicJwk,
  importRSAPublicJwk,
} from '@/lib/crypto';
import {
  wrapAesKeyWithECDH,
  unwrapAesKeyWithECDH,
  wrapAesKeyWithRSA,
  unwrapAesKeyWithRSA,
} from '@/lib/crypto/wrap';
import { sha256Hex } from '@/lib/crypto/hash';

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  ciphertext_base64: string;
  iv_base64: string;
  wrapped_key_base64: string;
  wrap_alg: string;
  salt_base64: string;
  hash_hex: string;
  created_at: string;
  file_url?: string | null;
  file_meta?: any;
  decryptedContent?: string;
  decryptedFile?: {
    url: string;
    name: string;
    type: string;
    size: number;
  } | null;
}

export default function Chat() {
  const { recipientId } = useParams<{ recipientId: string }>();
  const navigate = useNavigate();
  const { user, keys } = useCryptoKeys();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipient, setRecipient] = useState<any>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [encryptionDetails, setEncryptionDetails] = useState<{
    ciphertext: string;
    hash: string;
    algorithm: string;
    fileName: string;
    fileSize: number;
    fileEncryptedSize?: number;
    fileIv?: string;
    fileSalt?: string;
    fileWrappedKey?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recipientId || !user || !keys) return;
    loadRecipientAndChat();
  }, [recipientId, user, keys]);

  useEffect(() => {
    if (chatId) {
      loadMessages();
      const cleanup = subscribeToMessages();
      return cleanup;
    }
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadRecipientAndChat = async () => {
    try {
      // Load recipient's public keys
      const { data: recipientData, error: recipientError } = await supabase
        .from('user_keys')
        .select('*')
        .eq('user_id', recipientId)
        .single();

      if (recipientError || !recipientData) {
        toast({
          title: 'Error',
          description: 'Could not load recipient information',
          variant: 'destructive',
        });
        navigate('/chats');
        return;
      }

      setRecipient(recipientData);

      // Find or create chat
      const roomId = [user!.id, recipientId].sort().join('-');
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('*')
        .eq('room_id', roomId)
        .single();

      if (chatError && chatError.code !== 'PGRST116') {
        // PGRST116 = not found, which is fine
        toast({
          title: 'Error',
          description: 'Could not load chat',
          variant: 'destructive',
        });
        return;
      }

      if (!chatData) {
        // Create new chat
        const { data: newChat, error: createError } = await supabase
          .from('chats')
          .insert({
            room_id: roomId,
            participant_a: user!.id,
            participant_b: recipientId,
          })
          .select()
          .single();

        if (createError) {
          toast({
            title: 'Error',
            description: 'Could not create chat',
            variant: 'destructive',
          });
          return;
        }

        setChatId(newChat.id);
      } else {
        setChatId(chatData.id);
      }
    } catch (error) {
      console.error('Error loading chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to load chat',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async () => {
    if (!chatId) return;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
      return;
    }

    // Decrypt messages
    const decryptedMessages = await Promise.all(
      (data || []).map(async (msg) => {
        try {
          const decrypted = await decryptMessage(msg);
          return { 
            ...msg, 
            decryptedContent: decrypted.text,
            decryptedFile: decrypted.file || null
          };
        } catch (error) {
          console.error('Error decrypting message:', error);
          return { ...msg, decryptedContent: '[Decryption failed]' };
        }
      })
    );

    setMessages(decryptedMessages);
  };

  const subscribeToMessages = () => {
    if (!chatId) return;

    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const newMessage = payload.new as Message;
          try {
            const decrypted = await decryptMessage(newMessage);
            setMessages((prev) => [...prev, { 
              ...newMessage, 
              decryptedContent: decrypted.text,
              decryptedFile: decrypted.file || null
            }]);
          } catch (error) {
            console.error('Error decrypting new message:', error);
            setMessages((prev) => [...prev, { ...newMessage, decryptedContent: '[Decryption failed]' }]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Limit file size to 10MB
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'File size must be less than 10MB',
          variant: 'destructive',
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const decryptMessage = async (msg: Message): Promise<{ text?: string; file?: { url: string; name: string; type: string; size: number } }> => {
    if (!keys || !recipient || !user) throw new Error('Keys, recipient, or user not loaded');

    try {
      // Decode message data
      const iv = new Uint8Array(base64ToArrayBuffer(msg.iv_base64));
      const salt = new Uint8Array(base64ToArrayBuffer(msg.salt_base64));
      const ciphertext = base64ToArrayBuffer(msg.ciphertext_base64);
      const wrappedKey = base64ToArrayBuffer(msg.wrapped_key_base64);

      // Unwrap the AES key
      let aesKey: CryptoKey;
      if (msg.wrap_alg === 'ECDH') {
        if (msg.sender_id === user.id) {
          // We sent this message - use recipient's public key (which we already have)
          const recipientEcdhPub = await importECDHPublicJwk(recipient.ecdh_public_key_jwk as JsonWebKey);
          aesKey = await unwrapAesKeyWithECDH(wrappedKey, keys.ecdhKeyPair!.privateKey, recipientEcdhPub, salt);
        } else {
          // We received this message - need sender's public key
          // The sender's public key is the same as recipient's if recipientId matches sender_id
          // Otherwise, we need to fetch it
          let senderEcdhPub: CryptoKey;
          if (msg.sender_id === recipientId) {
            senderEcdhPub = await importECDHPublicJwk(recipient.ecdh_public_key_jwk as JsonWebKey);
          } else {
            // Fetch sender's keys from database
            const { data: senderData } = await supabase
              .from('user_keys')
              .select('ecdh_public_key_jwk')
              .eq('user_id', msg.sender_id)
              .single();
            if (!senderData) throw new Error('Sender keys not found');
            senderEcdhPub = await importECDHPublicJwk(senderData.ecdh_public_key_jwk as JsonWebKey);
          }
          aesKey = await unwrapAesKeyWithECDH(wrappedKey, keys.ecdhKeyPair!.privateKey, senderEcdhPub, salt);
        }
      } else {
        // RSA fallback
        aesKey = await unwrapAesKeyWithRSA(wrappedKey, keys.rsaKeyPair!.privateKey);
      }

      // Decrypt the message
      const decrypted = await aesGcmDecrypt(aesKey, iv, ciphertext);
      const decryptedText = arrayBufferToString(decrypted);

      // Check if this is a file message
      if (msg.file_meta) {
        try {
          let encryptedFileBuffer: ArrayBuffer;
          
          // Check if file is stored inline or in storage
          if (msg.file_meta.storage_type === 'inline' && msg.file_meta.encrypted_data_base64) {
            // File is stored inline as base64
            encryptedFileBuffer = base64ToArrayBuffer(msg.file_meta.encrypted_data_base64);
          } else if (msg.file_url) {
            // File is in storage - download it
            const { data: fileData, error: downloadError } = await supabase.storage
              .from('encrypted-files')
              .download(msg.file_url);

            if (downloadError) {
              console.error('Error downloading file:', downloadError);
              // If bucket doesn't exist, log it but don't fail the message
              if (downloadError.message?.includes('Bucket') || downloadError.message?.includes('not found')) {
                console.error('Storage bucket "encrypted-files" not found. Please create it in Supabase Storage settings.');
              }
              // Return message text even if file download fails
              return { text: decryptedText };
            }

            // Decrypt file
            encryptedFileBuffer = await fileData.arrayBuffer();
          } else {
            // No file data available
            return { text: decryptedText };
          }
          
          // Get file decryption parameters from metadata
          if (!msg.file_meta.iv || !msg.file_meta.salt || !msg.file_meta.wrapped_key) {
            console.error('Missing file decryption parameters in file_meta:', {
              hasIv: !!msg.file_meta.iv,
              hasSalt: !!msg.file_meta.salt,
              hasWrappedKey: !!msg.file_meta.wrapped_key,
              fileMeta: msg.file_meta,
            });
            return { text: decryptedText };
          }
          
          const fileIv = new Uint8Array(base64ToArrayBuffer(msg.file_meta.iv));
          const fileSalt = new Uint8Array(base64ToArrayBuffer(msg.file_meta.salt));
          const fileWrappedKey = base64ToArrayBuffer(msg.file_meta.wrapped_key);

          // Unwrap the file key - use the wrap_alg from file_meta if available, otherwise use message wrap_alg
          let fileAesKey: CryptoKey;
          const fileWrapAlg = msg.file_meta.wrap_alg || msg.wrap_alg;
          if (fileWrapAlg === 'ECDH') {
            // For ECDH, we need the other party's public key
            let otherPartyEcdhPub: CryptoKey;
            if (msg.sender_id === user.id) {
              // We sent it - use recipient's public key
              otherPartyEcdhPub = await importECDHPublicJwk(recipient.ecdh_public_key_jwk as JsonWebKey);
            } else {
              // We received it - need sender's public key
              if (msg.sender_id === recipientId) {
                otherPartyEcdhPub = await importECDHPublicJwk(recipient.ecdh_public_key_jwk as JsonWebKey);
              } else {
                const { data: senderData } = await supabase
                  .from('user_keys')
                  .select('ecdh_public_key_jwk')
                  .eq('user_id', msg.sender_id)
                  .single();
                if (!senderData) throw new Error('Sender keys not found');
                otherPartyEcdhPub = await importECDHPublicJwk(senderData.ecdh_public_key_jwk as JsonWebKey);
              }
            }
            fileAesKey = await unwrapAesKeyWithECDH(fileWrappedKey, keys.ecdhKeyPair!.privateKey, otherPartyEcdhPub, fileSalt);
          } else {
            // RSA fallback
            fileAesKey = await unwrapAesKeyWithRSA(fileWrappedKey, keys.rsaKeyPair!.privateKey);
          }

          // Decrypt the file
          console.log('Decrypting file:', {
            encryptedSize: encryptedFileBuffer.byteLength,
            ivLength: fileIv.length,
            saltLength: fileSalt.length,
            wrapAlg: fileWrapAlg,
            storageType: msg.file_meta.storage_type || 'storage',
          });
          
          const decryptedFileBuffer = await aesGcmDecrypt(fileAesKey, fileIv, encryptedFileBuffer);
          
          console.log('File decrypted successfully:', {
            decryptedSize: decryptedFileBuffer.byteLength,
            fileType: msg.file_meta.type,
            fileName: msg.file_meta.name,
          });
          
          // Create a blob URL for the decrypted file
          const decryptedBlob = new Blob([decryptedFileBuffer], { type: msg.file_meta.type || 'application/octet-stream' });
          const fileUrl = URL.createObjectURL(decryptedBlob);

          return {
            text: decryptedText,
            file: {
              url: fileUrl,
              name: msg.file_meta.name || 'file',
              type: msg.file_meta.type || 'application/octet-stream',
              size: msg.file_meta.size || 0,
            }
          };
        } catch (err) {
          console.error('Error handling file decryption:', err);
          console.error('File metadata:', msg.file_meta);
          // Return message text even if file decryption fails
          return { text: decryptedText };
        }
      }

      return { text: decryptedText };
    } catch (error) {
      console.error('Decryption error:', error);
      throw error;
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && !selectedFile) || !chatId || !keys || !recipient || !user) return;

    setUploading(true);
    try {
      // Import recipient's public keys
      const recipientEcdhPub = await importECDHPublicJwk(recipient.ecdh_public_key_jwk as JsonWebKey);
      const recipientRsaPub = await importRSAPublicJwk(recipient.rsa_public_key_jwk as JsonWebKey);

      let plaintext: ArrayBuffer;
      let fileMeta: any = null;
      let fileUrl: string | null = null;

      // Handle file upload
      let encryptedFile: ArrayBuffer | undefined;
      if (selectedFile) {
        console.log('Starting file upload:', {
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          fileType: selectedFile.type,
        });
        
        const fileArrayBuffer = await selectedFile.arrayBuffer();
        
        // Encrypt file content
        const fileAesKey = await genAesGcmKey();
        const fileIv = generateIV();
        const fileSalt = generateSalt();
        encryptedFile = await aesGcmEncrypt(fileAesKey, fileIv, fileArrayBuffer);
        
        console.log('File encrypted:', {
          originalSize: fileArrayBuffer.byteLength,
          encryptedSize: encryptedFile.byteLength,
          iv: arrayBufferToBase64(fileIv.buffer).substring(0, 50) + '...',
          salt: arrayBufferToBase64(fileSalt.buffer).substring(0, 50) + '...',
        });

        // Wrap file key
        let fileWrappedKey: ArrayBuffer;
        let fileWrapAlg: string;
        try {
          fileWrappedKey = await wrapAesKeyWithECDH(fileAesKey, keys.ecdhKeyPair!.privateKey, recipientEcdhPub, fileSalt);
          fileWrapAlg = 'ECDH';
          console.log('File key wrapped with ECDH');
        } catch (error) {
          console.warn('ECDH wrap failed, falling back to RSA:', error);
          fileWrappedKey = await wrapAesKeyWithRSA(fileAesKey, recipientRsaPub);
          fileWrapAlg = 'RSA-OAEP';
          console.log('File key wrapped with RSA-OAEP');
        }
        
        console.log('File key wrapped:', {
          wrappedKeyLength: fileWrappedKey.byteLength,
          algorithm: fileWrapAlg,
          wrappedKeyPreview: arrayBufferToBase64(fileWrappedKey).substring(0, 100) + '...',
        });

        // Store encrypted file - try storage first, fallback to inline storage for small files
        const fileName = `${chatId}/${Date.now()}_${selectedFile.name}`;
        const encryptedBlob = new Blob([encryptedFile!], { type: 'application/octet-stream' });
        const encryptedBase64 = arrayBufferToBase64(encryptedFile!);
        
        // Try to upload file to storage
        let { data: uploadData, error: uploadError } = await supabase.storage
          .from('encrypted-files')
          .upload(fileName, encryptedBlob, {
            contentType: 'application/octet-stream',
            upsert: false,
          });

        // Initialize fileMeta with required fields first
        fileMeta = {
          name: selectedFile.name,
          type: selectedFile.type,
          size: selectedFile.size,
          iv: arrayBufferToBase64(fileIv.buffer),
          salt: arrayBufferToBase64(fileSalt.buffer),
          wrapped_key: arrayBufferToBase64(fileWrappedKey),
          wrap_alg: fileWrapAlg,
        };

        // If storage fails, store inline for small files (< 5MB encrypted)
        if (uploadError && encryptedBase64.length < 5 * 1024 * 1024) {
          console.warn('Storage upload failed, storing inline:', uploadError.message);
          // Store as base64 in file_meta instead
          fileUrl = null; // No storage URL, use inline storage
          // fileMeta already has all required fields from initialization above
          fileMeta = {
            ...fileMeta,
            encrypted_data_base64: encryptedBase64, // Store encrypted file inline
            storage_type: 'inline',
          };
          console.log('File stored inline with metadata:', {
            hasIv: !!fileMeta.iv,
            hasSalt: !!fileMeta.salt,
            hasWrappedKey: !!fileMeta.wrapped_key,
            encryptedDataSize: encryptedBase64.length,
          });
        } else if (uploadError) {
          // For larger files, try to create bucket and retry
          if (uploadError.message?.includes('Bucket') || uploadError.message?.includes('not found') || uploadError.statusCode === '404' || uploadError.statusCode === 404) {
            console.warn('Storage bucket not found, attempting to create...', uploadError);
            const { error: createError } = await supabase.storage.createBucket('encrypted-files', {
              public: false,
              fileSizeLimit: 10485760,
              allowedMimeTypes: null,
            });

            if (!createError) {
              // Retry upload after creating bucket
              const retry = await supabase.storage
                .from('encrypted-files')
                .upload(fileName, encryptedBlob, {
                  contentType: 'application/octet-stream',
                  upsert: false,
                });
              
              if (!retry.error) {
                uploadData = retry.data;
                uploadError = null;
              } else if (retry.error.message?.includes('row-level security') || retry.error.message?.includes('RLS')) {
                // If RLS error, fallback to inline for small files
                if (encryptedBase64.length < 5 * 1024 * 1024) {
                  fileUrl = null;
                  fileMeta = {
                    ...fileMeta,
                    encrypted_data_base64: encryptedBase64,
                    storage_type: 'inline',
                  };
                  uploadError = null;
                } else {
                  throw new Error('File too large for inline storage. Please set up storage bucket policies in Supabase Dashboard.');
                }
              }
            } else if (encryptedBase64.length < 5 * 1024 * 1024) {
              // Fallback to inline storage
              fileUrl = null;
              fileMeta = {
                ...fileMeta,
                encrypted_data_base64: encryptedBase64,
                storage_type: 'inline',
              };
              uploadError = null;
            }
          }
          
          // If still has error and file is small, use inline
          if (uploadError && encryptedBase64.length < 5 * 1024 * 1024) {
            fileUrl = null;
            fileMeta = {
              ...fileMeta,
              encrypted_data_base64: encryptedBase64,
              storage_type: 'inline',
            };
            uploadError = null;
          } else if (uploadError) {
            throw new Error(`File upload failed: ${uploadError.message || 'Storage not available'}`);
          }
        }
        
        if (!uploadError) {
          console.log('File uploaded successfully:', { fileName, fileSize: encryptedBlob.size, storageType: fileUrl ? 'storage' : 'inline' });
        }

        // fileMeta is already initialized above with all required fields

        // Create a text message with file info
        plaintext = stringToArrayBuffer(`📎 ${selectedFile.name} (${formatFileSize(selectedFile.size)})`);
      } else {
        plaintext = stringToArrayBuffer(message);
      }

      // Generate AES key and encrypt message
      const aesKey = await genAesGcmKey();
      const iv = generateIV();
      const salt = generateSalt();
      const ciphertext = await aesGcmEncrypt(aesKey, iv, plaintext);

      // Wrap the AES key (prefer ECDH, fallback to RSA)
      let wrappedKey: ArrayBuffer;
      let wrapAlg: string;
      try {
        wrappedKey = await wrapAesKeyWithECDH(aesKey, keys.ecdhKeyPair!.privateKey, recipientEcdhPub, salt);
        wrapAlg = 'ECDH';
      } catch (error) {
        wrappedKey = await wrapAesKeyWithRSA(aesKey, recipientRsaPub);
        wrapAlg = 'RSA-OAEP';
      }

      // Compute hash
      const hash = await sha256Hex(arrayBufferToBase64(ciphertext));
      
      // Prepare message data
      const ciphertextBase64 = arrayBufferToBase64(ciphertext);
      const messageData = {
        chat_id: chatId,
        sender_id: user.id,
        recipient_id: recipientId!,
        ciphertext_base64: ciphertextBase64,
        iv_base64: arrayBufferToBase64(iv.buffer),
        wrapped_key_base64: arrayBufferToBase64(wrappedKey),
        wrap_alg: wrapAlg,
        salt_base64: arrayBufferToBase64(salt.buffer),
        hash_hex: hash,
        file_url: fileUrl,
        file_meta: fileMeta,
      };

      // Log ciphertext for debugging (first 100 chars)
      console.log('Message encryption details:', {
        ciphertext_preview: ciphertextBase64.substring(0, 100) + '...',
        ciphertext_length: ciphertextBase64.length,
        hash: hash,
        wrap_alg: wrapAlg,
        has_file: !!fileUrl,
        file_name: fileMeta?.name || 'N/A',
      });

      // Save to database
      const { data: insertedData, error } = await supabase.from('messages').insert(messageData).select();

      if (error) {
        console.error('Database insert error:', error);
        console.error('Message data that failed:', {
          ...messageData,
          ciphertext_base64: ciphertextBase64.substring(0, 200) + '... (truncated)',
        });
        throw new Error(`Database error: ${error.message} (Code: ${error.code || 'unknown'})`);
      }
      
      // Log success with ciphertext
      console.log('Message sent successfully!', {
        message_id: insertedData?.[0]?.id,
        ciphertext_preview: ciphertextBase64.substring(0, 100) + '...',
        full_ciphertext: ciphertextBase64,
      });

      // Show encryption details for files/images
      if (selectedFile && fileMeta) {
        setEncryptionDetails({
          ciphertext: ciphertextBase64,
          hash: hash,
          algorithm: wrapAlg,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          fileEncryptedSize: encryptedFile?.byteLength,
          fileIv: fileMeta.iv,
          fileSalt: fileMeta.salt,
          fileWrappedKey: fileMeta.wrapped_key,
        });
        
        // Clear encryption details after 30 seconds
        setTimeout(() => {
          setEncryptionDetails(null);
        }, 30000); // 30 seconds
      }

      setMessage('');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      toast({
        title: 'Message sent',
        description: selectedFile ? 'Your encrypted file has been sent' : 'Your encrypted message has been sent',
      });
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Extract detailed error information
      let errorMessage = 'Failed to send message';
      let errorDetails = '';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        errorDetails = error.stack || error.toString();
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = JSON.stringify(error);
        errorDetails = String(error);
      }
      
      // Log full error details to console
      console.error('Full error details:', {
        error,
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // Show detailed error in toast
      toast({
        title: 'Error Sending Message',
        description: errorMessage,
        variant: 'destructive',
        duration: 10000, // Show for 10 seconds
      });
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Loading chat...</p>
        </div>
      </div>
    );
  }

  if (!recipient) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">Recipient not found</p>
          <Button onClick={() => navigate('/chats')} className="mt-4">
            Back to Chats
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/chats')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{recipient.display_name || 'User'}</h1>
              <p className="text-xs text-muted-foreground font-mono">
                {recipient.fingerprint?.substring(0, 16)}...
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="container mx-auto flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No messages yet</p>
                <p className="text-sm text-muted-foreground">Start the conversation</p>
              </CardContent>
            </Card>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <Card
                  className={`max-w-[80%] ${
                    msg.sender_id === user?.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <CardContent className="p-3">
                    {msg.decryptedFile && (
                      <div className="mb-2 space-y-2">
                        {msg.decryptedFile.type.startsWith('image/') ? (
                          <div className="rounded overflow-hidden">
                            <img 
                              src={msg.decryptedFile.url} 
                              alt={msg.decryptedFile.name}
                              className="max-w-full max-h-64 object-contain"
                              onError={(e) => {
                                console.error('Error loading image');
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </div>
                        ) : (
                          <div className="p-2 bg-background/50 rounded flex items-center gap-2">
                            <File className="h-4 w-4" />
                            <a
                              href={msg.decryptedFile.url}
                              download={msg.decryptedFile.name}
                              className="text-xs hover:underline flex-1"
                            >
                              {msg.decryptedFile.name}
                            </a>
                            <span className="text-xs opacity-70">({formatFileSize(msg.decryptedFile.size)})</span>
                          </div>
                        )}
                      </div>
                    )}
                    {msg.decryptedContent && (
                      <p className="text-sm">{msg.decryptedContent}</p>
                    )}
                    <p
                      className={`text-xs mt-1 ${
                        msg.sender_id === user?.id
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Encryption Details Alert */}
      {encryptionDetails && (
        <div className="container mx-auto px-4 pt-2">
          <Alert className="mx-auto max-w-2xl">
            <Lock className="h-4 w-4" />
            <AlertTitle className="flex items-center justify-between">
              <span>Image Encryption Details</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(encryptionDetails.ciphertext);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="h-6 px-2"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEncryptionDetails(null)}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </AlertTitle>
            <AlertDescription className="space-y-3 mt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-semibold">File:</span> {encryptionDetails.fileName}
                </div>
                <div>
                  <span className="font-semibold">Size:</span> {formatFileSize(encryptionDetails.fileSize)}
                </div>
                <div>
                  <span className="font-semibold">Encrypted Size:</span> {encryptionDetails.fileEncryptedSize ? formatFileSize(encryptionDetails.fileEncryptedSize) : 'N/A'}
                </div>
                <div>
                  <span className="font-semibold">Algorithm:</span> {encryptionDetails.algorithm}
                </div>
                <div className="col-span-2">
                  <span className="font-semibold">Hash:</span> <code className="text-xs">{encryptionDetails.hash}</code>
                </div>
              </div>
              <div>
                <span className="font-semibold text-xs block mb-1">Ciphertext (Base64):</span>
                <div className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto">
                  {encryptionDetails.ciphertext}
                </div>
              </div>
              {encryptionDetails.fileIv && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-semibold">File IV:</span>
                    <code className="block text-xs mt-1 break-all">{encryptionDetails.fileIv.substring(0, 50)}...</code>
                  </div>
                  <div>
                    <span className="font-semibold">File Salt:</span>
                    <code className="block text-xs mt-1 break-all">{encryptionDetails.fileSalt?.substring(0, 50)}...</code>
                  </div>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Message Input */}
      <footer className="border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <form onSubmit={sendMessage} className="mx-auto max-w-2xl space-y-2">
            {selectedFile && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                {selectedFile.type.startsWith('image/') ? (
                  <Image className="h-4 w-4" />
                ) : (
                  <File className="h-4 w-4" />
                )}
                <span className="text-sm flex-1 truncate">{selectedFile.name}</span>
                <span className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={removeFile}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                id="file-input"
                accept="image/*"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Image className="h-4 w-4" />
              </Button>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1"
                disabled={uploading}
              />
              <Button type="submit" disabled={(!message.trim() && !selectedFile) || uploading}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </footer>
    </div>
  );
}

