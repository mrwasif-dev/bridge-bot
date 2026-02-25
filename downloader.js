const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

// Custom agent
const agent = ytdl.createAgent(undefined, {
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  }
});

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        console.log('Fetching video info...');
        
        // Get video info with options
        const info = await ytdl.getInfo(url, {
            agent: agent,
            requestOptions: {
                headers: {
                    'Cookie': 'CONSENT=YES+srp.gws-20220215-0-RC2.en+FX+374',
                }
            }
        });
        
        let title = info.videoDetails.title
            .replace(/[^\w\s]/gi, '')
            .substring(0, 50)
            .trim();
        
        if (!title) title = 'video_' + Date.now();
        
        const sanitizedTitle = title.replace(/\s+/g, '_');
        const timestamp = Date.now();

        if (type === 'video') {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp4`);
            
            // Get 360p format
            let format = info.formats.find(f => 
                f.qualityLabel === '360p' || 
                f.qualityLabel === '360p 30fps' ||
                f.qualityLabel === '360p 60fps' ||
                f.height === 360
            );
            
            // If no 360p, get lowest quality
            if (!format) {
                format = info.formats
                    .filter(f => f.hasVideo && f.hasAudio)
                    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }

            if (!format) {
                throw new Error('No suitable video format found');
            }

            console.log(`Downloading video: ${format.qualityLabel || format.quality || 'unknown'}`);

            // Download video
            const stream = ytdl(url, {
                format: format,
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': 'CONSENT=YES+srp.gws-20220215-0-RC2.en+FX+374',
                    }
                }
            });
            
            await new Promise((resolve, reject) => {
                stream
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', () => {
                        console.log('Video download finished');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Stream error:', err);
                        reject(err);
                    });
            });
            
        } else {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp3`);
            
            // Get audio format
            const format = info.formats.find(f => f.hasAudio && !f.hasVideo);
            
            if (!format) {
                throw new Error('No audio format found');
            }

            console.log('Downloading audio...');

            // Download audio
            const stream = ytdl(url, {
                format: format,
                agent: agent,
                requestOptions: {
                    headers: {
                        'Cookie': 'CONSENT=YES+srp.gws-20220215-0-RC2.en+FX+374',
                    }
                }
            });
            
            await new Promise((resolve, reject) => {
                stream
                    .pipe(fs.createWriteStream(filePath))
                    .on('finish', () => {
                        console.log('Audio download finished');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Stream error:', err);
                        reject(err);
                    });
            });
        }

        // Verify file
        const stats = await fs.stat(filePath);
        if (stats.size < 1000) { // Less than 1KB
            throw new Error('Downloaded file is too small');
        }

        console.log(`✅ Downloaded: ${title} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        return {
            success: true,
            filePath: filePath,
            title: info.videoDetails.title
        };
        
    } catch (error) {
        console.error('Download error details:', error);
        
        // Clean up on error
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.removeSync(filePath);
            } catch (e) {
                console.error('Cleanup error:', e);
            }
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
        
        // Get playlist
        const playlist = await ytpl(playlistUrl, { 
            limit: 5,
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

                // Delay between downloads
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (itemError) {
                console.error(`Error downloading ${item.title}:`, itemError);
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

module.exports = {
    downloadVideo,
    downloadPlaylist
};
