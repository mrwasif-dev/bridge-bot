const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');

// Cookies store
let cookies = [];

// Function to get fresh cookies using puppeteer
async function refreshCookies() {
    console.log('🔄 Refreshing YouTube cookies...');
    
    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Visit YouTube
        await page.goto('https://www.youtube.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait a bit
        await page.waitForTimeout(5000);
        
        // Get cookies
        const cookiesData = await page.cookies();
        
        // Format cookies for ytdl
        cookies = cookiesData.map(c => `${c.name}=${c.value}`).join('; ');
        
        await browser.close();
        
        console.log('✅ Cookies refreshed successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to refresh cookies:', error);
        return false;
    }
}

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        console.log('Fetching video info...');
        
        // Refresh cookies if needed
        if (!cookies.length) {
            await refreshCookies();
        }
        
        // Create agent with cookies
        const agent = ytdl.createAgent(undefined, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
                    'Cookie': cookies
                }
            }
        });
        
        // Get video info with retry
        let info;
        try {
            info = await ytdl.getInfo(url, {
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': cookies
                    }
                }
            });
        } catch (infoError) {
            console.log('Info fetch failed, refreshing cookies and retrying...');
            await refreshCookies();
            
            info = await ytdl.getInfo(url, {
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': cookies
                    }
                }
            });
        }
        
        let title = info.videoDetails.title
            .replace(/[^\w\s]/gi, '')
            .substring(0, 50)
            .trim();
        
        if (!title) title = 'video_' + Date.now();
        
        const sanitizedTitle = title.replace(/\s+/g, '_');
        const timestamp = Date.now();

        if (type === 'video') {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp4`);
            
            // Try different formats
            let format = info.formats.find(f => 
                f.qualityLabel === '360p' || 
                f.qualityLabel === '360p 30fps' ||
                f.height === 360
            );
            
            if (!format) {
                format = info.formats
                    .filter(f => f.hasVideo && f.hasAudio)
                    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }

            if (!format) {
                throw new Error('No suitable video format found');
            }

            console.log(`Downloading video: ${format.qualityLabel || format.quality || 'unknown'}`);

            const stream = ytdl(url, {
                format: format,
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': cookies
                    }
                }
            });
            
            await new Promise((resolve, reject) => {
                stream
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });
            
        } else {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp3`);
            
            // Get audio format
            const format = info.formats.find(f => f.hasAudio && !f.hasVideo);
            
            if (!format) {
                throw new Error('No audio format found');
            }

            console.log('Downloading audio...');

            const stream = ytdl(url, {
                format: format,
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': cookies
                    }
                }
            });
            
            await new Promise((resolve, reject) => {
                stream
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }

        // Verify file
        const stats = await fs.stat(filePath);
        if (stats.size < 1000) {
            throw new Error('Downloaded file is too small');
        }

        console.log(`✅ Downloaded: ${title} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        return {
            success: true,
            filePath: filePath,
            title: info.videoDetails.title
        };
        
    } catch (error) {
        console.error('Download error:', error);
        
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.removeSync(filePath);
            } catch (e) {}
        }
        
        return {
            success: false,
            error: error.message || 'Download failed'
        };
    }
}

// Download playlist
async function downloadPlaylist(playlistUrl, type, tempDir) {
    const results = [];
    
    try {
        console.log('Fetching playlist...');
        
        const playlist = await ytpl(playlistUrl, { 
            limit: 3, // Reduce to 3 for testing
            pages: 1
        });

        console.log(`Found ${playlist.items.length} videos in playlist`);

        for (let i = 0; i < playlist.items.length; i++) {
            const item = playlist.items[i];
            
            try {
                console.log(`Downloading ${i + 1}/${playlist.items.length}: ${item.title}`);
                
                const videoUrl = `https://youtube.com/watch?v=${item.id}`;
                const result = await downloadVideo(videoUrl, type, tempDir);
                
                if (result.success) {
                    results.push({
                        success: true,
                        filePath: result.filePath,
                        title: item.title
                    });
                } else {
                    results.push({
                        success: false,
                        title: item.title,
                        error: result.error
                    });
                }

                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (itemError) {
                results.push({
                    success: false,
                    title: item.title,
                    error: itemError.message
                });
            }
        }

        return results;
        
    } catch (error) {
        console.error('Playlist error:', error);
        throw error;
    }
}

// Refresh cookies every 30 minutes
setInterval(async () => {
    await refreshCookies();
}, 30 * 60 * 1000);

module.exports = {
    downloadVideo,
    downloadPlaylist
};
