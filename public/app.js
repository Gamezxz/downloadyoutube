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

// Current video URL
let currentVideoUrl = '';

// ========================================
// Event Listeners
// ========================================

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
        showError(error.message || 'ไม่สามารถโหลดข้อมูลวิดีโอได้ กรุณาลองใหม่');
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
    progressStatusText.textContent = 'กำลังเตรียมการ...';
    phaseDownload.classList.remove('active', 'completed');
    phaseConvert.classList.remove('active', 'completed');
    phaseComplete.classList.remove('active', 'completed');

    // Create SSE connection
    const eventSource = new EventSource(`/api/download-progress?url=${encodeURIComponent(currentVideoUrl)}`);

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
        progressStatusText.textContent = 'ดาวน์โหลดสำเร็จ! กำลังบันทึกไฟล์...';

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

    showResult();
}

function resetToInput() {
    hideResult();
    hideError();
    urlInput.value = '';
    urlInput.focus();
    currentVideoUrl = '';
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
