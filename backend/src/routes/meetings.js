const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const pool = require('../db');
const { createLiveInput, deleteLiveInput } = require('../services/cloudflare');

const router = Router();

// Stricter rate limit for meeting creation: 5 meetings per hour
const createMeetingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many meetings created, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Create a new meeting
router.post('/', createMeetingLimiter, async (req, res) => {
  try {
    const meetingCode = nanoid(10);
    const hostToken = nanoid(32);
    const title = req.body.title || 'Untitled Meeting';

    const cf = await createLiveInput(`Meeting ${meetingCode}`);

    const result = await pool.query(
      `INSERT INTO meetings (meeting_code, host_token, title, cf_live_input_uid, whip_url, whep_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [meetingCode, hostToken, title, cf.uid, cf.whipUrl, cf.whepUrl]
    );

    const meeting = result.rows[0];
    res.status(201).json({
      meetingCode: meeting.meeting_code,
      hostToken: meeting.host_token,
      title: meeting.title,
      whipUrl: meeting.whip_url,
      whepUrl: meeting.whep_url,
      status: meeting.status,
    });
  } catch (err) {
    console.error('Create meeting error:', err);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Host rejoin — verify token and return WHIP URL
router.get('/:code/host', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM meetings WHERE meeting_code = $1',
      [req.params.code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = result.rows[0];

    if (meeting.host_token !== req.query.token) {
      return res.status(403).json({ error: 'Invalid host token' });
    }

    if (meeting.status === 'ended') {
      return res.status(410).json({ error: 'Meeting has ended' });
    }

    res.json({
      meetingCode: meeting.meeting_code,
      title: meeting.title,
      whipUrl: meeting.whip_url,
      whepUrl: meeting.whep_url,
      status: meeting.status,
    });
  } catch (err) {
    console.error('Host rejoin error:', err);
    res.status(500).json({ error: 'Failed to rejoin meeting' });
  }
});

// Get meeting by code (viewer)
router.get('/:code', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM meetings WHERE meeting_code = $1',
      [req.params.code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = result.rows[0];
    res.json({
      meetingCode: meeting.meeting_code,
      title: meeting.title,
      whepUrl: meeting.whep_url,
      status: meeting.status,
    });
  } catch (err) {
    console.error('Get meeting error:', err);
    res.status(500).json({ error: 'Failed to get meeting' });
  }
});

// End a meeting (delete from DB)
router.patch('/:code/end', async (req, res) => {
  try {
    const hostToken = req.query.token || req.body.token;

    if (!hostToken) {
      return res.status(401).json({ error: 'Host token required' });
    }

    const result = await pool.query(
      `DELETE FROM meetings WHERE meeting_code = $1 AND host_token = $2 RETURNING *`,
      [req.params.code, hostToken]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found or invalid token' });
    }

    const meeting = result.rows[0];
    if (meeting.cf_live_input_uid) {
      await deleteLiveInput(meeting.cf_live_input_uid).catch(() => {});
    }

    res.json({ meetingCode: meeting.meeting_code, status: 'deleted' });
  } catch (err) {
    console.error('End meeting error:', err);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

module.exports = router;
