const { Telegraf, Markup } = require('telegraf');
const { downloadVideo, downloadPlaylist } = require('./downloader');
const fs = require('fs-extra');
const path = require('path');
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
        '2️⃣ Choose Video or Audio\n' +
        '3️⃣ File will be downloaded and sent\n\n' +
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
        // Check if it's a YouTube link
        if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
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
                userSessions.set(userId, { type: 'video', url: url });

                await ctx.reply(
                    '🎬 *Video detected!*\n\nWhat would you like to download?',
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('🎬 Video (360p)', 'single_video')],
                            [Markup.button.callback('🎵 Audio only', 'single_audio')]
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
    await ctx.editMessageText('⏳ *Downloading video...*\nPlease wait...', { parse_mode: 'Markdown' });

    try {
        const result = await downloadVideo(session.url, 'video', TEMP_DIR);

        if (result.success) {
            await ctx.replyWithVideo(
                { source: result.filePath },
                {
                    caption: `🎬 *${result.title}*\n\n📹 Quality: 360p`,
                    parse_mode: 'Markdown'
                }
            );
        } else {
            await ctx.reply(`❌ Error: ${result.error}`);
        }
    } catch (error) {
        await ctx.reply('❌ Download failed. Please try again.');
    } finally {
        // Clean up
        if (result?.filePath && fs.existsSync(result.filePath)) {
            fs.removeSync(result.filePath);
        }
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
    await ctx.editMessageText('⏳ *Downloading audio...*\nPlease wait...', { parse_mode: 'Markdown' });

    try {
        const result = await downloadVideo(session.url, 'audio', TEMP_DIR);

        if (result.success) {
            await ctx.replyWithAudio(
                { source: result.filePath },
                {
                    caption: `🎵 *${result.title}*`,
                    parse_mode: 'Markdown'
                }
            );
        } else {
            await ctx.reply(`❌ Error: ${result.error}`);
        }
    } catch (error) {
        await ctx.reply('❌ Download failed. Please try again.');
    } finally {
        // Clean up
        if (result?.filePath && fs.existsSync(result.filePath)) {
            fs.removeSync(result.filePath);
        }
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

// Health check for Heroku
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('YouTube Bot is running!');
});

app.listen(PORT, () => {
    console.log(`✅ Health check server running on port ${PORT}`);
});

// Start bot
bot.launch().then(() => {
    console.log('✅ Bot is running...');
    console.log('🤖 Bot username:', bot.botInfo?.username);
}).catch((err) => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
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
