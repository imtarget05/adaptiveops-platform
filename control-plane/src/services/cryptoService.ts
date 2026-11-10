/**
 * Cryptographic utility service using standard W3C Web Crypto API (crypto.subtle).
 * Implements constant-time HMAC-SHA256 verification to prevent timing attacks.
 */

export async function verifyGitHubSignature(
  secret: string,
  rawBody: ArrayBuffer,
  signatureHeader: string | null | undefined
): Promise<boolean> {
  if (!secret || !signatureHeader) {
    return false;
  }

  const trimmed = signatureHeader.trim();
  const prefix = 'sha256=';
  if (!trimmed.startsWith(prefix)) {
    return false;
  }

  const hexSignature = trimmed.slice(prefix.length).trim().toLowerCase();
  if (hexSignature.length !== 64) {
    return false;
  }

  const signatureBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(hexSignature.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      return false;
    }
    signatureBytes[i] = byte;
  }

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBytes,
      rawBody
    );
  } catch (err) {
    console.error('Cryptographic signature verification error:', err);
    return false;
  }
}

/**
 * Computes a valid X-Hub-Signature-256 header value for tests and webhook emission.
 */
export async function computeGitHubSignature(
  secret: string,
  payload: string | ArrayBuffer
): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);
  const dataBytes = typeof payload === 'string' ? encoder.encode(payload) : new Uint8Array(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const hex = signatureArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}
