let meetingCode = null;
let pc = null;
let stream = null;
let timerInterval = null;
let startTime = null;

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

async function endMeeting() {
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

  const badge = document.getElementById('statusBadge');
  badge.className = 'bg-slate-500 text-white text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2';
  badge.innerHTML = '<span class="size-2 rounded-full bg-white"></span> 已結束';
}

function copyLink() {
  const link = document.getElementById('shareLink').value;
  navigator.clipboard.writeText(link);
}
