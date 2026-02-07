let meetingCode = null;
let pc = null;
let stream = null;

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function startMeeting() {
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    // Create meeting on backend
    const title = document.getElementById('title').value || 'Untitled Meeting';
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) throw new Error('Failed to create meeting');
    const meeting = await res.json();
    meetingCode = meeting.meetingCode;

    document.getElementById('setup').style.display = 'none';
    document.getElementById('meeting').style.display = 'block';
    document.getElementById('meetingTitle').textContent = meeting.title;

    // Capture screen
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    document.getElementById('preview').srcObject = stream;

    // Handle user stopping share via browser UI
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      endMeeting();
    });

    // WHIP push to Cloudflare
    await pushToWHIP(meeting.whipUrl, stream);

    // Show share link
    const link = window.location.origin + '/join?code=' + meetingCode;
    document.getElementById('shareLink').textContent = link;
    document.getElementById('linkBox').style.display = 'flex';
    document.getElementById('statusBadge').textContent = 'Live';
    document.getElementById('statusBadge').className = 'status status-active';
  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to start meeting');
    btn.disabled = false;
    btn.textContent = 'Start Meeting';
  }
}

async function pushToWHIP(whipUrl, mediaStream) {
  pc = new RTCPeerConnection();

  mediaStream.getTracks().forEach((track) => {
    pc.addTrack(track, mediaStream);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete
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
  if (pc) {
    pc.close();
    pc = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (meetingCode) {
    await fetch(`/api/meetings/${meetingCode}/end`, { method: 'PATCH' }).catch(
      () => {}
    );
  }
  document.getElementById('statusBadge').textContent = 'Ended';
  document.getElementById('statusBadge').className = 'status status-ended';
}

function copyLink() {
  const link = document.getElementById('shareLink').textContent;
  navigator.clipboard.writeText(link);
}
