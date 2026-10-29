// YouTube Bot Service for Emberlan
// Allows admins to play YouTube audio in voice channels

const ytdl = require('@distube/ytdl-core');

class YouTubeBotService {
  constructor(io) {
    this.io = io;
    this.activeStreams = {}; // channelId -> { url, title, playing, startTime }
    this.enabled = false;
  }

  // Enable/disable the bot
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      // Stop all active streams
      this.stopAll();
    }
    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  // Get video info from URL
  async getVideoInfo(url) {
    try {
      const info = await ytdl.getInfo(url);
      return {
        title: info.videoDetails.title,
        author: info.videoDetails.author.name,
        duration: parseInt(info.videoDetails.lengthSeconds),
        thumbnail: info.videoDetails.thumbnails[0]?.url,
        url: url
      };
    } catch (error) {
      console.error('Failed to get video info:', error.message);
      throw new Error('Could not get video info. Make sure the URL is valid.');
    }
  }

  // Play a YouTube video in a channel
  async play(channelId, url, requestedBy) {
    if (!this.enabled) {
      throw new Error('YouTube bot is not enabled');
    }

    try {
      const info = await this.getVideoInfo(url);

      // Stop any existing stream in this channel
      if (this.activeStreams[channelId]) {
        this.stop(channelId);
      }

      this.activeStreams[channelId] = {
        url,
        title: info.title,
        author: info.author,
        duration: info.duration,
        thumbnail: info.thumbnail,
        playing: true,
        startTime: Date.now(),
        requestedBy
      };

      // Notify all users in the channel
      this.io.to(`voice:${channelId}`).emit('youtube:playing', {
        channelId,
        ...this.activeStreams[channelId]
      });

      return this.activeStreams[channelId];
    } catch (error) {
      throw error;
    }
  }

  // Stop playback in a channel
  stop(channelId) {
    if (this.activeStreams[channelId]) {
      delete this.activeStreams[channelId];

      this.io.to(`voice:${channelId}`).emit('youtube:stopped', { channelId });
      return true;
    }
    return false;
  }

  // Stop all playback
  stopAll() {
    for (const channelId in this.activeStreams) {
      this.stop(channelId);
    }
  }

  // Get stream URL for a video (audio only)
  async getStreamUrl(url) {
    try {
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, {
        quality: 'highestaudio',
        filter: 'audioonly'
      });

      if (!format) {
        throw new Error('No audio format available');
      }

      return format.url;
    } catch (error) {
      console.error('Failed to get stream URL:', error.message);
      throw new Error('Could not get audio stream');
    }
  }

  // Get current playback status for a channel
  getStatus(channelId) {
    return this.activeStreams[channelId] || null;
  }

  // Get all active streams
  getAllStreams() {
    return this.activeStreams;
  }

  // Pause playback (just marks as paused, client handles actual pause)
  pause(channelId) {
    if (this.activeStreams[channelId]) {
      this.activeStreams[channelId].playing = false;
      this.io.to(`voice:${channelId}`).emit('youtube:paused', { channelId });
      return true;
    }
    return false;
  }

  // Resume playback
  resume(channelId) {
    if (this.activeStreams[channelId]) {
      this.activeStreams[channelId].playing = true;
      this.io.to(`voice:${channelId}`).emit('youtube:resumed', { channelId });
      return true;
    }
    return false;
  }
}

module.exports = { YouTubeBotService };
