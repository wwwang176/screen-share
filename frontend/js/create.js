let meetingCode = null;
let pc = null;
let stream = null;
let timerInterval = null;
let startTime = null;
let ws = null;

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
    meetingCode = meeting.meetingCode;

    // Switch to live state
    document.getElementById('setup').classList.add('hidden');
    const meetingEl = document.getElementById('meeting');
    meetingEl.classList.remove('hidden');
    meetingEl.classList.add('flex');

    document.getElementById('meetingTitle').textContent = meeting.title;
    document.getElementById('sidebarTitle').textContent = meeting.title;

    // Capture screen
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    document.getElementById('preview').srcObject = stream;

    stream.getVideoTracks()[0].addEventListener('ended', () => {
      endMeeting();
    });

    // WHIP push
    await pushToWHIP(meeting.whipUrl, stream);

    // Show share link
    const link = window.location.origin + '/join?code=' + meetingCode;
    document.getElementById('shareLink').value = link;
    document.getElementById('linkBox').classList.remove('hidden');

    // Update status badge to Live
    const badge = document.getElementById('statusBadge');
    badge.className = 'bg-red-500 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-red-500/20';
    badge.innerHTML = '<span class="size-2 rounded-full bg-white live-pulse"></span> 直播中';

    startTimer();
    connectWebSocket();
  } catch (err) {
    console.error(err);
    showError(err.message || '無法開始會議');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span> 開始分享';
  }
}

async function pushToWHIP(whipUrl, mediaStream) {
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
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
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
  });
}

async function endMeeting() {
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
  }

  window.location.href = '/';
}

function copyLink() {
  const link = document.getElementById('shareLink').value;
  navigator.clipboard.writeText(link);
}
