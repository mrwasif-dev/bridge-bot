const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const P = require("pino");
const QRCode = require("qrcode");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TARGET_JID = process.env.TARGET_JID;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN || !TARGET_JID) {
  console.log("❌ Please set TELEGRAM_TOKEN and TARGET_JID");
  process.exit(1);
}

const app = express();
let currentQR = null;

app.get("/", async (req, res) => {
  if (!currentQR) {
    return res.send("<h2>⚡ WhatsApp Connected or QR Not Generated</h2>");
  }

  const qrImage = await QRCode.toDataURL(currentQR);

  res.send(`
    <html>
      <head>
        <title>WhatsApp QR</title>
      </head>
      <body style="text-align:center;font-family:sans-serif;">
        <h2>Scan QR to Connect WhatsApp</h2>
        <img src="${qrImage}" />
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("🌐 Web Server Running"));

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      currentQR = qr;
      console.log("QR Updated");
    }

    if (connection === "open") {
      currentQR = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) startWhatsApp();
    }
  });

  bot.on("message", async (msg) => {
    try {
      if (msg.text) {
        await sock.sendMessage(TARGET_JID, {
          text: `📩 Telegram:\n\n${msg.text}`
        });
      }

      if (msg.photo) {
        const file = await bot.getFile(msg.photo.pop().file_id);
        const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
        const res = await axios.get(url, { responseType: "arraybuffer" });

        await sock.sendMessage(TARGET_JID, {
          image: Buffer.from(res.data),
          caption: msg.caption || "📸 Telegram Photo"
        });
      }

      if (msg.video) {
        const file = await bot.getFile(msg.video.file_id);
        const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
        const res = await axios.get(url, { responseType: "arraybuffer" });

        await sock.sendMessage(TARGET_JID, {
          video: Buffer.from(res.data),
          caption: msg.caption || "🎥 Telegram Video"
        });
      }

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
}

startWhatsApp();
