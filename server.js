const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = 13001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========================================
// Configuration
// ========================================

// Path to ffmpeg from node_modules
const FFMPEG_PATH = require('ffmpeg-static');

// Downloads directory
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
}

// Store for tracking downloads
const downloadSessions = new Map();

// ========================================
// Helper Functions
// ========================================

function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtube\.com\/embed\/)[\w-]+/,
        /^(https?:\/\/)?(m\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(music\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtube\.com\/shorts\/)[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        const process = spawn('yt-dlp', args, { shell: true });
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
            }
        });

        process.on('error', (err) => {
            reject(err);
        });
    });
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// ========================================
// API Routes
// ========================================

// Get video info using yt-dlp
app.get('/api/info', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        console.log(`📋 Getting info for: ${url}`);

        // Get video info as JSON from yt-dlp
        const output = await runYtDlp([
            '--dump-json',
            '--no-download',
            url
        ]);

        const info = JSON.parse(output);

        // Extract available heights
        const heights = new Set();
        if (info.formats) {
            info.formats.forEach(f => {
                if (f.vcodec !== 'none' && f.height) {
                    heights.add(f.height);
                }
            });
        }
        const availableQualities = Array.from(heights).sort((a, b) => b - a);

        res.json({
            title: info.title,
            author: info.uploader || info.channel,
            thumbnail: info.thumbnail,
            duration: formatDuration(info.duration),
            viewCount: info.view_count ? info.view_count.toLocaleString() : '0',
            availableQualities: availableQualities,
            maxHeight: info.height
        });

    } catch (error) {
        console.error('Error getting video info:', error.message);
        res.status(500).json({
            error: 'Failed to get video information. Please check the URL and try again.'
        });
    }
});

// Download as MP3 using yt-dlp
app.get('/api/download', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // First get video info
        const infoOutput = await runYtDlp([
            '--dump-json',
            '--no-download',
            url
        ]);

        const info = JSON.parse(infoOutput);
        const safeTitle = info.title.replace(/[<>:"/\\|?*]/g, '').trim();
        const fileName = `${safeTitle}.mp3`;
        const outputPath = path.join(DOWNLOADS_DIR, fileName);

        console.log(`📥 Downloading: ${info.title}`);

        // Download and convert to MP3
        await runYtDlp([
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '320K',
            '--ffmpeg-location', `"${FFMPEG_PATH}"`,
            '-o', `"${outputPath.replace('.mp3', '.%(ext)s')}"`,
            url
        ]);

        console.log(`✅ Download complete: ${fileName}`);

        // Check if file exists
        if (!fs.existsSync(outputPath)) {
            throw new Error('File was not created');
        }

        // Send file for download
        res.download(outputPath, fileName, (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            // Optionally delete the file after download
            // fs.unlinkSync(outputPath);
        });

    } catch (error) {
        console.error('Error downloading video:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Failed to download video. Please try again.'
            });
        }
    }
});

// Download with progress tracking (SSE)
app.get('/api/download-progress', async (req, res) => {
    const { url, format = 'mp3', quality = '1080' } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidYouTubeUrl(url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        // Send initial status
        sendEvent('status', { message: 'กำลังดึงข้อมูลวิดีโอ...', phase: 'info' });

        // Get video info
        const infoOutput = await runYtDlp([
            '--dump-json',
            '--no-download',
            url
        ]);

        const info = JSON.parse(infoOutput);
        const safeTitle = info.title.replace(/[<>:"/\\|?*]/g, '').trim();
        const sessionId = crypto.randomBytes(16).toString('hex');

        const isMp4 = format === 'mp4';
        const ext = isMp4 ? 'mp4' : 'mp3';
        const fileName = `${safeTitle}.${ext}`;
        const outputPath = path.join(DOWNLOADS_DIR, `${sessionId}.${ext}`);

        sendEvent('info', {
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration
        });

        const downloadMsg = isMp4 ? 'กำลังดาวน์โหลดวิดีโอ...' : 'กำลังดาวน์โหลดเสียง...';
        sendEvent('status', { message: downloadMsg, phase: 'download', progress: 0 });

        // Configure yt-dlp arguments based on format
        let ytdlpArgs = [];
        if (isMp4) {
            let formatSelection = '';
            if (quality === 'best') {
                formatSelection = 'bestvideo+bestaudio/best';
            } else if (quality === '1080') {
                formatSelection = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
            } else if (quality === '720') {
                formatSelection = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
            } else {
                formatSelection = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
            }

            ytdlpArgs = [
                '-f', formatSelection,
                '--merge-output-format', 'mp4',
                '--ffmpeg-location', `"${FFMPEG_PATH}"`,
                '--newline',
                '--progress',
                '-o', `"${outputPath}"`,
                url
            ];
        } else {
            ytdlpArgs = [
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '320K',
                '--ffmpeg-location', `"${FFMPEG_PATH}"`,
                '--newline',
                '--progress',
                '-o', `"${outputPath.replace('.mp3', '.%(ext)s')}"`,
                url
            ];
        }

        // Download with progress tracking
        const ytdlp = spawn('yt-dlp', ytdlpArgs, { shell: true });

        let lastProgress = 0;

        ytdlp.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('yt-dlp:', output);

            // Parse download progress
            const downloadMatch = output.match(/(\d+\.?\d*)%/);
            if (downloadMatch) {
                const progress = parseFloat(downloadMatch[1]);
                if (progress > lastProgress) {
                    lastProgress = progress;
                    // Scale download to 0-80% for MP4 (merging takes more time) or 0-70% for MP3
                    const maxScale = isMp4 ? 80 : 70;
                    const scaledProgress = Math.min(progress * (maxScale / 100), maxScale);
                    sendEvent('progress', {
                        percent: Math.round(scaledProgress),
                        phase: 'download',
                        message: `กำลังดาวน์โหลด ${Math.round(progress)}%`
                    });
                }
            }

            // Detect conversion/merging phase
            if (output.includes('[ExtractAudio]') || output.includes('Converting') || output.includes('Destination:') || output.includes('[VideoConvertor]') || output.includes('[Merger]')) {
                const statusMsg = isMp4 ? 'กำลังรวมไฟล์วิดีโอและเสียง...' : 'กำลังแปลงไฟล์เป็น MP3...';
                const percent = isMp4 ? 85 : 75;
                sendEvent('progress', {
                    percent: percent,
                    phase: 'convert',
                    message: statusMsg
                });
            }
        });

        ytdlp.stderr.on('data', (data) => {
            const output = data.toString();
            console.log('yt-dlp stderr:', output);

            // Also check stderr for progress
            const downloadMatch = output.match(/(\d+\.?\d*)%/);
            if (downloadMatch) {
                const progress = parseFloat(downloadMatch[1]);
                if (progress > lastProgress) {
                    lastProgress = progress;
                    const maxScale = isMp4 ? 80 : 70;
                    const scaledProgress = Math.min(progress * (maxScale / 100), maxScale);
                    sendEvent('progress', {
                        percent: Math.round(scaledProgress),
                        phase: 'download',
                        message: `กำลังดาวน์โหลด ${Math.round(progress)}%`
                    });
                }
            }
        });

        ytdlp.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                // Store session info
                downloadSessions.set(sessionId, {
                    filePath: outputPath,
                    fileName: fileName,
                    createdAt: Date.now()
                });

                // Clean up old sessions (older than 10 minutes)
                const now = Date.now();
                for (const [id, session] of downloadSessions) {
                    if (now - session.createdAt > 10 * 60 * 1000) {
                        try {
                            if (fs.existsSync(session.filePath)) {
                                fs.unlinkSync(session.filePath);
                            }
                        } catch (e) { }
                        downloadSessions.delete(id);
                    }
                }

                sendEvent('progress', { percent: 100, phase: 'complete', message: 'เสร็จสิ้น!' });
                sendEvent('complete', {
                    sessionId: sessionId,
                    fileName: fileName
                });
                console.log(`✅ Download complete: ${fileName} (Session: ${sessionId})`);
            } else {
                sendEvent('error', { message: 'การดาวน์โหลดล้มเหลว กรุณาลองใหม่' });
            }
            res.end();
        });

        ytdlp.on('error', (err) => {
            console.error('yt-dlp error:', err);
            sendEvent('error', { message: 'เกิดข้อผิดพลาดในการดาวน์โหลด' });
            res.end();
        });

        // Handle client disconnect
        req.on('close', () => {
            ytdlp.kill();
        });

    } catch (error) {
        console.error('Error:', error.message);
        sendEvent('error', { message: 'เกิดข้อผิดพลาด: ' + error.message });
        res.end();
    }
});

// Download completed file
app.get('/api/download-file/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = downloadSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
    }

    if (!fs.existsSync(session.filePath)) {
        downloadSessions.delete(sessionId);
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(session.filePath, session.fileName, (err) => {
        if (err) {
            console.error('Error sending file:', err);
        }
        // Delete file after download
        try {
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
            downloadSessions.delete(sessionId);
        } catch (e) { }
    });
});

// Stream download (no file save)
app.get('/api/stream', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Get video info first
        const infoOutput = await runYtDlp([
            '--dump-json',
            '--no-download',
            url
        ]);

        const info = JSON.parse(infoOutput);
        const safeTitle = info.title.replace(/[<>:"/\\|?*]/g, '').trim();
        const fileName = `${safeTitle}.mp3`;

        console.log(`🎵 Streaming: ${info.title}`);

        res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.header('Content-Type', 'audio/mpeg');

        // Use yt-dlp to output to stdout and pipe through ffmpeg
        const ytdlp = spawn('yt-dlp', [
            '-f', 'bestaudio',
            '-o', '-',
            url
        ], { shell: true });

        const ffmpeg = spawn(FFMPEG_PATH, [
            '-i', 'pipe:0',
            '-f', 'mp3',
            '-ab', '320k',
            '-vn',
            'pipe:1'
        ], { shell: true });

        ytdlp.stdout.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);

        ytdlp.stderr.on('data', (data) => {
            console.log(`yt-dlp: ${data}`);
        });

        ffmpeg.stderr.on('data', (data) => {
            // FFmpeg outputs progress to stderr
        });

        ffmpeg.on('close', (code) => {
            console.log(`✅ Stream complete`);
        });

        req.on('close', () => {
            ytdlp.kill();
            ffmpeg.kill();
        });

    } catch (error) {
        console.error('Error streaming:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream video.' });
        }
    }
});

// Health check
app.get('/api/status', async (req, res) => {
    try {
        const version = await runYtDlp(['--version']);
        res.json({
            status: 'ok',
            ytdlpVersion: version,
            ffmpegAvailable: fs.existsSync(FFMPEG_PATH)
        });
    } catch (error) {
        res.json({
            status: 'error',
            error: error.message,
            ffmpegAvailable: fs.existsSync(FFMPEG_PATH)
        });
    }
});

// ========================================
// Start Server
// ========================================

app.listen(PORT, () => {
    console.log(`\n🎵 YouTube MP3 Downloader running at http://localhost:${PORT}`);
    console.log(`\n📦 Using yt-dlp for reliable YouTube downloads`);
    console.log(`🔧 FFmpeg path: ${FFMPEG_PATH}`);
    console.log(`📁 Downloads folder: ${DOWNLOADS_DIR}\n`);
});
