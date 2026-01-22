// ========================================
// YouTube MP3 Downloader - Frontend App
// ========================================

// DOM Elements
const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const convertBtn = document.getElementById('convertBtn');
const loadingSection = document.getElementById('loadingSection');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const retryBtn = document.getElementById('retryBtn');
const resultSection = document.getElementById('resultSection');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const videoAuthor = document.getElementById('videoAuthor');
const duration = document.getElementById('duration');
const viewCount = document.getElementById('viewCount');
const downloadBtn = document.getElementById('downloadBtn');
const newDownloadBtn = document.getElementById('newDownloadBtn');

// Current video URL and format
let currentVideoUrl = '';
let selectedFormat = 'mp3';
let selectedQuality = '1080';

// ========================================
// Event Listeners
// ========================================

// Format selection using event delegation for better reliability
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn) return;

    // Update selection
    selectedFormat = btn.dataset.format;

    // Update UI
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show/Hide quality selection logic will be handled in displayResult after info is fetched
    if (selectedFormat === 'mp4') {
        // If we already have video info, show it, otherwise keep hidden until fetch
        if (currentVideoUrl) {
            document.getElementById('qualitySelection').classList.remove('hidden');
        }
    } else {
        document.getElementById('qualitySelection').classList.add('hidden');
    }

    // Update convert button text
    const btnText = convertBtn.querySelector('.btn-text');
    if (btnText) {
        btnText.textContent = `Convert to ${selectedFormat.toUpperCase()}`;
    }

    // Also update download button text if it's visible
    const downloadText = downloadBtn.querySelector('.download-text');
    if (downloadText) {
        const qualityText = selectedFormat === 'mp3' ? '320kbps' : (selectedQuality === 'best' ? 'Best Quality' : `${selectedQuality}p`);
        downloadText.textContent = `Download ${selectedFormat.toUpperCase()} (${qualityText})`;
    }
});

// Quality selection
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.quality-btn');
    if (!btn) return;

    // Update selection
    selectedQuality = btn.dataset.quality;

    // Update UI
    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update download button text if it's visible
    const downloadText = downloadBtn.querySelector('.download-text');
    if (downloadText) {
        const qualityText = selectedQuality === 'best' ? 'Best Quality' : `${selectedQuality}p`;
        downloadText.textContent = `Download MP4 (${qualityText})`;
    }
});

// Paste button click
pasteBtn.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        urlInput.focus();

        // Add animation feedback
        pasteBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            pasteBtn.style.transform = '';
        }, 150);
    } catch (err) {
        console.error('Failed to read clipboard:', err);
        showError('ไม่สามารถวางข้อความได้ กรุณาวางด้วยตนเอง (Ctrl+V)');
    }
});

// Convert button click
convertBtn.addEventListener('click', handleConvert);

// Enter key on input
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleConvert();
    }
});

// Retry button click
retryBtn.addEventListener('click', () => {
    hideError();
    handleConvert();
});

// Download button click
downloadBtn.addEventListener('click', handleDownload);

// New download button click
newDownloadBtn.addEventListener('click', resetToInput);

// ========================================
// Main Functions
// ========================================

async function handleConvert() {
    const url = urlInput.value.trim();

    if (!url) {
        showError('กรุณาวาง URL ของวิดีโอ YouTube');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showError('URL ไม่ถูกต้อง กรุณาใส่ลิงก์ YouTube ที่ถูกต้อง');
        return;
    }

    currentVideoUrl = url;
    showLoading();

    try {
        const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'เกิดข้อผิดพลาด');
        }

        displayResult(data);
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'Failed to load video information. Please try again.');
    }
}

function handleDownload() {
    if (!currentVideoUrl) return;

    // Get progress elements
    const downloadProgress = document.getElementById('downloadProgress');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressStatusText = document.getElementById('progressStatusText');
    const phaseDownload = document.getElementById('phaseDownload');
    const phaseConvert = document.getElementById('phaseConvert');
    const phaseComplete = document.getElementById('phaseComplete');

    // Hide download button and show progress
    downloadBtn.classList.add('hidden');
    downloadProgress.classList.remove('hidden');
    downloadProgress.classList.remove('complete', 'error');

    // Reset progress UI
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatusText.textContent = 'Preparing...';
    phaseDownload.classList.remove('active', 'completed');
    phaseConvert.classList.remove('active', 'completed');
    phaseComplete.classList.remove('active', 'completed');

    // Create SSE connection
    const eventSource = new EventSource(`/api/download-progress?url=${encodeURIComponent(currentVideoUrl)}&format=${selectedFormat}&quality=${selectedQuality}`);

    eventSource.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        progressStatusText.textContent = data.message;

        if (data.phase === 'download') {
            phaseDownload.classList.add('active');
        }
    });

    eventSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        progressBar.style.width = `${data.percent}%`;
        progressPercent.textContent = `${data.percent}%`;
        progressStatusText.textContent = data.message;

        // Update phases
        if (data.phase === 'download') {
            phaseDownload.classList.add('active');
            phaseDownload.classList.remove('completed');
        } else if (data.phase === 'convert') {
            phaseDownload.classList.remove('active');
            phaseDownload.classList.add('completed');
            phaseConvert.classList.add('active');
        } else if (data.phase === 'complete') {
            phaseDownload.classList.add('completed');
            phaseConvert.classList.add('completed');
            phaseComplete.classList.add('active', 'completed');
            downloadProgress.classList.add('complete');
        }
    });

    eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        eventSource.close();

        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressStatusText.textContent = 'Download complete! Saving file...';

        // Trigger file download
        const link = document.createElement('a');
        link.href = `/api/download-file/${data.sessionId}`;
        link.download = data.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Reset UI after delay
        setTimeout(() => {
            downloadProgress.classList.add('hidden');
            downloadBtn.classList.remove('hidden');
        }, 2000);
    });

    eventSource.addEventListener('error', (e) => {
        let errorMessage = 'เกิดข้อผิดพลาด';
        try {
            const data = JSON.parse(e.data);
            errorMessage = data.message || errorMessage;
        } catch (err) { }

        eventSource.close();
        progressStatusText.textContent = errorMessage;
        downloadProgress.classList.add('error');

        // Reset UI after delay
        setTimeout(() => {
            downloadProgress.classList.add('hidden');
            downloadBtn.classList.remove('hidden');
        }, 3000);
    });

    eventSource.onerror = () => {
        eventSource.close();
        progressStatusText.textContent = 'การเชื่อมต่อขัดข้อง';
        downloadProgress.classList.add('error');

        setTimeout(() => {
            downloadProgress.classList.add('hidden');
            downloadBtn.classList.remove('hidden');
        }, 3000);
    };
}

// ========================================
// UI State Functions
// ========================================

function showLoading() {
    hideError();
    hideResult();
    loadingSection.classList.remove('hidden');
    convertBtn.disabled = true;
}

function hideLoading() {
    loadingSection.classList.add('hidden');
    convertBtn.disabled = false;
}

function showError(message) {
    hideLoading();
    hideResult();
    errorText.textContent = message;
    errorSection.classList.remove('hidden');
}

function hideError() {
    errorSection.classList.add('hidden');
}

function showResult() {
    hideLoading();
    hideError();
    resultSection.classList.remove('hidden');
}

function hideResult() {
    resultSection.classList.add('hidden');
}

function displayResult(data) {
    thumbnail.src = data.thumbnail;
    videoTitle.textContent = data.title;
    videoAuthor.textContent = data.author;
    duration.textContent = data.duration;
    viewCount.textContent = data.viewCount;

    // Handle quality selection visibility and availability
    const qualitySelection = document.getElementById('qualitySelection');
    if (selectedFormat === 'mp4') {
        const qualities = data.availableQualities || [];
        const btn720 = document.querySelector('[data-quality="720"]');
        const btn1080 = document.querySelector('[data-quality="1080"]');
        const btnBest = document.querySelector('[data-quality="best"]');

        const has720 = qualities.some(q => q >= 720);
        const has1080 = qualities.some(q => q >= 1080);
        const hasHigher = qualities.some(q => q > 1080);

        // Update quality button visibility
        if (btn720) {
            btn720.classList.toggle('hidden', !has720 && (has1080 || hasHigher));
            if (!has720 && !has1080 && !hasHigher) {
                btn720.classList.remove('hidden');
                btn720.textContent = 'Standard Quality';
            } else {
                btn720.textContent = '720p';
            }
        }
        if (btn1080) btn1080.classList.toggle('hidden', !has1080);
        if (btnBest) btnBest.classList.toggle('hidden', !hasHigher);

        // Auto-select best available if current is not available
        if (selectedQuality === 'best' && !hasHigher) {
            selectedQuality = has1080 ? '1080' : (has720 ? '720' : 'best');
        } else if (selectedQuality === '1080' && !has1080) {
            selectedQuality = has720 ? '720' : 'best';
        }

        // Update active states
        document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.quality === selectedQuality);
        });

        qualitySelection.classList.remove('hidden');
    } else {
        qualitySelection.classList.add('hidden');
    }

    // Update download button text
    const downloadText = downloadBtn.querySelector('.download-text');
    if (downloadText) {
        let qualityText = '';
        if (selectedFormat === 'mp3') {
            qualityText = '320kbps';
        } else {
            if (selectedQuality === 'best') qualityText = '4K/8K Quality';
            else qualityText = `${selectedQuality}p`;
        }
        downloadText.textContent = `Download ${selectedFormat.toUpperCase()} (${qualityText})`;
    }

    showResult();
}

function resetToInput() {
    hideResult();
    hideError();
    urlInput.value = '';
    urlInput.focus();
    currentVideoUrl = '';

    // Reset convert button text to default
    const btnText = convertBtn.querySelector('.btn-text');
    if (btnText) {
        btnText.textContent = 'Convert to MP3';
    }

    // Reset format selection to MP3
    selectedFormat = 'mp3';
    selectedQuality = '1080';
    document.getElementById('qualitySelection').classList.add('hidden');
    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.format === 'mp3');
    });
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === '1080');
    });
}

// ========================================
// Utility Functions
// ========================================

function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtube\.com\/embed\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtube\.com\/v\/)[\w-]+/,
        /^(https?:\/\/)?(m\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(music\.)?(youtube\.com\/watch\?v=)[\w-]+/,
        /^(https?:\/\/)?(www\.)?(youtube\.com\/shorts\/)[\w-]+/
    ];

    return patterns.some(pattern => pattern.test(url));
}

// ========================================
// Auto-focus on load
// ========================================

window.addEventListener('DOMContentLoaded', () => {
    urlInput.focus();
});

// ========================================
// Handle paste event on input
// ========================================

urlInput.addEventListener('paste', (e) => {
    // Auto-convert after paste with small delay
    setTimeout(() => {
        if (urlInput.value && isValidYouTubeUrl(urlInput.value)) {
            handleConvert();
        }
    }, 100);
});

// ========================================
// Donation - QR Code Generation
// ========================================

const qrCodeContainer = document.getElementById('qrCode');
const walletAddress = '0x947Fc02E2CaF6B5a2633b40471949A09010173C0';

if (qrCodeContainer) {
    // Use QR Server API instead of library
    const qrImg = document.createElement('img');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(walletAddress)}`;
    qrImg.alt = 'Wallet QR Code';
    qrImg.width = 150;
    qrImg.height = 150;
    qrImg.style.display = 'block';
    qrImg.style.borderRadius = '8px';
    qrImg.onerror = function () {
        qrCodeContainer.innerHTML = '<p style="color: #888; font-size: 12px; padding: 20px;">QR Code ไม่พร้อมใช้งาน</p>';
    };
    qrCodeContainer.appendChild(qrImg);
}

// ========================================
// Donation - Copy Address
// ========================================

const copyAddressBtn = document.getElementById('copyAddressBtn');
const donationAddress = document.getElementById('donationAddress');
const copySuccess = document.getElementById('copySuccess');

if (copyAddressBtn && donationAddress) {
    copyAddressBtn.addEventListener('click', async () => {
        const address = donationAddress.textContent;

        try {
            await navigator.clipboard.writeText(address);

            // Show success message
            copySuccess.classList.remove('hidden');

            // Update button text
            const copyText = copyAddressBtn.querySelector('.copy-text');
            if (copyText) {
                copyText.textContent = 'Copied!';
            }

            // Add animation feedback
            copyAddressBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                copyAddressBtn.style.transform = '';
            }, 150);

            // Reset after 3 seconds
            setTimeout(() => {
                copySuccess.classList.add('hidden');
                if (copyText) {
                    copyText.textContent = 'Copy';
                }
            }, 3000);
        } catch (err) {
            console.error('Failed to copy address:', err);

            // Fallback: select the text
            const range = document.createRange();
            range.selectNodeContents(donationAddress);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    });
}

// ========================================
// Register Service Worker for PWA
// ========================================

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}
