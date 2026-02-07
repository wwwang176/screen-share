const path = require('path');
const express = require('express');
const meetingsRouter = require('./routes/meetings');

const app = express();
app.use(express.json());

app.use('/api/meetings', meetingsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
