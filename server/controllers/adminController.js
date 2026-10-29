const User = require('../models/User');
const Invite = require('../models/Invite');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const nodemailer = require('nodemailer');

// Email transporter setup
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// Get all users (admin)
const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
};

// Update user role (admin)
const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Admins and superadmins can assign admin role
    if (role === 'admin' && !['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only admins can assign admin role' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: user.toPublicProfile() });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
};

// Grant/revoke admin panel access (admin)
const setAdminPanelAccess = async (req, res) => {
  try {
    const { userId } = req.params;
    const { access } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { adminPanelAccess: !!access },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: access ? 'Admin panel access granted' : 'Admin panel access revoked',
      user: user.toPublicProfile()
    });
  } catch (error) {
    console.error('Set admin access error:', error);
    res.status(500).json({ error: 'Failed to update admin panel access' });
  }
};

// Ban/unban user (admin)
const toggleUserBan = async (req, res) => {
  try {
    const { userId } = req.params;
    const { banned, reason } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        banned,
        banReason: reason || '',
        bannedAt: banned ? new Date() : null,
        bannedBy: banned ? req.user._id : null
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: banned ? 'User banned' : 'User unbanned',
      user: user.toPublicProfile()
    });
  } catch (error) {
    console.error('Ban toggle error:', error);
    res.status(500).json({ error: 'Failed to update ban status' });
  }
};

// Create user directly (admin)
const createUser = async (req, res) => {
  try {
    const { username, email, password, role, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    // Check if username or email exists
    const existingUser = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: email.toLowerCase() }
      ]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Validate role
    const allowedRoles = ['user', 'moderator', 'admin'];
    const userRole = allowedRoles.includes(role) ? role : 'user';

    // Only superadmin can create admins
    if (userRole === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only superadmin can create admin users' });
    }

    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      displayName: displayName || username,
      role: userRole
    });

    await user.save();

    res.status(201).json({
      message: 'User created successfully',
      user: user.toPublicProfile()
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Create invite (admin)
const createInvite = async (req, res) => {
  try {
    const { email, maxUses, expiresInDays } = req.body;

    // Email is optional - if not provided, generate a generic invite
    if (email) {
      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }
    }

    const invite = new Invite({
      email: email ? email.toLowerCase() : null,
      createdBy: req.user._id,
      maxUses: maxUses || 1,
      expiresAt: new Date(Date.now() + (expiresInDays || 7) * 24 * 60 * 60 * 1000)
    });

    await invite.save();

    // Send email if SMTP is configured
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = createTransporter();
        const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/register?invite=${invite.code}`;

        await transporter.sendMail({
          from: `"Emberlan" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'You\'ve been invited to Emberlan!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a24; color: #fff; padding: 40px; border-radius: 10px;">
              <h1 style="color: #ff8c00; text-align: center;">🎮 Emberlan</h1>
              <p style="font-size: 18px; text-align: center;">You've been invited to join our gaming community!</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${inviteUrl}" style="background: #ff8c00; color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                  Join Emberlan
                </a>
              </div>
              <p style="text-align: center; color: #888;">Or use invite code: <strong style="color: #ff8c00;">${invite.code}</strong></p>
              <p style="text-align: center; color: #666; font-size: 12px;">This invite expires in ${expiresInDays || 7} days.</p>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError);
      }
    }

    res.status(201).json({
      invite: {
        code: invite.code,
        email: invite.email,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses
      }
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
};

// Get all invites (admin)
const getInvites = async (req, res) => {
  try {
    const invites = await Invite.find()
      .populate('createdBy', 'username displayName')
      .populate('usedBy', 'username displayName')
      .sort({ createdAt: -1 });

    res.json({ invites });
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ error: 'Failed to get invites' });
  }
};

// Delete invite (admin)
const deleteInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;

    await Invite.findByIdAndDelete(inviteId);

    res.json({ message: 'Invite deleted' });
  } catch (error) {
    console.error('Delete invite error:', error);
    res.status(500).json({ error: 'Failed to delete invite' });
  }
};

// Get server stats (admin)
const getStats = async (req, res) => {
  try {
    const [
      totalUsers,
      onlineUsers,
      totalChannels,
      totalMessages,
      recentUsers
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: { $ne: 'offline' } }),
      Channel.countDocuments(),
      Message.countDocuments(),
      User.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username displayName createdAt')
    ]);

    res.json({
      stats: {
        totalUsers,
        onlineUsers,
        totalChannels,
        totalMessages,
        recentUsers
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};

module.exports = {
  getAllUsers,
  createUser,
  updateUserRole,
  setAdminPanelAccess,
  toggleUserBan,
  createInvite,
  getInvites,
  deleteInvite,
  getStats
};
