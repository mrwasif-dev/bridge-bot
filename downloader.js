const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');

// Get video info only (without downloading)
async function getVideoInfo(url) {
    try {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });
        
        // Get best thumbnail
        const thumbnails = info.videoDetails.thumbnails;
        const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || thumbnails[0]?.url;
        
        return {
            success: true,
            title: info.videoDetails.title,
            duration: parseInt(info.videoDetails.lengthSeconds),
            channel: info.videoDetails.author.name,
            views: parseInt(info.videoDetails.viewCount),
            thumbnail: bestThumbnail,
            videoId: info.videoDetails.videoId
        };
    } catch (error) {
        console.error('Get video info error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            
            // Get 360p format (18 = 360p mp4)
            let format = info.formats.find(f => 
                f.itag === 18 || (f.height === 360 && f.container === 'mp4')
            );
            
            // If 360p not available, get lowest quality with video and audio
            if (!format) {
                format = info.formats
                    .filter(f => f.hasVideo && f.hasAudio)
                    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }

            if (!format) {
                throw new Error('No suitable video format found');
            }

            const stream = ytdl(url, { 
                format: format,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

            const stream = ytdl(url, { 
                format: format,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

        return {
            success: true,
            filePath: filePath,
            title: info.videoDetails.title
        };
    } catch (error) {
        console.error('Download error:', error);
        
        // Clean up on error
        if (filePath && fs.existsSync(filePath)) {
            fs.removeSync(filePath);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Download playlist
async function downloadPlaylist(playlistUrl, type, tempDir) {
    const results = [];
    
    try {
        // Get playlist
        const playlist = await ytpl(playlistUrl, { 
            limit: 5,
            pages: 1
        });

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
                await new Promise(resolve => setTimeout(resolve, 2000));
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

module.exports = {
    downloadVideo,
    downloadPlaylist,
    getVideoInfo
};
