const mongoose = require('mongoose');

const serverSettingsSchema = new mongoose.Schema({
  // Only one document should exist, this key ensures uniqueness
  key: {
    type: String,
    default: 'main',
    unique: true
  },

  // Server name and branding
  serverName: {
    type: String,
    default: 'Emberlan'
  },
  serverDescription: {
    type: String,
    default: ''
  },
  // Server icon (path to uploaded image)
  serverIcon: {
    type: String,
    default: null
  },

  // Default theme for new users
  defaultTheme: {
    type: String,
    default: 'dark'
  },

  // Video streaming settings
  videoSettings: {
    // Default audio language (ISO 639-1 code)
    defaultAudioLanguage: {
      type: String,
      default: 'en'
    },
    // Default subtitle language (ISO 639-1 code, empty = disabled)
    defaultSubtitleLanguage: {
      type: String,
      default: ''
    },
    // Enable subtitles by default
    subtitlesEnabled: {
      type: Boolean,
      default: false
    },
    // Preferred video quality
    defaultQuality: {
      type: String,
      enum: ['auto', '720p', '1080p', '4k'],
      default: 'auto'
    }
  },

  // Bot feature toggles (which bots are enabled)
  bots: {
    youtube: { enabled: { type: Boolean, default: false } },
    plex: { enabled: { type: Boolean, default: false } },
    emby: { enabled: { type: Boolean, default: false } },
    jellyfin: { enabled: { type: Boolean, default: false } },
    iptv: { enabled: { type: Boolean, default: false } },
    spotify: { enabled: { type: Boolean, default: false } },
    chrome: { enabled: { type: Boolean, default: false } },
    activityStats: { enabled: { type: Boolean, default: false } },
    rpg: { enabled: { type: Boolean, default: false } },
    twitch: { enabled: { type: Boolean, default: false } },
    imageSearch: { enabled: { type: Boolean, default: false } },
    starCitizen: { enabled: { type: Boolean, default: false } }
  },

  // Registration settings
  registration: {
    enabled: {
      type: Boolean,
      default: true
    },
    requireInvite: {
      type: Boolean,
      default: false
    },
    requireEmailVerification: {
      type: Boolean,
      default: false
    }
  },

  // File sharing settings
  fileSharing: {
    enabled: {
      type: Boolean,
      default: false
    },
    maxFolderSize: {
      type: Number,
      default: 0 // 0 = unlimited
    }
  },

  // Activity tracking settings
  activityTracking: {
    enabled: {
      type: Boolean,
      default: true
    },
    retentionDays: {
      type: Number,
      default: 90
    }
  }
}, {
  timestamps: true
});

// Static method to get or create settings
serverSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne({ key: 'main' });
  if (!settings) {
    settings = new this({ key: 'main' });
    await settings.save();
  }
  return settings;
};

// Static method to update settings
serverSettingsSchema.statics.updateSettings = async function(updates) {
  const settings = await this.getSettings();

  // Merge updates with existing settings
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Merge nested objects
      settings[key] = { ...settings[key]?.toObject?.() || settings[key], ...value };
    } else {
      settings[key] = value;
    }
  }

  await settings.save();
  return settings;
};

module.exports = mongoose.model('ServerSettings', serverSettingsSchema);
