const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Get video info using oEmbed API (more reliable)
async function getVideoInfo(url) {
    try {
        // Extract video ID
        let videoId = '';
        if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        } else if (url.includes('v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('shorts/')) {
            videoId = url.split('shorts/')[1].split('?')[0];
        }
        
        if (!videoId) {
            throw new Error('Could not extract video ID');
        }
        
        // Use YouTube oEmbed API (no token required)
        const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const oEmbedResponse = await axios.get(oEmbedUrl);
        
        // Get additional info from ytdl
        let ytdlInfo = null;
        try {
            ytdlInfo = await ytdl.getInfo(videoId, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            });
        } catch (e) {
            console.log('ytdl info failed, using oEmbed only');
        }
        
        // Get thumbnail (maxresdefault is best quality)
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        
        // Check if thumbnail exists
        let finalThumbnail = thumbnailUrl;
        try {
            await axios.head(thumbnailUrl);
        } catch {
            // If maxresdefault doesn't exist, use hqdefault
            finalThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
        
        return {
            success: true,
            title: oEmbedResponse.data.title,
            duration: ytdlInfo ? parseInt(ytdlInfo.videoDetails.lengthSeconds) : 0,
            channel: ytdlInfo ? ytdlInfo.videoDetails.author.name : oEmbedResponse.data.author_name,
            views: ytdlInfo ? parseInt(ytdlInfo.videoDetails.viewCount) : 0,
            thumbnail: finalThumbnail,
            videoId: videoId
        };
    } catch (error) {
        console.error('Get video info error:', error);
        
        // Fallback to ytdl only
        try {
            const info = await ytdl.getInfo(url, {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            });
            
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
        } catch (ytdlError) {
            console.error('Fallback also failed:', ytdlError);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
                f.itag === 18 || f.qualityLabel === '360p' || (f.height === 360 && f.container === 'mp4')
            );
            
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
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
                // Try to get any audio format
                const audioFormat = info.formats
                    .filter(f => f.hasAudio)
                    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
                
                if (!audioFormat) {
                    throw new Error('No audio format found');
                }
                
                const stream = ytdl(url, { 
                    format: audioFormat,
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
                const stream = ytdl(url, { 
                    format: format,
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
        const playlist = await ytpl(playlistUrl, { 
            limit: 3,
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
