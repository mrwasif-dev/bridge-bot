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
let TARGET_JID = process.env.TARGET_JID;

if (!TELEGRAM_TOKEN || !TARGET_JID) {
  console.log("❌ Missing ENV Variables");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const app = express();
let currentQR = null;
let sock;

app.get("/", async (req, res) => {
  if (!currentQR) {
    return res.send("<h2>✅ WhatsApp Connected OR QR Not Ready</h2>");
  }

  const qrImage = await QRCode.toDataURL(currentQR);

  res.send(`
    <html>
    <body style="text-align:center;">
    <h2>Scan QR</h2>
    <img src="${qrImage}" />
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("🌐 Server Running"));

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) currentQR = qr;

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
}

startWhatsApp();

//
// ✅ TELEGRAM COMMANDS
//

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  try {

    // 🔹 Change JID Command
    if (text && text.startsWith("/jid")) {
      const newJid = text.split(" ")[1];
      if (newJid) {
        TARGET_JID = newJid;
        return bot.sendMessage(chatId, "✅ JID Updated");
      }
    }

    // 🔹 Status Command
    if (text === "/status") {
      return bot.sendMessage(chatId,
        `📊 Bot Running\n\n🎯 JID: ${TARGET_JID}\n🟢 WhatsApp: ${sock ? "Connected" : "Not Connected"}`
      );
    }

    // 🔹 Restart WhatsApp Session
    if (text === "/restart") {
      await bot.sendMessage(chatId, "♻ Restarting WhatsApp...");
      return startWhatsApp();
    }

    // 🔹 Forward Text
    if (text && !text.startsWith("/")) {
      if (sock) {
        await sock.sendMessage(TARGET_JID, {
          text: `📩 Telegram:\n\n${text}`
        });
      }
    }

    // 🔹 Forward Photo
    if (msg.photo) {
      const file = await bot.getFile(msg.photo.pop().file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        image: Buffer.from(res.data),
        caption: msg.caption || "📸 Telegram Photo"
      });
    }

    // 🔹 Forward Video
    if (msg.video) {
      const file = await bot.getFile(msg.video.file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      await sock.sendMessage(TARGET_JID, {
        video: Buffer.from(res.data),
        caption: msg.caption || "🎥 Telegram Video"
      });
    }

  } catch (err) {
    console.log("Error:", err.message);
  }
});
