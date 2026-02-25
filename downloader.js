const ytdl = require('ytdl-core');
const ytpl = require('ytpl');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

// Custom agent to avoid 410 error
const agent = new https.Agent({
    keepAlive: true,
    rejectUnauthorized: false
});

// Download single video
async function downloadVideo(url, type, tempDir) {
    let filePath = null;
    
    try {
        // Better options to avoid 410
        const options = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                agent: agent
            }
        };

        // Get video info with retry
        let info;
        try {
            info = await ytdl.getInfo(url, options);
        } catch (infoError) {
            console.log('Retrying with different options...');
            // Try again with different options
            options.requestOptions.headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            info = await ytdl.getInfo(url, options);
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
            
            // Try different formats to avoid 410
            let format;
            
            // Try 360p first
            format = info.formats.find(f => 
                f.itag === 18 || (f.height === 360 && f.container === 'mp4')
            );
            
            // If 360p not available, try lowest available
            if (!format) {
                format = info.formats
                    .filter(f => f.container === 'mp4' && f.hasVideo)
                    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }

            if (!format) {
                // Try any format
                format = info.formats
                    .filter(f => f.hasVideo)
                    .sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }
            
            if (!format) {
                throw new Error('No suitable format found');
            }

            console.log(`Downloading format: ${format.qualityLabel || format.quality || 'unknown'}`);

            const stream = ytdl(url, { 
                format: format,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                },
                agent: agent
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
            const audioFormat = ytdl.chooseFormat(info.formats, { 
                quality: 'highestaudio',
                filter: 'audioonly'
            });

            const stream = ytdl(url, { 
                format: audioFormat,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                },
                agent: agent
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

        console.log(`✅ Downloaded: ${title} (${stats.size} bytes)`);

        return {
            success: true,
            filePath: filePath,
            title: info.videoDetails.title
        };
    } catch (error) {
        console.error('Download error details:', error);
        
        // Clean up on error
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
        console.log('Fetching playlist...');
        
        // Validate playlist
        if (!ytpl.validateID) {
            // If validateID doesn't exist, try to get playlist directly
            try {
                const playlist = await ytpl(playlistUrl, { limit: 5 });
                
                for (let i = 0; i < playlist.items.length; i++) {
                    const item = playlist.items[i];
                    
                    try {
                        console.log(`Downloading ${i + 1}/${playlist.items.length}: ${item.title}`);
                        
                        const videoUrl = item.url || `https://youtube.com/watch?v=${item.id}`;
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
            } catch (e) {
                throw new Error('Invalid playlist URL');
            }
        } else {
            // Use validateID if available
            if (!await ytpl.validateID(playlistUrl)) {
                throw new Error('Invalid playlist URL');
            }

            const playlist = await ytpl(playlistUrl, { 
                limit: 5,
                pages: 1
            });

            for (let i = 0; i < playlist.items.length; i++) {
                const item = playlist.items[i];
                
                try {
                    console.log(`Downloading ${i + 1}/${playlist.items.length}: ${item.title}`);
                    
                    const videoUrl = item.url || `https://youtube.com/watch?v=${item.id}`;
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
        }
    } catch (error) {
        console.error('Playlist error:', error);
        throw error;
    }
}

module.exports = {
    downloadVideo,
    downloadPlaylist
};
