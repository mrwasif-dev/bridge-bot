// ===============================
// TELEGRAM ➜ WHATSAPP STABLE VERSION
// ===============================

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");
const P = require("pino");
const QRCode = require("qrcode");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
let TARGET_JID = process.env.TARGET_JID;

if (!TELEGRAM_TOKEN || !TARGET_JID) {
  console.log("❌ Missing ENV variables");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

let qrData = null;
let sock;

// ================= WEB QR PAGE =================

app.get("/", async (req, res) => {
  if (!qrData) return res.send("<h2>QR Not Ready</h2>");

  const img = await QRCode.toDataURL(qrData);

  res.send(`
    <html>
    <body style="text-align:center;">
    <h2>Scan QR</h2>
    <img src="${img}" />
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Server Started");
});

// ================= WHATSAPP CONNECTION =================

async function startWhatsApp() {

  const { state, saveCreds } = await useMultiFileAuthState("session");

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {

    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrData = qr;
      console.log("✅ QR Generated");
    }

    if (connection === "open") {
      qrData = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        setTimeout(startWhatsApp, 3000);
      }
    }

  });
}

startWhatsApp();

// ================= TELEGRAM BOT =================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  try {

    // STATUS
    if (text === "/status") {
      return bot.sendMessage(chatId,
        `📊 Status\n\nJID: ${TARGET_JID}\nWhatsApp: ${sock ? "Running" : "Not Connected"}`
      );
    }

    // CHANGE JID
    if (text && text.startsWith("/jid")) {
      const newJid = text.split(" ")[1];
      if (newJid) {
        TARGET_JID = newJid;
        return bot.sendMessage(chatId, "✅ JID Updated");
      }
    }

    // FORWARD TEXT
    if (text && !text.startsWith("/")) {
      if (sock) {
        await sock.sendMessage(TARGET_JID, {
          text: `📩 Telegram:\n\n${text}`
        });
      }
    }

    // FORWARD PHOTO
    if (msg.photo) {
      const file = await bot.getFile(msg.photo.pop().file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        image: Buffer.from(res.data),
        caption: msg.caption || "📸 Photo"
      });
    }

    // FORWARD VIDEO
    if (msg.video) {
      const file = await bot.getFile(msg.video.file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        video: Buffer.from(res.data),
        caption: msg.caption || "🎥 Video"
      });
    }

  } catch (err) {
    console.log("Error:", err.message);
  }

});
