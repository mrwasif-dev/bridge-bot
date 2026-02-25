// =============================
// TELEGRAM ➜ WHATSAPP BRIDGE
// FINAL WORKING VERSION
// =============================

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const P = require("pino");
const QRCode = require("qrcode");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
let TARGET_JID = process.env.TARGET_JID;

if (!TELEGRAM_TOKEN || !TARGET_JID) {
  console.log("❌ Missing TELEGRAM_TOKEN or TARGET_JID");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const app = express();
let qrCodeData = null;
let sock;

// =====================
// WEB PAGE (QR DISPLAY)
// =====================

app.get("/", async (req, res) => {
  if (!qrCodeData) {
    return res.send("<h2>Waiting for QR...</h2>");
  }

  const qrImage = await QRCode.toDataURL(qrCodeData);

  res.send(`
    <html>
    <head>
    <title>WhatsApp QR</title>
    </head>
    <body style="text-align:center;font-family:sans-serif;">
    <h2>Scan QR To Connect WhatsApp</h2>
    <img src="${qrImage}" />
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Server Running on Port", PORT);
});

// =====================
// WHATSAPP CONNECTION
// =====================

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrCodeData = qr;
      console.log("✅ QR Generated");
    }

    if (connection === "open") {
      qrCodeData = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        startWhatsApp();
      }
    }
  });
}

startWhatsApp();

// =====================
// TELEGRAM BOT + COMMANDS
// =====================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  try {

    // =====================
    // COMMAND: STATUS
    // =====================
    if (text === "/status") {
      return bot.sendMessage(
        chatId,
        `📊 Status:\n\n🎯 JID: ${TARGET_JID}\n🟢 WhatsApp: ${sock ? "Connected" : "Not Connected"}`
      );
    }

    // =====================
    // COMMAND: CHANGE JID
    // =====================
    if (text && text.startsWith("/jid")) {
      const newJid = text.split(" ")[1];
      if (newJid) {
        TARGET_JID = newJid;
        return bot.sendMessage(chatId, "✅ JID Updated Successfully");
      }
    }

    // =====================
    // COMMAND: RESTART WHATSAPP
    // =====================
    if (text === "/restart") {
      await bot.sendMessage(chatId, "♻ Restarting WhatsApp...");
      return startWhatsApp();
    }

    // =====================
    // FORWARD TEXT
    // =====================
    if (text && !text.startsWith("/")) {
      if (sock) {
        await sock.sendMessage(TARGET_JID, {
          text: `📩 Telegram:\n\n${text}`
        });
      }
    }

    // =====================
    // FORWARD PHOTO
    // =====================
    if (msg.photo) {
      const file = await bot.getFile(msg.photo.pop().file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        image: Buffer.from(res.data),
        caption: msg.caption || "📸 Telegram Photo"
      });
    }

    // =====================
    // FORWARD VIDEO
    // =====================
    if (msg.video) {
      const file = await bot.getFile(msg.video.file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        video: Buffer.from(res.data),
        caption: msg.caption || "🎥 Telegram Video"
      });
    }

    // =====================
    // FORWARD DOCUMENT
    // =====================
    if (msg.document) {
      const file = await bot.getFile(msg.document.file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        document: Buffer.from(res.data),
        fileName: msg.document.file_name
      });
    }

  } catch (err) {
    console.log("Error:", err.message);
  }
});
