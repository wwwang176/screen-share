let meetingCode = null;
let hostToken = null;
let pc = null;
let stream = null;
let timerInterval = null;
let startTime = null;
let ws = null;
let wsRetryDelay = 1000;
let wsIntentionalClose = false;
let paused = false;

function showToast(icon, text) {
  const container = document.getElementById('toastContainer');
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

function renderViewerList(viewers) {
  const container = document.getElementById('viewerList');
  if (!viewers || viewers.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-sm">尚無觀眾加入</p>';
    return;
  }
  container.innerHTML = viewers.map(name =>
    `<div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
      <div class="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary">
        <span class="material-symbols-outlined text-[16px]">person</span>
      </div>
      <span class="text-sm font-medium text-slate-700 truncate">${name}</span>
    </div>`
  ).join('');
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = formatTime(Date.now() - startTime);
    document.getElementById('timer').textContent = elapsed;
    document.getElementById('sidebarTimer').textContent = elapsed;
  }, 1000);
}

function showCaptureError() {
  document.getElementById('captureErrorMask').style.display = 'flex';
}

function hideCaptureError() {
  document.getElementById('captureErrorMask').style.display = 'none';
}

async function captureAndPush(meeting) {
  hideCaptureError();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    console.warn('[CAPTURE] User denied or failed:', err.message);
    showCaptureError();
    // Wait for user to click retry (retryCapture sets a resolve callback)
    await new Promise((resolve) => { window._captureRetryResolve = resolve; });
    return captureAndPush(meeting);
  }

  document.getElementById('preview').srcObject = stream;

  stream.getVideoTracks()[0].addEventListener('ended', () => {
    endMeeting();
  });

  await pushToWHIP(meeting.whipUrl, stream);
}

function retryCapture() {
  hideCaptureError();
  if (window._captureRetryResolve) {
    window._captureRetryResolve();
    window._captureRetryResolve = null;
  }
}

// Switch UI to live state and start capture + push
async function enterLiveState(meeting) {
  meetingCode = meeting.meetingCode;

  // Update URL immediately so host can rejoin if tab is closed
  history.replaceState(null, '', '/create?code=' + meetingCode);

  document.getElementById('setup').classList.add('hidden');
  const meetingEl = document.getElementById('meeting');
  meetingEl.classList.remove('hidden');
  meetingEl.classList.add('flex');

  document.getElementById('meetingTitle').textContent = meeting.title;
  document.getElementById('sidebarTitle').textContent = meeting.title;

  // Show share link immediately after room is created
  const link = window.location.origin + '/join?code=' + meetingCode;
  document.getElementById('shareLink').value = link;
  document.getElementById('linkBox').classList.remove('hidden');

  // Capture screen
  await captureAndPush(meeting);

  // Update status badge to Live
  const badge = document.getElementById('statusBadge');
  badge.className = 'bg-red-500 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-red-500/20';
  badge.innerHTML = '<span class="size-2 rounded-full bg-white live-pulse"></span> 直播中';

  startTimer();
  connectWebSocket();
}

async function startMeeting() {
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 建立中...';

  try {
    const title = document.getElementById('title').value || '未命名會議';
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) throw new Error('Failed to create meeting');
    const meeting = await res.json();

    // Store host token in localStorage
    hostToken = meeting.hostToken;
    localStorage.setItem('hostToken_' + meeting.meetingCode, hostToken);

    await enterLiveState(meeting);
  } catch (err) {
    console.error(err);
    showError(err.message || '無法開始會議');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span> 開始分享';
  }
}

async function rejoinMeeting(code) {
  const token = localStorage.getItem('hostToken_' + code);
  if (!token) {
    showError('找不到主持人憑證，請重新建立會議。');
    return;
  }

  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 重新連線中...';

  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(code)}/host?token=${encodeURIComponent(token)}`);

    if (res.status === 410) {
      showError('此會議已結束。');
      localStorage.removeItem('hostToken_' + code);
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span> 開始分享';
      return;
    }
    if (res.status === 403) {
      showError('主持人憑證無效。');
      localStorage.removeItem('hostToken_' + code);
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span> 開始分享';
      return;
    }
    if (!res.ok) throw new Error('無法重新加入會議');

    const meeting = await res.json();
    hostToken = token;

    await enterLiveState(meeting);
  } catch (err) {
    console.error(err);
    showError(err.message || '無法重新加入會議');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span> 開始分享';
    // Clear code from URL so user can create fresh
    history.replaceState(null, '', '/create');
  }
}

async function pushToWHIP(whipUrl, mediaStream) {
  if (pc) {
    pc.close();
    pc = null;
  }

  pc = new RTCPeerConnection();

  mediaStream.getTracks().forEach((track) => {
    pc.addTrack(track, mediaStream);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });

  const res = await fetch(whipUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WHIP error ${res.status}: ${body}`);
  }

  const answerSdp = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    wsRetryDelay = 1000;
    ws.send(JSON.stringify({ type: 'join', meetingCode, role: 'host' }));
    console.log('[WS] Host connected');
  });

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'viewer_joined' || msg.type === 'viewer_left' || msg.type === 'viewer_count') {
      document.getElementById('viewerCount').textContent = msg.count;
      if (msg.viewers) renderViewerList(msg.viewers);
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
    if (!wsIntentionalClose && meetingCode) {
      console.log(`[WS] Reconnecting in ${wsRetryDelay / 1000}s...`);
      setTimeout(connectWebSocket, wsRetryDelay);
      wsRetryDelay = Math.min(wsRetryDelay * 2, 30000);
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && meetingCode && !wsIntentionalClose) {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      console.log('[WS] Page visible, reconnecting...');
      wsRetryDelay = 1000;
      connectWebSocket();
    }
  }
});

async function endMeeting() {
  wsIntentionalClose = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'end_meeting' }));
    ws.close();
    ws = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (meetingCode) {
    await fetch(`/api/meetings/${meetingCode}/end`, { method: 'PATCH' }).catch(() => {});
    localStorage.removeItem('hostToken_' + meetingCode);
  }

  window.location.href = '/';
}

function togglePause() {
  if (!stream) return;
  paused = !paused;
  stream.getVideoTracks().forEach((t) => { t.enabled = !paused; });
  stream.getAudioTracks().forEach((t) => { t.enabled = !paused; });

  // Update button UI
  const icon = document.querySelector('#pauseBtn .material-symbols-outlined');
  const label = document.getElementById('pauseBtnLabel');
  if (paused) {
    icon.textContent = 'play_arrow';
    label.textContent = '恢復分享';
  } else {
    icon.textContent = 'pause';
    label.textContent = '暫停分享';
  }

  // Update status badge
  const badge = document.getElementById('statusBadge');
  if (paused) {
    badge.className = 'bg-yellow-500 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2 shadow-lg';
    badge.innerHTML = '<span class="material-symbols-outlined text-[14px]">pause</span> 已暫停';
  } else {
    badge.className = 'bg-red-500 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-red-500/20';
    badge.innerHTML = '<span class="size-2 rounded-full bg-white live-pulse"></span> 直播中';
  }

  // Notify viewers via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: paused ? 'pause_stream' : 'resume_stream' }));
  }
}

function copyLink() {
  const link = document.getElementById('shareLink').value;
  navigator.clipboard.writeText(link);
}

// Check for rejoin on page load
(function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    rejoinMeeting(code);
  }
})();
