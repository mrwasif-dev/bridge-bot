const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// ✅ Get cookies from .env (BEST PRACTICE)
const COOKIE = process.env.YT_COOKIE || 'CONSENT=YES+srp.gws-20220215-0-RC2.en+FX+374;';

// ============================
// Get Video Info
// ============================
async function getVideoInfo(url) {
    try {

        let videoId = extractVideoId(url);
        if (!videoId) throw new Error("Invalid Video URL");

        const info = await ytdl.getInfo(videoId, {
            requestOptions: {
                headers: getHeaders()
            }
        });

        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

        let finalThumbnail = thumbnailUrl;
        try {
            await axios.head(thumbnailUrl, { timeout: 3000 });
        } catch {
            finalThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }

        return {
            success: true,
            title: info.videoDetails.title,
            duration: parseInt(info.videoDetails.lengthSeconds),
            channel: info.videoDetails.author.name,
            views: parseInt(info.videoDetails.viewCount),
            thumbnail: finalThumbnail,
            videoId
        };

    } catch (error) {
        console.error("GetVideoInfo Error:", error.message);

        return {
            success: false,
            error: error.message
        };
    }
}

// ============================
// Download Video / Audio
// ============================
async function downloadVideo(url, type, tempDir) {

    let filePath = null;

    try {

        const videoId = extractVideoId(url);

        const info = await ytdl.getInfo(videoId, {
            requestOptions: {
                headers: getHeaders()
            }
        });

        let title = sanitizeTitle(info.videoDetails.title);

        const timestamp = Date.now();

        if (type === "video") {

            filePath = path.join(tempDir, `${title}_${timestamp}.mp4`);

            const format = ytdl.chooseFormat(info.formats, {
                quality: "18"
            });

            const stream = ytdl(videoId, {
                format,
                requestOptions: {
                    headers: getHeaders()
                }
            });

            await saveStream(stream, filePath);

        } else {

            filePath = path.join(tempDir, `${title}_${timestamp}.mp3`);

            const format = ytdl.chooseFormat(info.formats, {
                filter: "audioonly"
            });

            const stream = ytdl(videoId, {
                format,
                requestOptions: {
                    headers: getHeaders()
                }
            });

            await saveStream(stream, filePath);
        }

        const stats = await fs.stat(filePath);
        if (stats.size < 1000) throw new Error("File too small (download failed)");

        return {
            success: true,
            filePath,
            title: info.videoDetails.title
        };

    } catch (error) {

        console.error("Download error:", error.message);

        if (filePath && fs.existsSync(filePath)) {
            await fs.remove(filePath);
        }

        return {
            success: false,
            error: error.message
        };
    }
}

// ============================
// Download Playlist
// ============================
async function downloadPlaylist(playlistUrl, type, tempDir) {

    const results = [];

    const playlist = await ytpl(playlistUrl, {
        limit: 5
    });

    for (let item of playlist.items) {

        try {

            const videoUrl = `https://youtube.com/watch?v=${item.id}`;
            const result = await downloadVideo(videoUrl, type, tempDir);

            results.push({
                title: item.title,
                ...result
            });

            await delay(2000);

        } catch (err) {

            results.push({
                title: item.title,
                success: false,
                error: err.message
            });

        }
    }

    return results;
}

// ============================
// Helper Functions
// ============================

function extractVideoId(url) {

    if (url.includes("youtu.be/")) {
        return url.split("youtu.be/")[1].split("?")[0];
    }

    if (url.includes("v=")) {
        return url.split("v=")[1].split("&")[0];
    }

    if (url.includes("shorts/")) {
        return url.split("shorts/")[1].split("?")[0];
    }

    return null;
}

function sanitizeTitle(title) {

    return title
        .replace(/[^\w\s]/gi, "")
        .trim()
        .substring(0, 50)
        .replace(/\s+/g, "_") || "video";
}

function getHeaders() {

    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": COOKIE
    };
}

function saveStream(stream, filePath) {

    return new Promise((resolve, reject) => {

        stream
            .pipe(fs.createWriteStream(filePath))
            .on("finish", resolve)
            .on("error", reject);

        stream.on("error", reject);
    });
}

function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

module.exports = {
    downloadVideo,
    downloadPlaylist,
    getVideoInfo
};
