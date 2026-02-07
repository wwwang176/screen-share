import { WebRTCPlayer } from '@eyevinn/webrtc-player';

let player = null;
let whepUrl = null;
let retryCount = 0;
const MAX_RETRIES = 3;

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

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
  console.log('[ICE] Initial state:', pc.iceConnectionState);
  console.log('[ICE] Gathering state:', pc.iceGatheringState);
  console.log('[PEER] Initial state:', pc.connectionState);
  console.log('[SIGNALING] State:', pc.signalingState);

  pc.addEventListener('iceconnectionstatechange', () => {
    console.log('[ICE] Connection state changed:', pc.iceConnectionState);
  });
  pc.addEventListener('icegatheringstatechange', () => {
    console.log('[ICE] Gathering state changed:', pc.iceGatheringState);
  });
  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) {
      console.log('[ICE] Candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address);
    } else {
      console.log('[ICE] Gathering complete (null candidate)');
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    console.log('[PEER] State changed:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      startStatsLogging(pc);
    }
    if (pc.connectionState === 'failed') {
      console.error('[PEER] Connection failed, will retry...');
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
      document.getElementById('statusBadge').textContent = 'Live';
      document.getElementById('statusBadge').className = 'status status-active';
      document.getElementById('meetingStatus').textContent = '';
      document.getElementById('unmuteMask').style.display = 'flex';
      retryCount = 0;
    } else if (state === 'failed' || state === 'disconnected') {
      document.getElementById('statusBadge').textContent = 'Reconnecting...';
      document.getElementById('statusBadge').className = 'status status-connecting';
    }
  });

  player.on('no-media', () => {
    console.warn('[PLAYER] No media received');
    document.getElementById('meetingStatus').textContent = 'Waiting for host to share screen...';
  });

  player.on('media-recovered', () => {
    console.log('[PLAYER] Media recovered');
    document.getElementById('meetingStatus').textContent = '';
  });

  console.log('[DEBUG] Loading WHEP:', url);
  await player.load(new URL(url));
  console.log('[DEBUG] WHEP loaded');

  // Monitor the peer connection right after load
  const pc = player.peer;
  if (pc) {
    monitorPeerConnection(pc);
  } else {
    console.warn('[DEBUG] No peer connection after load');
  }

  // Check if autoplay was blocked
  video.play().then(() => {
    console.log('[VIDEO] Playing');
  }).catch((err) => {
    console.warn('[VIDEO] Autoplay blocked:', err.message);
    document.getElementById('meetingStatus').textContent = 'Click to start playback';
    document.getElementById('unmuteMask').style.display = 'flex';
  });
}

async function retryConnect() {
  if (!whepUrl || retryCount >= MAX_RETRIES) {
    if (retryCount >= MAX_RETRIES) {
      showError('Failed to connect after multiple attempts');
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
    showError('No meeting code provided');
    return;
  }

  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(code)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Meeting not found');
      throw new Error('Failed to load meeting');
    }

    const meeting = await res.json();
    console.log('[DEBUG] Meeting:', meeting);
    document.getElementById('meetingTitle').textContent = meeting.title;

    if (meeting.status === 'ended') {
      document.getElementById('statusBadge').textContent = 'Ended';
      document.getElementById('statusBadge').className = 'status status-ended';
      document.getElementById('meetingStatus').textContent = 'This meeting has ended.';
      return;
    }

    whepUrl = meeting.whepUrl;
    await connectWHEP(whepUrl);
  } catch (err) {
    console.error('[ERROR]', err);
    showError(err.message || 'Failed to join meeting');
  }
}

init();
