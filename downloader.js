const youtubedl = require('youtube-dl-exec');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Get video info
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
        
        // Get video info using youtube-dl
        const info = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        // Get thumbnail
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        
        // Check if thumbnail exists
        let finalThumbnail = thumbnailUrl;
        try {
            await axios.head(thumbnailUrl, { timeout: 3000 });
        } catch {
            finalThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
        
        return {
            success: true,
            title: info.title || 'Unknown Title',
            duration: info.duration || 0,
            channel: info.uploader || 'Unknown Channel',
            views: info.view_count || 0,
            thumbnail: finalThumbnail,
            videoId: videoId
        };
    } catch (error) {
        console.error('Get video info error:', error);
        
        // Fallback to oEmbed
        try {
            const videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1]?.split('?')[0];
            const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const oEmbedResponse = await axios.get(oEmbedUrl);
            
            return {
                success: true,
                title: oEmbedResponse.data.title,
                duration: 0,
                channel: oEmbedResponse.data.author_name,
                views: 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                videoId: videoId
            };
        } catch (oembedError) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Download video/audio
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        // Get video info for title
        const info = await getVideoInfo(url);
        let title = info.title
            .replace(/[^\w\s]/gi, '')
            .substring(0, 50)
            .trim();
        
        if (!title) title = 'video_' + Date.now();
        
        const sanitizedTitle = title.replace(/\s+/g, '_');
        const timestamp = Date.now();

        if (type === 'video') {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp4`);
            
            // Download video with youtube-dl (format 18 = 360p mp4)
            await youtubedl(url, {
                output: filePath,
                format: '18',
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true
            });
        } else {
            filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp3`);
            
            // Download audio with youtube-dl
            await youtubedl(url, {
                output: filePath,
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: 0,
                format: 'bestaudio',
                noWarnings: true,
                noCallHome: true,
                noCheckCertificate: true
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
            title: info.title
        };
    } catch (error) {
        console.error('Download error:', error);
        
        if (filePath && fs.existsSync(filePath)) {
            fs.removeSync(filePath);
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
        // Get playlist info
        const playlistInfo = await youtubedl(playlistUrl, {
            dumpSingleJson: true,
            flatPlaylist: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true
        });
        
        const videos = playlistInfo.entries || [];
        const totalVideos = Math.min(videos.length, 3); // Limit to 3 videos for Heroku
        
        for (let i = 0; i < totalVideos; i++) {
            const video = videos[i];
            
            try {
                console.log(`Downloading ${i + 1}/${totalVideos}: ${video.title}`);
                
                const videoUrl = `https://youtube.com/watch?v=${video.id}`;
                const result = await downloadVideo(videoUrl, type, tempDir);
                
                if (result.success) {
                    results.push({
                        success: true,
                        filePath: result.filePath,
                        title: video.title
                    });
                } else {
                    results.push({
                        success: false,
                        title: video.title,
                        error: result.error
                    });
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (itemError) {
                results.push({
                    success: false,
                    title: video.title,
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
