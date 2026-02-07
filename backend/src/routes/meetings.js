const { Router } = require('express');
const { nanoid } = require('nanoid');
const pool = require('../db');
const { createLiveInput, deleteLiveInput } = require('../services/cloudflare');

const router = Router();

// Create a new meeting
router.post('/', async (req, res) => {
  try {
    const meetingCode = nanoid(10);
    const title = req.body.title || 'Untitled Meeting';

    const cf = await createLiveInput(`Meeting ${meetingCode}`);

    const result = await pool.query(
      `INSERT INTO meetings (meeting_code, title, cf_live_input_uid, whip_url, whep_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [meetingCode, title, cf.uid, cf.whipUrl, cf.whepUrl]
    );

    const meeting = result.rows[0];
    res.status(201).json({
      meetingCode: meeting.meeting_code,
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

// End a meeting
router.patch('/:code/end', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE meetings SET status = 'ended' WHERE meeting_code = $1 RETURNING *`,
      [req.params.code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = result.rows[0];
    if (meeting.cf_live_input_uid) {
      await deleteLiveInput(meeting.cf_live_input_uid).catch(() => {});
    }

    res.json({ meetingCode: meeting.meeting_code, status: 'ended' });
  } catch (err) {
    console.error('End meeting error:', err);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

module.exports = router;
