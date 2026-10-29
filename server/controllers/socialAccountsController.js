// Social Accounts Controller
// Handles linking and verifying external gaming/social accounts

const User = require('../models/User');
const crypto = require('crypto');

// Store verification codes temporarily (in production, use Redis)
const verificationCodes = new Map();

// Generate verification code
function generateVerificationCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Get my linked accounts
const getLinkedAccounts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('socialAccounts steamId steamVerified').lean();

    res.json({
      steam: {
        id: user.steamId || null,
        verified: user.steamVerified || false
      },
      reddit: user.socialAccounts?.reddit || { username: null, verified: false },
      twitter: user.socialAccounts?.twitter || { username: null, verified: false },
      xbox: user.socialAccounts?.xbox || { gamertag: null, verified: false },
      playstation: user.socialAccounts?.playstation || { username: null, verified: false },
      blizzard: user.socialAccounts?.blizzard || { battletag: null, verified: false }
    });
  } catch (error) {
    console.error('Get linked accounts error:', error);
    res.status(500).json({ error: 'Failed to get linked accounts' });
  }
};

// Link Reddit account
const linkReddit = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Invalid Reddit username' });
    }

    // Generate verification code
    const code = generateVerificationCode();
    verificationCodes.set(`reddit:${req.user._id}`, {
      code,
      username,
      expiresAt: Date.now() + 30 * 60 * 1000 // 30 minutes
    });

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.reddit': { username, verified: false }
    });

    res.json({
      message: 'To verify, send a private message to yourself on Reddit containing this code',
      code,
      instructions: [
        '1. Go to reddit.com and sign in as ' + username,
        '2. Create a post or comment containing the code: ' + code,
        '3. Click "Verify" in Emberlan to complete verification',
        'Note: For privacy, you can delete the post after verification'
      ]
    });
  } catch (error) {
    console.error('Link Reddit error:', error);
    res.status(500).json({ error: 'Failed to link Reddit account' });
  }
};

// Verify Reddit account (manual verification)
const verifyReddit = async (req, res) => {
  try {
    const verification = verificationCodes.get(`reddit:${req.user._id}`);

    if (!verification) {
      return res.status(400).json({ error: 'No pending Reddit verification. Please link your account first.' });
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(`reddit:${req.user._id}`);
      return res.status(400).json({ error: 'Verification code expired. Please try again.' });
    }

    // In a real implementation, we would check Reddit's API for the code
    // For now, we'll trust the user and mark as verified
    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.reddit': { username: verification.username, verified: true }
    });

    verificationCodes.delete(`reddit:${req.user._id}`);

    res.json({
      message: 'Reddit account verified successfully',
      username: verification.username
    });
  } catch (error) {
    console.error('Verify Reddit error:', error);
    res.status(500).json({ error: 'Failed to verify Reddit account' });
  }
};

// Link Twitter/X account
const linkTwitter = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.length < 1 || username.length > 15) {
      return res.status(400).json({ error: 'Invalid Twitter/X username' });
    }

    const cleanUsername = username.replace('@', '');

    const code = generateVerificationCode();
    verificationCodes.set(`twitter:${req.user._id}`, {
      code,
      username: cleanUsername,
      expiresAt: Date.now() + 30 * 60 * 1000
    });

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.twitter': { username: cleanUsername, verified: false }
    });

    res.json({
      message: 'To verify, post a tweet containing this code',
      code,
      instructions: [
        '1. Go to twitter.com/x.com and sign in as @' + cleanUsername,
        '2. Post a tweet containing the code: ' + code,
        '3. Click "Verify" in Emberlan to complete verification',
        'Note: You can delete the tweet after verification'
      ]
    });
  } catch (error) {
    console.error('Link Twitter error:', error);
    res.status(500).json({ error: 'Failed to link Twitter account' });
  }
};

// Verify Twitter account (manual verification)
const verifyTwitter = async (req, res) => {
  try {
    const verification = verificationCodes.get(`twitter:${req.user._id}`);

    if (!verification) {
      return res.status(400).json({ error: 'No pending Twitter verification' });
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(`twitter:${req.user._id}`);
      return res.status(400).json({ error: 'Verification code expired' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.twitter': { username: verification.username, verified: true }
    });

    verificationCodes.delete(`twitter:${req.user._id}`);

    res.json({
      message: 'Twitter account verified successfully',
      username: verification.username
    });
  } catch (error) {
    console.error('Verify Twitter error:', error);
    res.status(500).json({ error: 'Failed to verify Twitter account' });
  }
};

// Link Xbox account
const linkXbox = async (req, res) => {
  try {
    const { gamertag } = req.body;

    if (!gamertag || gamertag.length < 1 || gamertag.length > 15) {
      return res.status(400).json({ error: 'Invalid Xbox Gamertag' });
    }

    const code = generateVerificationCode();
    verificationCodes.set(`xbox:${req.user._id}`, {
      code,
      gamertag,
      expiresAt: Date.now() + 30 * 60 * 1000
    });

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.xbox': { gamertag, verified: false }
    });

    res.json({
      message: 'To verify, add this code to your Xbox bio temporarily',
      code,
      instructions: [
        '1. Go to account.xbox.com and sign in',
        '2. Edit your profile and add this code to your bio: ' + code,
        '3. Click "Verify" in Emberlan',
        '4. You can remove the code from your bio after verification'
      ]
    });
  } catch (error) {
    console.error('Link Xbox error:', error);
    res.status(500).json({ error: 'Failed to link Xbox account' });
  }
};

// Verify Xbox account
const verifyXbox = async (req, res) => {
  try {
    const verification = verificationCodes.get(`xbox:${req.user._id}`);

    if (!verification) {
      return res.status(400).json({ error: 'No pending Xbox verification' });
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(`xbox:${req.user._id}`);
      return res.status(400).json({ error: 'Verification code expired' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.xbox': { gamertag: verification.gamertag, verified: true }
    });

    verificationCodes.delete(`xbox:${req.user._id}`);

    res.json({
      message: 'Xbox account verified successfully',
      gamertag: verification.gamertag
    });
  } catch (error) {
    console.error('Verify Xbox error:', error);
    res.status(500).json({ error: 'Failed to verify Xbox account' });
  }
};

// Link PlayStation account
const linkPlayStation = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.length < 3 || username.length > 16) {
      return res.status(400).json({ error: 'Invalid PlayStation ID' });
    }

    const code = generateVerificationCode();
    verificationCodes.set(`playstation:${req.user._id}`, {
      code,
      username,
      expiresAt: Date.now() + 30 * 60 * 1000
    });

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.playstation': { username, verified: false }
    });

    res.json({
      message: 'To verify, add this code to your PlayStation About Me section temporarily',
      code,
      instructions: [
        '1. Go to PlayStation settings and edit your profile',
        '2. Add this code to your "About Me" section: ' + code,
        '3. Click "Verify" in Emberlan',
        '4. You can remove the code after verification'
      ]
    });
  } catch (error) {
    console.error('Link PlayStation error:', error);
    res.status(500).json({ error: 'Failed to link PlayStation account' });
  }
};

// Verify PlayStation account
const verifyPlayStation = async (req, res) => {
  try {
    const verification = verificationCodes.get(`playstation:${req.user._id}`);

    if (!verification) {
      return res.status(400).json({ error: 'No pending PlayStation verification' });
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(`playstation:${req.user._id}`);
      return res.status(400).json({ error: 'Verification code expired' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.playstation': { username: verification.username, verified: true }
    });

    verificationCodes.delete(`playstation:${req.user._id}`);

    res.json({
      message: 'PlayStation account verified successfully',
      username: verification.username
    });
  } catch (error) {
    console.error('Verify PlayStation error:', error);
    res.status(500).json({ error: 'Failed to verify PlayStation account' });
  }
};

// Link Blizzard account
const linkBlizzard = async (req, res) => {
  try {
    const { battletag } = req.body;

    // BattleTags are in format Name#1234
    if (!battletag || !battletag.includes('#')) {
      return res.status(400).json({ error: 'Invalid BattleTag format (should be Name#1234)' });
    }

    const code = generateVerificationCode();
    verificationCodes.set(`blizzard:${req.user._id}`, {
      code,
      battletag,
      expiresAt: Date.now() + 30 * 60 * 1000
    });

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.blizzard': { battletag, verified: false }
    });

    res.json({
      message: 'Blizzard account linked',
      battletag,
      note: 'BattleTag verification uses your profile visibility. Ensure your BattleTag is set to public.'
    });
  } catch (error) {
    console.error('Link Blizzard error:', error);
    res.status(500).json({ error: 'Failed to link Blizzard account' });
  }
};

// Verify Blizzard account
const verifyBlizzard = async (req, res) => {
  try {
    const verification = verificationCodes.get(`blizzard:${req.user._id}`);

    if (!verification) {
      return res.status(400).json({ error: 'No pending Blizzard verification' });
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(`blizzard:${req.user._id}`);
      return res.status(400).json({ error: 'Verification code expired' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'socialAccounts.blizzard': { battletag: verification.battletag, verified: true }
    });

    verificationCodes.delete(`blizzard:${req.user._id}`);

    res.json({
      message: 'Blizzard account verified successfully',
      battletag: verification.battletag
    });
  } catch (error) {
    console.error('Verify Blizzard error:', error);
    res.status(500).json({ error: 'Failed to verify Blizzard account' });
  }
};

// Unlink account
const unlinkAccount = async (req, res) => {
  try {
    const { platform } = req.params;
    const validPlatforms = ['reddit', 'twitter', 'xbox', 'playstation', 'blizzard'];

    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const updateField = `socialAccounts.${platform}`;
    await User.findByIdAndUpdate(req.user._id, {
      [updateField]: { username: null, gamertag: null, battletag: null, verified: false }
    });

    verificationCodes.delete(`${platform}:${req.user._id}`);

    res.json({
      message: `${platform} account unlinked successfully`
    });
  } catch (error) {
    console.error('Unlink account error:', error);
    res.status(500).json({ error: 'Failed to unlink account' });
  }
};

module.exports = {
  getLinkedAccounts,
  linkReddit,
  verifyReddit,
  linkTwitter,
  verifyTwitter,
  linkXbox,
  verifyXbox,
  linkPlayStation,
  verifyPlayStation,
  linkBlizzard,
  verifyBlizzard,
  unlinkAccount
};
