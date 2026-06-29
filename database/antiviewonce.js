const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Configuration - stored in bot's database (adapt to your DB structure)
let config = {
  enabled: true,          // Global toggle
  saveToGallery: false,   // Save to local storage as well
  forwardCaption: true,   // Include original caption
  notifyUser: false,      // Notify when view-once is captured
  mediaDir: './media/viewonce'  // Local save directory
};

// Ensure media directory exists
if (config.saveToGallery && !fs.existsSync(config.mediaDir)) {
  fs.mkdirSync(config.mediaDir, { recursive: true });
}

/**
 * Handle incoming messages and intercept view-once media
 */
async function handleAntiViewOnce(sock, message, senderInfo) {
  // Skip if disabled globally
  if (!config.enabled) return;

  const { key, message: msg } = message;
  const from = key.remoteJid;
  const sender = key.participant || key.remoteJid;
  const isGroup = from.endsWith('@g.us');

  // Check group-specific settings if applicable
  if (isGroup) {
    const groupConfig = await getGroupConfig(from);
    if (!groupConfig.antiviewonce) return;
  }

  // Handle ViewOnceMessageV2
  if (message.mtype === 'viewOnceMessageV2' || message.mtype === 'viewOnceMessage') {
    try {
      console.log(`[AntiViewOnce] Captured view-once from ${sender}`);
      
      // Extract the actual message from the view-once wrapper
      const viewOnceKey = message.mtype === 'viewOnceMessageV2' 
        ? 'viewOnceMessageV2' 
        : 'viewOnceMessage';
      
      const actualMessage = msg[viewOnceKey].message;
      const mediaType = getContentType(actualMessage);
      
      if (!mediaType) {
        console.log('[AntiViewOnce] No media type found in view-once message');
        return;
      }

      const mediaContent = actualMessage[mediaType];
      
      // Download the media content
      const stream = await downloadContentFromMessage(mediaContent, mediaType.replace('Message', ''));
      let buffer = Buffer.from([]);
      
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      // Determine file extension and MIME type
      const { ext, mime } = getMediaInfo(mediaType);
      
      // Generate filename with timestamp
      const timestamp = Date.now();
      const fileName = `viewonce_${timestamp}.${ext}`;
      
      // Save to local storage if enabled
      if (config.saveToGallery) {
        const filePath = path.join(config.mediaDir, fileName);
        fs.writeFileSync(filePath, buffer);
        console.log(`[AntiViewOnce] Saved to ${filePath}`);
      }

      // Build caption
      let caption = '';
      if (config.forwardCaption && mediaContent.caption) {
        caption = mediaContent.caption;
      }
      
      // Add footer note (optional)
      if (config.notifyUser) {
        caption = caption 
          ? `${caption}\n\n_📸 Anti-ViewOnce Captured_`
          : '_📸 Anti-ViewOnce Captured_';
      }

      // Re-send the media as a regular message (breaking view-once)
      const mediaMessage = {
        [mediaType.replace('Message', '')]: buffer,
        caption: caption,
        mimetype: mime,
        // Remove the viewOnce flag
        viewOnce: false
      };

      // Send based on media type
      if (mediaType === 'imageMessage') {
        await sock.sendMessage(from, { 
          image: buffer, 
          caption: caption,
          mimetype: mime 
        }, { quoted: key });
      } else if (mediaType === 'videoMessage') {
        await sock.sendMessage(from, { 
          video: buffer, 
          caption: caption,
          mimetype: mime 
        }, { quoted: key });
      } else if (mediaType === 'audioMessage') {
        await sock.sendMessage(from, { 
          audio: buffer, 
          mimetype: mime,
          ptt: mediaContent.ptt || false 
        }, { quoted: key });
      } else if (mediaType === 'documentMessage') {
        await sock.sendMessage(from, { 
          document: buffer,
          mimetype: mime,
          fileName: mediaContent.fileName || fileName
        }, { quoted: key });
      } else if (mediaType === 'stickerMessage') {
        await sock.sendMessage(from, { 
          sticker: buffer,
          mimetype: mime
        }, { quoted: key });
      }

      console.log(`[AntiViewOnce] Successfully re-forwarded ${mediaType} from ${sender}`);

    } catch (error) {
      console.error('[AntiViewOnce] Error processing view-once message:', error.message);
    }
  }
}

/**
 * Get file extension and MIME type for a given media type
 */
function getMediaInfo(mediaType) {
  const mediaMap = {
    'imageMessage':       { ext: 'jpg',    mime: 'image/jpeg' },
    'videoMessage':       { ext: 'mp4',    mime: 'video/mp4' },
    'audioMessage':       { ext: 'mp3',    mime: 'audio/mp3' },
    'documentMessage':    { ext: 'bin',    mime: 'application/octet-stream' },
    'stickerMessage':     { ext: 'webp',   mime: 'image/webp' },
    'ptvMessage':         { ext: 'mp4',    mime: 'video/mp4' },
    'ppicMessage':        { ext: 'jpg',    mime: 'image/jpeg' },
    'productMessage':     { ext: 'jpg',    mime: 'image/jpeg' },
  };
  
  return mediaMap[mediaType] || { ext: 'bin', mime: 'application/octet-stream' };
}

/**
 * Mock: retrieve group config from your DB
 * Replace this with actual DB call matching your bot's storage
 */
async function getGroupConfig(groupJid) {
  // Example using a global DB object (common in Keith MD bots)
  // return global.db.data.groups[groupJid] || { antiviewonce: true };
  
  // For now, default to enabled
  return { antiviewonce: true };
}

/**
 * Toggle the anti-view-once feature
 */
async function setAntiViewOnce(state) {
  if (typeof state === 'boolean') {
    config.enabled = state;
    return { success: true, enabled: state };
  }
  return { success: false, message: 'State must be boolean' };
}

module.exports = {
  handleAntiViewOnce,
  setAntiViewOnce,
  config
};
