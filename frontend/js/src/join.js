import { WebRTCPlayer } from '@eyevinn/webrtc-player';

let player = null;
let whepUrl = null;
let meetingData = null;
let retryCount = 0;
const MAX_RETRIES = 3;

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// Expose joinStream to global scope for the button onclick
window.joinStream = async function () {
  if (!whepUrl) return;

  const btn = document.getElementById('joinBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 連線中...';

  try {
    // Switch to viewer
    document.getElementById('lobby').classList.add('hidden');
    const viewer = document.getElementById('viewer');
    viewer.classList.remove('hidden');
    viewer.classList.add('block');
    document.body.classList.add('overflow-hidden');

    document.getElementById('viewerTitle').textContent = meetingData.title;

    await connectWHEP(whepUrl);

    // Show unmute mask
    document.getElementById('unmuteMask').style.display = 'flex';
  } catch (err) {
    console.error('[ERROR]', err);
    // Go back to lobby on failure
    document.getElementById('viewer').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    document.body.classList.remove('overflow-hidden');
    showError(err.message || '連線失敗');
    btn.disabled = false;
    btn.innerHTML = '加入會議 <span class="material-symbols-outlined">arrow_forward</span>';
  }
};

function startStatsLogging(pc) {
  setInterval(async () => {
    if (pc.connectionState !== 'connected') return;
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          console.log('[STATS] Video:', {
            fps: report.framesPerSecond,
            bytesReceived: report.bytesReceived,
            packetsLost: report.packetsLost,
            jitter: report.jitter,
          });
        }
        if (report.type === 'candidate-pair' && report.nominated) {
          console.log('[STATS] RTT:', report.currentRoundTripTime, 'protocol:', report.protocol);
        }
      });
    } catch (e) { /* ignore */ }
  }, 2000);
}

function monitorPeerConnection(pc) {
  pc.addEventListener('connectionstatechange', () => {
    console.log('[PEER] State:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      startStatsLogging(pc);
    }
    if (pc.connectionState === 'failed') {
      console.error('[PEER] Connection failed, retrying...');
      retryConnect();
    }
  });
  pc.addEventListener('track', (e) => {
    console.log('[TRACK] Received:', e.track.kind, 'readyState:', e.track.readyState);
  });
}

async function connectWHEP(url) {
  const video = document.getElementById('stream');

  if (player) {
    try { player.unload(); } catch (e) { /* ignore */ }
    player = null;
  }

  player = new WebRTCPlayer({
    video: video,
    type: 'whep',
    statsTypeFilter: '^candidate-*|^inbound-rtp',
  });

  player.on('peer-connection-state-change', (state) => {
    console.log('[PLAYER] Connection state:', state);
  });

  player.on('no-media', () => {
    console.warn('[PLAYER] No media received');
  });

  player.on('media-recovered', () => {
    console.log('[PLAYER] Media recovered');
  });

  console.log('[DEBUG] Loading WHEP:', url);
  await player.load(new URL(url));
  console.log('[DEBUG] WHEP loaded');

  const pc = player.peer;
  if (pc) {
    monitorPeerConnection(pc);
  }

  video.play().then(() => {
    console.log('[VIDEO] Playing');
  }).catch((err) => {
    console.warn('[VIDEO] Autoplay blocked:', err.message);
    document.getElementById('unmuteMask').style.display = 'flex';
  });
}

async function retryConnect() {
  if (!whepUrl || retryCount >= MAX_RETRIES) {
    if (retryCount >= MAX_RETRIES) {
      showError('多次嘗試後仍無法連線');
    }
    return;
  }
  retryCount++;
  console.log(`[RETRY] Attempt ${retryCount}/${MAX_RETRIES} in 2s...`);
  await new Promise((r) => setTimeout(r, 2000));
  try {
    await connectWHEP(whepUrl);
  } catch (err) {
    console.error('[RETRY] Failed:', err);
    retryConnect();
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');

  if (!code) {
    showError('未提供會議代碼');
    return;
  }

  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(code)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('找不到會議');
      throw new Error('載入會議失敗');
    }

    meetingData = await res.json();
    console.log('[DEBUG] Meeting:', meetingData);

    document.getElementById('lobbyTitle').textContent = meetingData.title;

    if (meetingData.status === 'ended') {
      document.getElementById('lobbyBadge').innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-400"></span> 已結束';
      document.getElementById('lobbyBadge').className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wider mb-4';
      document.getElementById('lobbySubtitle').textContent = '此會議已結束。';
      return;
    }

    // Meeting is active
    whepUrl = meetingData.whepUrl;
    document.getElementById('lobbyBadge').innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> 直播中';
    document.getElementById('lobbyBadge').className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold uppercase tracking-wider mb-4';
    document.getElementById('lobbySubtitle').textContent = '主持人正在分享螢幕。';
    document.getElementById('joinBtn').disabled = false;
  } catch (err) {
    console.error('[ERROR]', err);
    document.getElementById('lobbyTitle').textContent = '錯誤';
    showError(err.message || '載入會議失敗');
  }
}

init();
