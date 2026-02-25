const { Telegraf, Markup } = require('telegraf');
const { downloadVideo, downloadPlaylist, getVideoInfo } = require('./downloader');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
require('dotenv').config();

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, 'temp');

// Validate bot token
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is missing! Please set it in .env file');
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);
fs.ensureDirSync(TEMP_DIR);

// Store user sessions
const userSessions = new Map();

// Clean temp directory on startup
fs.emptyDirSync(TEMP_DIR);
console.log('✅ Temp directory cleaned');

// Simple HTTP server for Heroku
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('YouTube Bot is running!\n');
});

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

// Format duration (seconds to MM:SS or HH:MM:SS)
function formatDuration(seconds) {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Format views
function formatViews(views) {
    if (!views) return 'N/A';
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M`;
    } else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K`;
    }
    return views.toString();
}

// Start command
bot.start((ctx) => {
    ctx.reply(
        '🎥 *YouTube Downloader Bot*\n\n' +
        'Send me a YouTube video or playlist link!\n\n' +
        'Commands:\n' +
        '/start - Start the bot\n' +
        '/help - Show help',
        { parse_mode: 'Markdown' }
    );
});

// Help command
bot.help((ctx) => {
    ctx.reply(
        '📖 *How to use:*\n\n' +
        '1️⃣ Send any YouTube video link\n' +
        '2️⃣ Video thumbnail and details will appear\n' +
        '3️⃣ Choose Video or Audio\n' +
        '4️⃣ File will be downloaded and sent\n\n' +
        '📋 *Playlist support:*\n' +
        'Send a playlist link and choose format for all videos',
        { parse_mode: 'Markdown' }
    );
});

// Handle YouTube links
bot.on('text', async (ctx) => {
    const url = ctx.message.text;
    const userId = ctx.from.id;

    try {
        if (url.includes('youtube.com/watch') || url.includes('youtu.be/') || url.includes('youtube.com/shorts/')) {
            // Send typing indicator
            await ctx.sendChatAction('typing');
            
            // Check if it's a playlist
            if (url.includes('list=')) {
                userSessions.set(userId, { type: 'playlist', url: url });
                
                await ctx.reply(
                    '📋 *Playlist detected!*\n\nWhat would you like to download?',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('🎬 All Videos (360p)', 'playlist_video')],
                            [Markup.button.callback('🎵 All Audios', 'playlist_audio')]
                        ])
                    }
                );
            } else {
                // Single video - get info and show thumbnail
                await ctx.sendChatAction('upload_photo');
                
                // Get video info
                const info = await getVideoInfo(url);
                
                if (!info || !info.success) {
                    return ctx.reply('❌ Could not fetch video information. Please try again.');
                }
                
                // Store video info in session
                userSessions.set(userId, { 
                    type: 'video', 
                    url: url,
                    title: info.title,
                    duration: info.duration,
                    channel: info.channel,
                    views: info.views
                });
                
                // Create caption
                const caption = 
                    `🎬 *${info.title}*\n\n` +
                    `📺 *Channel:* ${info.channel}\n` +
                    `⏱️ *Duration:* ${formatDuration(info.duration)}\n` +
                    `👁️ *Views:* ${formatViews(info.views)}\n\n` +
                    `⬇️ *Choose download option:*`;
                
                // Send photo with buttons
                await ctx.replyWithPhoto(
                    info.thumbnail,
                    {
                        caption: caption,
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [
                                Markup.button.callback('🎬 Video (360p)', 'single_video'),
                                Markup.button.callback('🎵 Audio only', 'single_audio')
                            ]
                        ])
                    }
                );
            }
        } else {
            ctx.reply('❌ Please send a valid YouTube link!');
        }
    } catch (error) {
        console.error('Error:', error);
        ctx.reply('❌ Error processing link. Please try again.');
    }
});

// Single video download
bot.action('single_video', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session) {
        return ctx.reply('❌ Session expired. Please send link again.');
    }

    await ctx.answerCbQuery();
    await ctx.editMessageCaption(
        `⏳ *Downloading video...*\nPlease wait...`,
        { parse_mode: 'Markdown' }
    );

    try {
        const result = await downloadVideo(session.url, 'video', TEMP_DIR);

        if (result.success) {
            await ctx.replyWithVideo(
                { source: result.filePath },
                {
                    caption: `🎬 *${session.title || result.title}*\n\n📹 Quality: 360p`,
                    parse_mode: 'Markdown'
                }
            );
            
            // Clean up
            if (fs.existsSync(result.filePath)) {
                fs.removeSync(result.filePath);
            }
        } else {
            await ctx.reply(`❌ Error: ${result.error}`);
        }
    } catch (error) {
        await ctx.reply('❌ Download failed. Please try again.');
    } finally {
        userSessions.delete(userId);
    }
});

// Single audio download
bot.action('single_audio', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session) {
        return ctx.reply('❌ Session expired. Please send link again.');
    }

    await ctx.answerCbQuery();
    await ctx.editMessageCaption(
        `⏳ *Downloading audio...*\nPlease wait...`,
        { parse_mode: 'Markdown' }
    );

    try {
        const result = await downloadVideo(session.url, 'audio', TEMP_DIR);

        if (result.success) {
            await ctx.replyWithAudio(
                { source: result.filePath },
                {
                    caption: `🎵 *${session.title || result.title}*`,
                    parse_mode: 'Markdown',
                    title: session.title || result.title,
                    performer: session.channel || 'YouTube'
                }
            );
            
            // Clean up
            if (fs.existsSync(result.filePath)) {
                fs.removeSync(result.filePath);
            }
        } else {
            await ctx.reply(`❌ Error: ${result.error}`);
        }
    } catch (error) {
        await ctx.reply('❌ Download failed. Please try again.');
    } finally {
        userSessions.delete(userId);
    }
});

// Playlist video download
bot.action('playlist_video', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session) {
        return ctx.reply('❌ Session expired. Please send link again.');
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText('⏳ *Downloading playlist videos...*\nThis may take several minutes...', { parse_mode: 'Markdown' });

    try {
        const results = await downloadPlaylist(session.url, 'video', TEMP_DIR);

        let successCount = 0;
        let failCount = 0;

        for (const result of results) {
            if (result.success) {
                try {
                    await ctx.replyWithVideo(
                        { source: result.filePath },
                        {
                            caption: `🎬 *${result.title}*\n\n📹 Quality: 360p`,
                            parse_mode: 'Markdown'
                        }
                    );
                    successCount++;
                } catch (e) {
                    failCount++;
                } finally {
                    if (fs.existsSync(result.filePath)) {
                        fs.removeSync(result.filePath);
                    }
                }
            } else {
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await ctx.reply(
            `✅ *Download complete!*\n\n` +
            `✓ Success: ${successCount}\n` +
            `✗ Failed: ${failCount}`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        await ctx.reply('❌ Playlist download failed. Please try again.');
    } finally {
        userSessions.delete(userId);
    }
});

// Playlist audio download
bot.action('playlist_audio', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (!session) {
        return ctx.reply('❌ Session expired. Please send link again.');
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText('⏳ *Downloading playlist audios...*\nThis may take several minutes...', { parse_mode: 'Markdown' });

    try {
        const results = await downloadPlaylist(session.url, 'audio', TEMP_DIR);

        let successCount = 0;
        let failCount = 0;

        for (const result of results) {
            if (result.success) {
                try {
                    await ctx.replyWithAudio(
                        { source: result.filePath },
                        {
                            caption: `🎵 *${result.title}*`,
                            parse_mode: 'Markdown'
                        }
                    );
                    successCount++;
                } catch (e) {
                    failCount++;
                } finally {
                    if (fs.existsSync(result.filePath)) {
                        fs.removeSync(result.filePath);
                    }
                }
            } else {
                failCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await ctx.reply(
            `✅ *Download complete!*\n\n` +
            `✓ Success: ${successCount}\n` +
            `✗ Failed: ${failCount}`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        await ctx.reply('❌ Playlist download failed. Please try again.');
    } finally {
        userSessions.delete(userId);
    }
});

// Error handler
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('❌ An error occurred. Please try again.').catch(e => {});
});

// Start bot
bot.launch().then(() => {
    console.log('✅ Bot is running!');
    console.log('🤖 Bot username:', bot.botInfo?.username);
}).catch((err) => {
    console.error('❌ Failed to start bot:', err);
});

// Graceful shutdown
process.once('SIGINT', () => {
    fs.emptyDirSync(TEMP_DIR);
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    fs.emptyDirSync(TEMP_DIR);
    bot.stop('SIGTERM');
});
