// Two-Factor Authentication Controller
// Uses TOTP (Time-based One-Time Password) for 2FA

const User = require('../models/User');
const crypto = require('crypto');

// TOTP settings
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';

// Generate a random secret (base32 encoded)
function generateSecret(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    secret += chars[randomBytes[i] % chars.length];
  }
  return secret;
}

// Base32 decode
function base32Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = input.toUpperCase().split('').map(c => {
    const index = chars.indexOf(c);
    if (index === -1) throw new Error('Invalid base32 character');
    return index.toString(2).padStart(5, '0');
  }).join('');

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

// Generate TOTP code for a given time
function generateTOTP(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / TOTP_PERIOD);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const secretBuffer = base32Decode(secret);
  const hmac = crypto.createHmac(TOTP_ALGORITHM, secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_DIGITS);
  return otp.toString().padStart(TOTP_DIGITS, '0');
}

// Verify TOTP code (allows for time drift)
function verifyTOTP(secret, code, window = 1) {
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const time = now + (i * TOTP_PERIOD * 1000);
    if (generateTOTP(secret, time) === code) {
      return true;
    }
  }
  return false;
}

// Generate backup codes
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push({
      code: code.match(/.{1,4}/g).join('-'), // Format: XXXX-XXXX
      used: false
    });
  }
  return codes;
}

// Get 2FA status
const getStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('twoFactorEnabled twoFactorBackupCodes')
      .lean();

    const unusedBackupCodes = user.twoFactorBackupCodes?.filter(c => !c.used).length || 0;

    res.json({
      enabled: user.twoFactorEnabled || false,
      backupCodesRemaining: unusedBackupCodes
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
};

// Start 2FA setup - generate secret and QR code URL
const setupStart = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Generate a new secret
    const secret = generateSecret();

    // Store secret temporarily (not yet enabled)
    user.twoFactorSecret = secret;
    await user.save();

    // Generate otpauth URL for QR code
    const issuer = 'Emberlan';
    const accountName = user.username;
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    res.json({
      secret,
      otpauthUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code'
    });
  } catch (error) {
    console.error('Setup 2FA start error:', error);
    res.status(500).json({ error: 'Failed to start 2FA setup' });
  }
};

// Complete 2FA setup - verify code and enable
const setupComplete = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== TOTP_DIGITS) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const user = await User.findById(req.user._id);

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: 'Please start 2FA setup first' });
    }

    // Verify the code
    if (!verifyTOTP(user.twoFactorSecret, code)) {
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes();

    // Enable 2FA
    user.twoFactorEnabled = true;
    user.twoFactorBackupCodes = backupCodes;
    await user.save();

    res.json({
      message: '2FA enabled successfully',
      backupCodes: backupCodes.map(c => c.code),
      warning: 'Save these backup codes in a secure location. They can be used to access your account if you lose your authenticator device.'
    });
  } catch (error) {
    console.error('Setup 2FA complete error:', error);
    res.status(500).json({ error: 'Failed to complete 2FA setup' });
  }
};

// Disable 2FA
const disable = async (req, res) => {
  try {
    const { code, password } = req.body;

    const user = await User.findById(req.user._id);

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Require password verification
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Verify 2FA code
    if (!verifyTOTP(user.twoFactorSecret, code)) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    // Disable 2FA
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorBackupCodes = [];
    await user.save();

    res.json({ message: '2FA disabled successfully' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
};

// Verify 2FA code (used during login)
const verify = async (req, res) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and code are required' });
    }

    const user = await User.findById(userId);

    if (!user || !user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Try TOTP code first
    if (verifyTOTP(user.twoFactorSecret, code)) {
      return res.json({ valid: true });
    }

    // Try backup code
    const normalizedCode = code.toUpperCase().replace(/[^A-F0-9]/g, '');
    const formattedCode = normalizedCode.match(/.{1,4}/g)?.join('-');

    const backupCode = user.twoFactorBackupCodes.find(
      c => !c.used && c.code === formattedCode
    );

    if (backupCode) {
      backupCode.used = true;
      await user.save();
      return res.json({
        valid: true,
        usedBackupCode: true,
        backupCodesRemaining: user.twoFactorBackupCodes.filter(c => !c.used).length
      });
    }

    res.status(400).json({ valid: false, error: 'Invalid code' });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
};

// Regenerate backup codes
const regenerateBackupCodes = async (req, res) => {
  try {
    const { code, password } = req.body;

    const user = await User.findById(req.user._id);

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Require password verification
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Verify 2FA code
    if (!verifyTOTP(user.twoFactorSecret, code)) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes();
    user.twoFactorBackupCodes = backupCodes;
    await user.save();

    res.json({
      message: 'Backup codes regenerated',
      backupCodes: backupCodes.map(c => c.code),
      warning: 'Your old backup codes are now invalid. Save these new codes in a secure location.'
    });
  } catch (error) {
    console.error('Regenerate backup codes error:', error);
    res.status(500).json({ error: 'Failed to regenerate backup codes' });
  }
};

module.exports = {
  getStatus,
  setupStart,
  setupComplete,
  disable,
  verify,
  regenerateBackupCodes
};
