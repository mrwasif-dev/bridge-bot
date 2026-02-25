const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        // Get video info
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
            
            // Get 360p format (18 = 360p mp4)
            const format = info.formats.find(f => 
                f.itag === 18 || (f.height === 360 && f.container === 'mp4')
            );
            
            if (!format) {
                throw new Error('360p format not available');
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
            
            const stream = ytdl(url, { 
                quality: 'highestaudio',
                filter: 'audioonly',
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

        // Verify file
        const stats = await fs.stat(filePath);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
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
        // Validate playlist
        if (!await ytpl.validateID(playlistUrl)) {
            throw new Error('Invalid playlist URL');
        }

        const playlist = await ytpl(playlistUrl, { 
            limit: 10, // Limit to 10 videos to avoid Heroku timeout
            pages: 1
        });

        for (let i = 0; i < playlist.items.length; i++) {
            const item = playlist.items[i];
            
            try {
                // Send status update
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
    downloadPlaylist
};
