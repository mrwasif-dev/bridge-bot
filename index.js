require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

// ============ CONFIGURATION ============
const config = {
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN,
        adminId: parseInt(process.env.ADMIN_ID)
    },
    whatsapp: {
        targetNumber: process.env.TARGET_WHATSAPP + '@c.us'
    },
    bridge: {
        enabled: true
    }
};

// ============ INITIALIZATION ============
const app = express();
const bot = new Telegraf(config.telegram.token);

const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ============ TELEGRAM COMMANDS ============
bot.start((ctx) => {
    ctx.reply(
        '🤖 *Telegram-WhatsApp Bridge Bot*\n\n' +
        '*Commands:*\n' +
        '/help - Show help\n' +
        '/status - Check connection status\n' +
        '/qr - Get WhatsApp QR code\n' +
        '/on - Turn bridge ON\n' +
        '/off - Turn bridge OFF\n' +
        '/send - Send message to WhatsApp\n' +
        '/chatid - Show your chat ID',
        { parse_mode: 'Markdown' }
    );
});

bot.help((ctx) => {
    ctx.reply(
        '📚 *How to Use:*\n\n' +
        '1. First connect WhatsApp using /qr\n' +
        '2. Scan QR code with WhatsApp\n' +
        '3. Start sending messages\n\n' +
        'All Telegram messages will be forwarded to WhatsApp\n' +
        'All WhatsApp messages will be forwarded here',
        { parse_mode: 'Markdown' }
    );
});

bot.command('chatid', (ctx) => {
    ctx.reply(`Your Chat ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' });
});

bot.command('status', (ctx) => {
    const waStatus = whatsapp.info ? '✅ Connected' : '❌ Disconnected';
    const bridgeStatus = config.bridge.enabled ? '✅ ON' : '❌ OFF';
    
    ctx.reply(
        `📊 *Status*\n\n` +
        `WhatsApp: ${waStatus}\n` +
        `Bridge: ${bridgeStatus}\n` +
        `Target: ${process.env.TARGET_WHATSAPP}`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('qr', async (ctx) => {
    if (ctx.chat.id !== config.telegram.adminId) {
        return ctx.reply('❌ Unauthorized');
    }
    
    ctx.reply('📱 Generating QR code... Check console or scan below:');
    
    // QR will be generated in console by whatsapp-web.js
});

bot.command('on', (ctx) => {
    if (ctx.chat.id !== config.telegram.adminId) {
        return ctx.reply('❌ Unauthorized');
    }
    config.bridge.enabled = true;
    ctx.reply('✅ Bridge turned ON');
});

bot.command('off', (ctx) => {
    if (ctx.chat.id !== config.telegram.adminId) {
        return ctx.reply('❌ Unauthorized');
    }
    config.bridge.enabled = false;
    ctx.reply('✅ Bridge turned OFF');
});

bot.command('send', async (ctx) => {
    if (ctx.chat.id !== config.telegram.adminId) {
        return ctx.reply('❌ Unauthorized');
    }
    
    const message = ctx.message.text.replace('/send', '').trim();
    
    if (!message) {
        return ctx.reply('Usage: /send Your message here');
    }
    
    if (!whatsapp.info) {
        return ctx.reply('❌ WhatsApp not connected');
    }
    
    try {
        await whatsapp.sendMessage(config.whatsapp.targetNumber, 
            `📨 *From Telegram:*\n\n${message}`
        );
        ctx.reply('✅ Message sent to WhatsApp');
    } catch (error) {
        ctx.reply('❌ Error: ' + error.message);
    }
});

// Forward all Telegram messages to WhatsApp
bot.on('text', async (ctx) => {
    if (!config.bridge.enabled) return;
    if (ctx.chat.id !== config.telegram.adminId) return;
    if (!whatsapp.info) return;
    
    const msg = ctx.message.text;
    
    // Skip if it's a command
    if (msg.startsWith('/')) return;
    
    try {
        await whatsapp.sendMessage(config.whatsapp.targetNumber, 
            `📨 *${ctx.from.first_name}:*\n\n${msg}`
        );
    } catch (error) {
        console.error('Forward error:', error);
    }
});

// ============ WHATSAPP EVENTS ============
whatsapp.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 Scan QR code with WhatsApp');
    
    // Send QR as text to Telegram (simplified)
    bot.telegram.sendMessage(
        config.telegram.adminId,
        '📱 *QR Code Generated*\nScan with WhatsApp\n\n' +
        'Check console for QR code or use this link:\n' +
        `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`,
        { parse_mode: 'Markdown' }
    );
});

whatsapp.on('ready', () => {
    console.log('✅ WhatsApp connected!');
    bot.telegram.sendMessage(
        config.telegram.adminId,
        '✅ *WhatsApp Connected Successfully!*',
        { parse_mode: 'Markdown' }
    );
});

whatsapp.on('authenticated', () => {
    console.log('✅ WhatsApp authenticated!');
});

whatsapp.on('disconnected', () => {
    console.log('❌ WhatsApp disconnected');
    bot.telegram.sendMessage(
        config.telegram.adminId,
        '❌ *WhatsApp Disconnected*\nUse /qr to reconnect',
        { parse_mode: 'Markdown' }
    );
});

// Forward WhatsApp messages to Telegram
whatsapp.on('message', async (message) => {
    if (!config.bridge.enabled) return;
    if (message.fromMe) return; // Skip own messages
    
    try {
        await bot.telegram.sendMessage(
            config.telegram.adminId,
            `📨 *WhatsApp:*\n*From:* ${message.from}\n\n${message.body}`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('WhatsApp to Telegram error:', error);
    }
});

// ============ EXPRESS SERVER ============
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        telegram: '✅',
        whatsapp: whatsapp.info ? '✅' : '❌',
        bridge: config.bridge.enabled ? '✅' : '❌'
    });
});

app.get('/health', (req, res) => {
    res.send('OK');
});

// ============ START BOT ============
async function start() {
    try {
        // Start Telegram bot
        await bot.launch();
        console.log('✅ Telegram bot started');
        
        // Start WhatsApp client
        await whatsapp.initialize();
        console.log('🔄 WhatsApp initializing...');
        
        // Start Express server
        app.listen(process.env.PORT || 3000, () => {
            console.log(`✅ Server running on port ${process.env.PORT || 3000}`);
        });
        
    } catch (error) {
        console.error('Startup error:', error);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    await bot.stop();
    await whatsapp.destroy();
    process.exit(0);
});

// Start everything
start();
