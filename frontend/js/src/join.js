import { WebRTCPlayer } from '@eyevinn/webrtc-player';

let player = null;
let whepUrl = null;
let meetingData = null;
let retryCount = 0;
let ws = null;
let whepReady = false;
let wsRetryDelay = 1000;
let wsIntentionalClose = false;
let viewerName = '匿名';
const MAX_RETRIES = 3;

function showToast(icon, text) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-center gap-3 bg-white/95 backdrop-blur-md border border-slate-200 shadow-lg rounded-xl px-4 py-3 text-sm text-slate-700 transform translate-x-full transition-transform duration-300';
  toast.innerHTML = `<span class="material-symbols-outlined text-[18px] text-primary">${icon}</span><span>${text}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });
  setTimeout(() => {
    toast.style.transform = 'translateX(calc(100% + 1rem))';
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3000);
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// Expose joinStream to global scope for the button onclick
window.joinStream = function () {
  if (!whepUrl) return;

  const video = document.getElementById('stream');

  // Switch to viewer
  document.getElementById('lobby').classList.add('hidden');
  const viewer = document.getElementById('viewer');
  viewer.classList.remove('hidden');
  viewer.classList.add('block');
  document.body.classList.add('overflow-hidden');

  document.getElementById('viewerTitle').textContent = meetingData.title;

  // Move video element into viewer container (append so it layers above placeholders)
  const container = document.getElementById('viewerVideoContainer');
  video.className = 'absolute inset-0 w-full h-full object-contain';
  container.appendChild(video);

  // Show unmute mask if audio track exists
  if (video.srcObject && video.srcObject.getAudioTracks().length > 0) {
    document.getElementById('unmuteMask').style.display = 'flex';
  }

  connectWebSocket();
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
    if (state === 'connected') {
      // Hide placeholder once video is streaming
      const placeholder = document.getElementById('previewPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      const connecting = document.getElementById('connectingPlaceholder');
      if (connecting) connecting.style.display = 'none';
      whepReady = true;
    }
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

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  // Capture name on first call
  const nameInput = document.getElementById('viewerName');
  if (nameInput) {
    viewerName = (nameInput.value || '').trim().slice(0, 20) || '匿名';
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    wsRetryDelay = 1000;
    ws.send(JSON.stringify({ type: 'join', meetingCode: meetingData.meetingCode, role: 'viewer', name: viewerName }));
    console.log('[WS] Viewer connected');
  });

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'meeting_ended') {
      wsIntentionalClose = true;
      document.getElementById('endedMessage').textContent = '會議已結束';
      document.getElementById('endedMask').style.display = 'flex';
    }
    if (msg.type === 'host_disconnected' && !wsIntentionalClose) {
      document.getElementById('endedMessage').textContent = '主持人已斷線，等待重新連線...';
      document.getElementById('endedMask').style.display = 'flex';
    }
    if (msg.type === 'stream_paused') {
      document.getElementById('pausedMask').style.display = 'flex';
      showToast('pause_circle', '主持人已暫停分享');
    }
    if (msg.type === 'stream_resumed') {
      document.getElementById('pausedMask').style.display = 'none';
      showToast('play_circle', '主持人已恢復分享');
    }
    if (msg.type === 'host_reconnected') {
      document.getElementById('endedMask').style.display = 'none';
      document.getElementById('pausedMask').style.display = 'none';
      showToast('wifi', '主持人已重新連線');
      // Reconnect WHEP to pick up new stream
      if (whepUrl) {
        retryCount = 0;
        connectWHEP(whepUrl).catch((err) => {
          console.warn('[WHEP] Reconnect failed:', err.message);
        });
      }
    }
    if (msg.type === 'viewer_joined' || msg.type === 'viewer_left' || msg.type === 'viewer_count') {
      if (msg.viewers && typeof renderViewerListPanel === 'function') {
        renderViewerListPanel(msg.viewers);
      }
    }
    if (msg.type === 'viewer_joined') {
      showToast('person_add', `${msg.name || '匿名'} 加入了會議（目前 ${msg.count} 人）`);
    }
    if (msg.type === 'viewer_left') {
      showToast('person_remove', `${msg.name || '匿名'} 離開了會議（目前 ${msg.count} 人）`);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] Disconnected');
    ws = null;
    if (!wsIntentionalClose && meetingData) {
      console.log(`[WS] Reconnecting in ${wsRetryDelay / 1000}s...`);
      setTimeout(connectWebSocket, wsRetryDelay);
      wsRetryDelay = Math.min(wsRetryDelay * 2, 30000);
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && meetingData && !wsIntentionalClose) {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      console.log('[WS] Page visible, reconnecting...');
      wsRetryDelay = 1000;
      connectWebSocket();
    }
  }
});

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
    document.getElementById('previewText').textContent = '正在連線預覽...';

    // Start WHEP early for preview
    try {
      await connectWHEP(whepUrl);
    } catch (err) {
      console.warn('[PREVIEW] Failed to load preview:', err.message);
      // Not critical — user can still join
    }
  } catch (err) {
    console.error('[ERROR]', err);
    document.getElementById('lobbyTitle').textContent = '錯誤';
    showError(err.message || '載入會議失敗');
  }
}

init();
