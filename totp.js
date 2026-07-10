/**
 * TOTP (Time-based One-Time Password) implementation
 * RFC 6238 - Using Web Crypto API (no external dependencies)
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a Base32 encoded string to a Uint8Array
 */
function base32Decode(str) {
  const cleaned = str.replace(/[\s-=]/g, '').toUpperCase();
  const bytes = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of cleaned) {
    if (char === '=') break;
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;

    buffer = (buffer << 5) | idx;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xFF);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return new Uint8Array(bytes);
}

/**
 * Convert an integer to an 8-byte big-endian buffer
 */
function intTo8Bytes(num) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(num), false);
  return new Uint8Array(buf);
}

/**
 * Generate a TOTP code using Web Crypto API
 * @param {string} secret - Base32 encoded secret key
 * @param {number} [timeStep=30] - Time step in seconds
 * @param {number} [digits=6] - Number of digits in the code
 * @returns {Promise<string>} The TOTP code
 */
async function generateTOTP(secret, timeStep = 30, digits = 6) {
  const keyBytes = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const counterBytes = intTo8Bytes(counter);

  // Import the key for HMAC-SHA1
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  // Compute HMAC-SHA1
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
  const hmac = new Uint8Array(signature);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0xf;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = truncated % Math.pow(10, digits);
  return code.toString().padStart(digits, '0');
}

/**
 * Get the time remaining in the current TOTP window
 * @param {number} [timeStep=30] - Time step in seconds
 * @returns {number} Seconds remaining
 */
function getTimeRemaining(timeStep = 30) {
  return timeStep - (Math.floor(Date.now() / 1000) % timeStep);
}

/**
 * Get the current TOTP window progress (0-1)
 * @param {number} [timeStep=30] - Time step in seconds
 * @returns {number} Progress from 0 to 1
 */
function getTOTPProgress(timeStep = 30) {
  return (Math.floor(Date.now() / 1000) % timeStep) / timeStep;
}

/**
 * Parse an otpauth:// URI
 * @param {string} uri - The otpauth:// URI
 * @returns {{ issuer: string, account: string, secret: string } | null}
 */
function parseOTPAuthURI(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'otpauth:' || url.host !== 'totp') return null;

    // Path is /issuer:account or /:label
    const path = decodeURIComponent(url.pathname).replace(/^\//, '');
    const secret = url.searchParams.get('secret') || '';
    const issuerParam = url.searchParams.get('issuer') || '';

    let issuer = issuerParam;
    let account = path;

    // Try to split "issuer:account" format
    if (!issuer && path.includes(':')) {
      const colonIdx = path.indexOf(':');
      issuer = path.substring(0, colonIdx);
      account = path.substring(colonIdx + 1);
    } else if (path.includes(':')) {
      const colonIdx = path.indexOf(':');
      account = path.substring(colonIdx + 1);
    }

    return {
      issuer: issuer || '未知',
      account: account || issuer || '未知',
      secret: secret
    };
  } catch {
    return null;
  }
}

export {
  generateTOTP,
  getTimeRemaining,
  getTOTPProgress,
  parseOTPAuthURI,
  base32Decode
};
