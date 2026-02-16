const http = require('http');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const meetingsRouter = require('./routes/meetings');
const migrate = require('./db/migrate');
const pool = require('./db');

migrate().catch((err) => console.error('Migration failed:', err));

const app = express();
app.use(express.json());

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

app.use('/api/meetings', meetingsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// --- HTTP + WebSocket Server ---
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

// rooms: Map<meetingCode, Set<{ ws, role }>>
const rooms = new Map();

function broadcast(meetingCode, message, excludeWs) {
  const room = rooms.get(meetingCode);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

function broadcastToRole(meetingCode, role, message) {
  const room = rooms.get(meetingCode);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room) {
    if (client.role === role && client.ws.readyState === 1) {
      client.ws.send(data);
    }
  }
}

function getViewerCount(meetingCode) {
  const room = rooms.get(meetingCode);
  if (!room) return 0;
  let count = 0;
  for (const client of room) {
    if (client.role === 'viewer') count++;
  }
  return count;
}

function getViewerList(meetingCode) {
  const room = rooms.get(meetingCode);
  if (!room) return [];
  const list = [];
  for (const client of room) {
    if (client.role === 'viewer') {
      list.push(client.name || '匿名');
    }
  }
  return list;
}

// Heartbeat: detect dead connections every 30s
const HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let clientInfo = null; // { meetingCode, role }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join' && msg.meetingCode && msg.role) {
      // Verify host token if joining as host
      if (msg.role === 'host') {
        try {
          const result = await pool.query(
            'SELECT host_token FROM meetings WHERE meeting_code = $1',
            [msg.meetingCode]
          );

          if (result.rows.length === 0 || result.rows[0].host_token !== msg.token) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid host token' }));
            ws.close();
            return;
          }
        } catch (err) {
          console.error('[WS] Host token verification error:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
          ws.close();
          return;
        }
      }

      // Register client in room
      clientInfo = { meetingCode: msg.meetingCode, role: msg.role };

      if (!rooms.has(msg.meetingCode)) {
        rooms.set(msg.meetingCode, new Set());
      }
      const name = msg.role === 'viewer' ? String(msg.name || '匿名').slice(0, 20) : null;
      const entry = { ws, role: msg.role, name };
      rooms.get(msg.meetingCode).add(entry);
      clientInfo._entry = entry;
      clientInfo.name = name;

      const count = getViewerCount(msg.meetingCode);

      const viewers = getViewerList(msg.meetingCode);

      if (msg.role === 'viewer') {
        // Notify everyone that a viewer joined
        broadcast(msg.meetingCode, { type: 'viewer_joined', count, name, viewers }, ws);
      }

      if (msg.role === 'host') {
        // Notify viewers that host is (back) online
        const room = rooms.get(msg.meetingCode);
        const viewersInRoom = room ? [...room].filter(c => c.role === 'viewer' && c.ws.readyState === 1).length : 0;
        console.log(`[WS] Broadcasting host_reconnected to ${viewersInRoom} viewer(s)`);
        broadcastToRole(msg.meetingCode, 'viewer', { type: 'host_reconnected' });
      }

      // Send current state to the joining client
      ws.send(JSON.stringify({ type: 'viewer_count', count, viewers }));

      console.log(`[WS] ${msg.role} joined room ${msg.meetingCode} (viewers: ${count})`);
    }

    if (msg.type === 'end_meeting' && clientInfo && clientInfo.role === 'host') {
      clientInfo.ended = true;
      broadcastToRole(clientInfo.meetingCode, 'viewer', { type: 'meeting_ended' });
      console.log(`[WS] Host ended meeting ${clientInfo.meetingCode}`);
    }

    if (msg.type === 'pause_stream' && clientInfo && clientInfo.role === 'host') {
      broadcastToRole(clientInfo.meetingCode, 'viewer', { type: 'stream_paused' });
      console.log(`[WS] Host paused stream ${clientInfo.meetingCode}`);
    }

    if (msg.type === 'resume_stream' && clientInfo && clientInfo.role === 'host') {
      broadcastToRole(clientInfo.meetingCode, 'viewer', { type: 'stream_resumed' });
      console.log(`[WS] Host resumed stream ${clientInfo.meetingCode}`);
    }
  });

  ws.on('close', () => {
    if (!clientInfo) return;

    const room = rooms.get(clientInfo.meetingCode);
    if (room && clientInfo._entry) {
      room.delete(clientInfo._entry);
      if (room.size === 0) {
        rooms.delete(clientInfo.meetingCode);
      }
    }

    if (clientInfo.role === 'viewer') {
      const count = getViewerCount(clientInfo.meetingCode);
      const viewers = getViewerList(clientInfo.meetingCode);
      broadcast(clientInfo.meetingCode, { type: 'viewer_left', count, name: clientInfo.name, viewers });
      console.log(`[WS] Viewer "${clientInfo.name}" left room ${clientInfo.meetingCode} (viewers: ${count})`);
    }

    if (clientInfo.role === 'host' && !clientInfo.ended) {
      broadcastToRole(clientInfo.meetingCode, 'viewer', { type: 'host_disconnected' });
      console.log(`[WS] Host disconnected from room ${clientInfo.meetingCode}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
