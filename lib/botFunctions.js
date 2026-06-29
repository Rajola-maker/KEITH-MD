var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });

const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const util = require("util");
const zlib = require("zlib");
const sharp = require('sharp'); // UNCOMMENTED - required for stickerToImage
const { session } = require('../settings');
const FormData = require('form-data');
const { fromBuffer } = require('file-type');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');
const ytdl = require('@distube/ytdl-core'); // For YouTube downloads
const ytSearch = require('yt-search');      // For YouTube search
ffmpeg.setFfmpegPath(ffmpegPath);

const sessionDir = path.join(__dirname, "..", "session");
const sessionPath = path.join(sessionDir, "creds.json");

async function stickerToImage(webpData, options = {}) {
    try {
        const {
            upscale = true,
            targetSize = 512, 
            framesToProcess = 200
        } = options;

        if (Buffer.isBuffer(webpData)) {
            const sharpInstance = sharp(webpData, {
                sequentialRead: true,
                animated: true,
                limitInputPixels: false,
                pages: framesToProcess 
            });

            const metadata = await sharpInstance.metadata();
            const isAnimated = metadata.pages > 1 || metadata.hasAlpha;

            if (isAnimated) {
                return await sharpInstance
                    .gif({
                        compressionLevel: 0,
                        quality: 100,
                        effort: 1, 
                        loop: 0 
                    })
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3' 
                    })
                    .toBuffer();
            } else {
                return await sharpInstance
                    .ensureAlpha()
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .png({
                        compressionLevel: 0,
                        quality: 100,
                        progressive: false,
                        palette: true
                    })
                    .toBuffer();
            }
        }
        else if (typeof webpData === 'string') {
            const sharpInstance = sharp(webpData, {
                sequentialRead: true,
                animated: true,
                limitInputPixels: false,
                pages: framesToProcess
            });

            const metadata = await sharpInstance.metadata();
            const isAnimated = metadata.pages > 1 || metadata.hasAlpha;
            const outputPath = webpData.replace(/\.webp$/, isAnimated ? '.gif' : '.png');

            if (isAnimated) {
                await sharpInstance
                    .gif({
                        compressionLevel: 0,
                        quality: 100,
                        effort: 1,
                        loop: 0
                    })
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .toFile(outputPath);
            } else {
                await sharpInstance
                    .ensureAlpha()
                    .resize({
                        width: upscale ? targetSize : metadata.width,
                        height: upscale ? targetSize : metadata.height,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                        kernel: 'lanczos3'
                    })
                    .png({
                        compressionLevel: 0,
                        quality: 100,
                        progressive: false,
                        palette: true
                    })
                    .toFile(outputPath);
            }

            const imageBuffer = await fs.promises.readFile(outputPath);
            await fs.promises.unlink(outputPath);
            await fs.promises.unlink(webpData); 
            return imageBuffer;
        }
        else {
            throw new Error('Invalid input type for stickerToImage');
        }
    } catch (error) {
        console.error('Error in stickerToImage:', error);
        throw error;
    }
}

async function withTempFiles(inputBuffer, extension, processFn) {
  const tempInput = `temp_${Date.now()}.input`;
  const tempOutput = `temp_${Date.now()}.${extension}`;
  
  try {
    fs.writeFileSync(tempInput, inputBuffer);
    await processFn(tempInput, tempOutput);
    const outputBuffer = fs.readFileSync(tempOutput);
    return outputBuffer;
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
}

async function toAudio(buffer) {
  return withTempFiles(buffer, 'mp3', (input, output) => {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate(64)
        .audioChannels(1) 
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .save(output);
    });
  });
}

async function toVideo(buffer) {
  return withTempFiles(buffer, 'mp4', (input, output) => {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input('color=black:s=640x360:r=1') 
        .inputOptions(['-f lavfi'])
        .input(input)
        .outputOptions([
          '-shortest',
          '-preset ultrafast',
          '-movflags faststart',
          '-pix_fmt yuv420p'
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .toFormat('mp4')
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .on('end', resolve)
        .save(output);
    });
  });
}

async function toPtt(buffer) {
  return withTempFiles(buffer, 'ogg', (input, output) => {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .audioCodec('libopus')
        .audioBitrate(24) 
        .audioChannels(1)
        .audioFrequency(16000) 
        .toFormat('ogg')
        .on('error', reject)
        .on('end', resolve)
        .save(output);
    });
  });
}

async function formatAudio(buffer) {
  return new Promise((resolve, reject) => {
    const tempInput = `temp_${Date.now()}.input`;
    const tempOutput = `temp_${Date.now()}.mp3`;
    
    fs.writeFileSync(tempInput, buffer);
    
    ffmpeg()
      .input(tempInput)
      .noVideo() 
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .outputOptions([
        '-preset ultrafast', 
        '-compression_level 0', 
        '-joint_stereo 1', 
        '-reservoir 0', 
        '-fflags +genpts', 
      ])
      .toFormat('mp3')
      .on('error', (err) => {
        fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        reject(err);
      })
      .on('end', () => {
        const outputBuffer = fs.readFileSync(tempOutput);
        fs.unlinkSync(tempInput);
        fs.unlinkSync(tempOutput);
        resolve(outputBuffer);
      })
      .save(tempOutput);
  });
}

async function formatVideo(buffer) {
  return new Promise((resolve, reject) => {
    const tempInput = `temp_${Date.now()}.input`;
    const tempOutput = `temp_${Date.now()}.mp4`;
    fs.writeFileSync(tempInput, buffer);
    
    ffmpeg()
      .input(tempInput)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset fast',
        '-movflags faststart',
        '-pix_fmt yuv420p'
      ])
      .size('640x?')
      .toFormat('mp4')
      .on('error', (err) => {
        fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        reject(err);
      })
      .on('end', () => {
        const outputBuffer = fs.readFileSync(tempOutput);
        fs.unlinkSync(tempInput);
        fs.unlinkSync(tempOutput);
        resolve(outputBuffer);
      })
      .save(tempOutput);
  });
}

function monospace(input) {
    const boldz = {
         'A': '𝙰', 'B': '𝙱', 'C': '𝙲', 'D': '𝙳', 'E': '𝙴', 'F': '𝙵', 'G': '𝙶',
        'H': '𝙷', 'I': '𝙸', 'J': '𝙹', 'K': '𝙺', 'L': '𝙻', 'M': '𝙼', 'N': '𝙽',
        'O': '𝙾', 'P': '𝙿', 'Q': '𝚀', 'R': '𝚁', 'S': '𝚂', 'T': '𝚃', 'U': '𝚄',
        'V': '𝚅', 'W': '𝚆', 'X': '𝚇', 'Y': '𝚈', 'Z': '𝚉',
        '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔',
        '7': '𝟕', '8': '𝟖', '9': '𝟗',
        ' ': ' ' 
    };
    return input.split('').map(char => boldz[char] || char).join('');
}

const byteToKB = 1 / 1024;
const byteToMB = byteToKB / 1024;
const byteToGB = byteToMB / 1024;

function formatBytes(bytes) {
  if (bytes >= Math.pow(1024, 3)) {
    return (bytes * byteToGB).toFixed(2) + ' GB';
  } else if (bytes >= Math.pow(1024, 2)) {
    return (bytes * byteToMB).toFixed(2) + ' MB';
  } else if (bytes >= 1024) {
    return (bytes * byteToKB).toFixed(2) + ' KB';
  } else {
    return bytes.toFixed(2) + ' bytes';
  }
}

async function loadSession() {
    try {
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
        }

        if (!session || typeof session !== 'string') {
            throw new Error("❌ SESSION is missing or invalid");
        }

        const [header, b64data] = session.split(';;;');

        if (header !== "KEITH" || !b64data) {
            throw new Error("❌ Invalid session format. Expected 'KEITH;;;.....'");
        }

        const cleanB64 = b64data.replace('...', '');
        const compressedData = Buffer.from(cleanB64, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);

        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        fs.writeFileSync(sessionPath, decompressedData, "utf8");
        console.log("✅ Session File Loaded");

    } catch (e) {
        console.error("❌ Session Error:", e.message);
        throw e;
    }
}

const runtime = (seconds) => {
	seconds = Number(seconds)
	var d = Math.floor(seconds / (3600 * 24))
	var h = Math.floor(seconds % (3600 * 24) / 3600)
	var m = Math.floor(seconds % 3600 / 60)
	var s = Math.floor(seconds % 60)
	var dDisplay = d > 0 ? d + (d == 1 ? ' day, ' : ' days, ') : ''
	var hDisplay = h > 0 ? h + (h == 1 ? ' hour, ' : ' hours, ') : ''
	var mDisplay = m > 0 ? m + (m == 1 ? ' minute, ' : ' minutes, ') : ''
	var sDisplay = s > 0 ? s + (s == 1 ? ' second' : ' seconds') : ''
	return dDisplay + hDisplay + mDisplay + sDisplay;
}

const sleep = async(ms) => {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function keithRandom(ext) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${timestamp}_${random}${ext}`;
}

async function keithFancy(text) {
    return new Promise((resolve, reject) => {
        axios.get('http://qaz.wtf/u/convert.cgi?text='+text)
        .then(({ data }) => {
            let $ = cheerio.load(data)
            let hasil = []
            $('table > tbody > tr').each(function (a, b) {
                hasil.push({ name: $(b).find('td:nth-child(1) > h6 > a').text(), result: $(b).find('td:nth-child(2)').text().trim() })
            }),
            resolve(hasil)
        })
    })
}

const keithBuffer = async (url, options = {}) => {
    try {
        const res = await axios({
            method: "GET",
            url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.70 Safari/537.36",
                'DNT': 1,
                'Upgrade-Insecure-Request': 1
            },
            ...options,
            responseType: 'arraybuffer',
            timeout: 960000 
        });
        
        if (!res.data || res.data.length === 0) {
            throw new Error("Empty response data");
        }
        
        return res.data;
    } catch (err) {
        console.error("keithBuffer Error:", err);
        return err;
    }
};

const keithJson = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
                'Accept': 'application/json'
            },
            ...options,
            timeout: 2400000
        });
        
        if (!res.data) {
            throw new Error("Empty response data");
        }
        
        return res.data;
    } catch (err) {
        console.error("keithJson Error:", err);
        return err;
    }
};

const latestWaVersion = async () => {
    const get = await keithJson("https://web.whatsapp.com/check-update?version=1&platform=web");
    const version = [get.currentVersion.replace(/[.]/g, ", ")];
    return version;
};

const isUrl = (url) => {
    return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/, 'gi'));
};

const isNumber = (number) => {
    const int = parseInt(number);
    return typeof int === 'number' && !isNaN(int);
};

function verifyJidState(jid) {
    if (!jid.endsWith('@s.whatsapp.net')) {
        console.error('Your verified', jid);
        return false;
    }
    console.log('Welcome to Keith Md', jid);
    return true;
}

async function eBase(str = '') {
  return Buffer.from(str).toString('base64');
}

async function dBase(base64Str) {
  return Buffer.from(base64Str, 'base64').toString('utf-8');
}

async function eBinary(str = '') {
  return str.split('').map(char => char.charCodeAt(0).toString(2)).join(' ');
}

async function dBinary(str) {
  let newBin = str.split(" ");
  let binCode = [];
  for (let i = 0; i < newBin.length; i++) {
    binCode.push(String.fromCharCode(parseInt(newBin[i], 2)));
  }
  return binCode.join("");
}

// ===== 🎵 MUSIC DOWNLOAD FUNCTIONS =====

/**
 * Search for music on YouTube
 * @param {string} query - Song name to search
 * @returns {Array} Search results
 */
async function searchMusic(query) {
  try {
    const result = await ytSearch(query);
    return result.videos.slice(0, 10).map(v => ({
      title: v.title,
      url: v.url,
      duration: v.duration.seconds,
      durationString: v.duration.toString(),
      thumbnail: v.thumbnail,
      author: v.author.name,
      views: v.views
    }));
  } catch (err) {
    console.error('searchMusic Error:', err.message);
    throw err;
  }
}

/**
 * Download audio from YouTube URL as MP3 buffer
 * @param {string} url - YouTube video URL
 * @param {string} quality - Audio quality (lowest, low, medium, high, highest)
 * @returns {Buffer} MP3 audio buffer
 */
async function downloadMusic(url, quality = 'high') {
  try {
    const info = await ytdl.getInfo(url);
    
    // Quality mapping for ytdl options
    const qualityMap = {
      'lowest': { filter: 'audioonly', quality: 'lowestaudio' },
      'low': { filter: 'audioonly', quality: 'lowestaudio' },
      'medium': { filter: 'audioonly', quality: 'lowestaudio' },
      'high': { filter: 'audioonly', quality: 'highestaudio' },
      'highest': { filter: 'audioonly', quality: 'highestaudio' }
    };

    const options = qualityMap[quality] || qualityMap['high'];
    
    const stream = ytdl(url, options);
    const chunks = [];
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    let audioBuffer = Buffer.concat(chunks);
    
    // Convert to MP3 using ffmpeg for better quality
    audioBuffer = await formatAudio(audioBuffer);
    
    return {
      buffer: audioBuffer,
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[0]?.url,
      duration: info.videoDetails.lengthSeconds,
      author: info.videoDetails.author.name
    };
  } catch (err) {
    console.error('downloadMusic Error:', err.message);
    throw err;
  }
}

/**
 * Download audio from YouTube URL as raw audio buffer (faster, no conversion)
 * @param {string} url - YouTube video URL
 * @returns {Buffer} Audio buffer
 */
async function downloadMusicFast(url) {
  try {
    const info = await ytdl.getInfo(url);
    const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
    const chunks = [];
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    return {
      buffer: Buffer.concat(chunks),
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[0]?.url,
      duration: info.videoDetails.lengthSeconds,
      author: info.videoDetails.author.name
    };
  } catch (err) {
    console.error('downloadMusicFast Error:', err.message);
    throw err;
  }
}

/**
 * Search and download music in one step
 * @param {string} query - Song name to search and download
 * @param {string} quality - Audio quality
 * @returns {Object} Downloaded music info and buffer
 */
async function playMusic(query, quality = 'high') {
  try {
    const results = await searchMusic(query);
    if (!results || results.length === 0) {
      throw new Error('No results found for: ' + query);
    }
    
    // Download the first result
    const music = await downloadMusic(results[0].url, quality);
    return {
      ...music,
      searchResults: results
    };
  } catch (err) {
    console.error('playMusic Error:', err.message);
    throw err;
  }
}

/**
 * Get video info from YouTube URL
 * @param {string} url - YouTube URL
 * @returns {Object} Video information
 */
async function getYtInfo(url) {
  try {
    const info = await ytdl.getInfo(url);
    return {
      title: info.videoDetails.title,
      description: info.videoDetails.description,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails[0]?.url,
      author: info.videoDetails.author.name,
      views: info.videoDetails.viewCount,
      likes: info.videoDetails.likes,
      uploadDate: info.videoDetails.uploadDate
    };
  } catch (err) {
    console.error('getYtInfo Error:', err.message);
    throw err;
  }
}

// ===== END MUSIC FUNCTIONS =====

class keithStore {
    constructor() {
        this.messages = new Map();
        this.contacts = new Map();
        this.chats = new Map();
        this.maxMessages = 10000;
        this.maxChats = 5000;
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000);
    }

    loadMessage(jid, id) {
        const chatMessages = this.messages.get(jid);
        return chatMessages?.get(id) || null;
    }

    saveMessage(jid, message) {
        if (!this.messages.has(jid)) {
            this.messages.set(jid, new Map());
        }
        
        const chatMessages = this.messages.get(jid);
        chatMessages.set(message.key.id, message);
        
        if (chatMessages.size > this.maxMessages) {
            const firstKey = chatMessages.keys().next().value;
            chatMessages.delete(firstKey);
        }
    }

    cleanup() {
        try {
            if (this.messages.size > this.maxChats) {
                const chatsToDelete = this.messages.size - this.maxChats;
                const oldestChats = Array.from(this.messages.keys()).slice(0, chatsToDelete);
                oldestChats.forEach(jid => this.messages.delete(jid));
            }
        } catch (error) {
            console.error('Store cleanup error:', error);
        }
    }

    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key?.remoteJid && msg.key?.id) {
                    this.saveMessage(msg.key.remoteJid, msg);
                }
            });
        });

        ev.on('chats.set', ({ chats }) => {
            chats.forEach(chat => {
                this.chats.set(chat.id, chat);
            });
        });

        ev.on('contacts.set', ({ contacts }) => {
            contacts.forEach(contact => {
                this.contacts.set(contact.id, contact);
            });
        });
    }

    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.messages.clear();
        this.contacts.clear();
        this.chats.clear();
    }
}

// ===== EMOJI CYCLING ANIMATION =====

/**
 * Send an emoji that cycles through different variants by editing the message
 * @param {Object} sock - WhatsApp socket
 * @param {string} jid - Chat JID
 * @param {Array} emojis - Array of emojis to cycle through
 * @param {number} interval - Milliseconds between each edit (default: 800)
 * @param {Object} quoted - Optional message to quote
 * @returns {Promise<Object>} The final sent message key
 */
async function sendEmojiCycle(sock, jid, emojis, interval = 800, quoted = null) {
  try {
    // Send the first emoji
    const sentMsg = await sock.sendMessage(jid, { text: emojis[0] }, { quoted });
    const key = sentMsg.key;

    // Cycle through remaining emojis by editing
    for (let i = 1; i < emojis.length; i++) {
      await sleep(interval);
      await sock.sendMessage(jid, { 
        text: emojis[i], 
        edit: key 
      });
    }

    return key;
  } catch (err) {
    console.error('sendEmojiCycle Error:', err.message);
    throw err;
  }
}

/**
 * Send love emoji animation cycling through all❤️ variants
 * @param {Object} sock - WhatsApp socket
 * @param {string} jid - Chat JID
 * @param {Object} quoted - Optional message to quote
 * @returns {Promise<Object>}
 */
async function sendLoveEmojis(sock, jid, quoted = null) {
  const loveEmojis = [
    '❤️',  // Red heart
    '🧡',  // Orange heart
    '💛',  // Yellow heart
    '💚',  // Green heart
    '💙',  // Blue heart
    '💜',  // Purple heart
    '🖤',  // Black heart
    '🤍',  // White heart
    '🤎',  // Brown heart
    '💗',  // Growing pink heart
    '💖',  // Sparkling heart
    '💝',  // Heart with ribbon
    '💕',  // Two hearts
    '💓',  // Beating heart
    '💞',  // Revolving hearts
    '❤️‍🔥', // Heart on fire
    '❤️‍🩹', // Mending heart
    '💘',  // Heart with arrow
    '💟',  // Heart decoration
    '♥️',  // Heart suit
    '🫶',  // Heart hands
    '🥰',  // Smiling face with hearts
    '😍',  // Heart eyes
    '🤗'   // Hugging face
  ];

  return sendEmojiCycle(sock, jid, loveEmojis, 700, quoted);
}

/**
 * Send a custom cycling emoji animation
 * @param {Object} sock - WhatsApp socket
 * @param {string} jid - Chat JID
 * @param {string} category - Emoji category name
 * @param {Object} quoted - Optional message to quote
 * @returns {Promise<Object>}
 */
async function sendEmojiCategory(sock, jid, category, quoted = null) {
  const categories = {
    love: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎',
      '💗', '💖', '💝', '💕', '💓', '💞', '💘', '💟', '♥️',
      '🫶', '🥰', '😍'
    ],
    smile: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊',
      '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙',
      '😚', '😋', '😛', '😜', '🤪', '😝', '🤑'
    ],
    sad: [
      '😢', '😭', '😿', '🥺', '😔', '😞', '😟', '😕', '🙁',
      '☹️', '😣', '😖', '😫', '😩', '🥱', '😤', '😠', '😡',
      '🤬', '👿'
    ],
    angry: [
      '😠', '😡', '🤬', '👿', '💢', '🗯️', '💥', '🔥', '😤',
      '😣', '😖', '😫'
    ],
    party: [
      '🎉', '🎊', '🎈', '🎁', '🥳', '🎂', '🍾', '🥂', '🍻',
      '🎶', '🎵', '💃', '🕺', '✨', '🌟', '⭐', '🎆', '🎇',
      '🧨', '🎊'
    ],
    food: [
      '🍕', '🍔', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥗',
      '🍟', '🍗', '🥩', '🍖', '🥓', '🍳', '🧇', '🥞', '🧀',
      '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤'
    ],
    laugh: [
      '😂', '🤣', '😹', '😆', '😁', '😄', '😃', '🤭', '😜',
      '😛', '🤪', '😝', '🫠', '😅'
    ],
    cry: [
      '😭', '😢', '🥺', '😿', '😔', '😞', '😟', '😕', '🙁',
      '☹️', '😣', '😖', '😫', '😩', '🥱', '😤'
    ],
    fire: [
      '🔥', '💥', '✨', '⭐', '🌟', '💫', '🎇', '🎆', '🧨',
      '💢', '⚡', '💥', '🔥'
    ],
    wave: [
      '👋', '🙋', '🖐️', '✋', '🤚', '👋🏻', '👋🏼', '👋🏽',
      '👋🏾', '👋🏿', '🤙', '👐', '🙌', '👏', '🤝'
    ]
  };

  const emojis = categories[category.toLowerCase()];
  if (!emojis) {
    throw new Error(`Category "${category}" not found. Available: ${Object.keys(categories).join(', ')}`);
  }

  return sendEmojiCycle(sock, jid, emojis, 700, quoted);
}

module.exports = { 
    dBinary, eBinary, dBase, eBase, runtime, sleep, keithFancy, 
    stickerToImage, toAudio, toVideo, toPtt, formatVideo, formatAudio, 
    monospace, formatBytes, sleep, keithBuffer, keithJson, 
    latestWaVersion, keithRandom, isUrl, keithStore, isNumber, 
    loadSession, verifyJidState,
    // NEW EXPORTS - Music functions
    searchMusic, downloadMusic, downloadMusicFast, playMusic, getYtInfo
};
