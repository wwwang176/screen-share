const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function createLiveInput(name) {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;

  const res = await fetch(
    `${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meta: { name },
        recording: { mode: 'off' },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const input = data.result;

  return {
    uid: input.uid,
    whipUrl: input.webRTC.url,
    whepUrl: input.webRTCPlayback.url,
  };
}

async function deleteLiveInput(uid) {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;

  const res = await fetch(
    `${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs/${uid}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Cloudflare delete error ${res.status}: ${body}`);
  }
}

module.exports = { createLiveInput, deleteLiveInput };
