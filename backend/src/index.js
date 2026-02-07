const express = require('express');
const meetingsRouter = require('./routes/meetings');

const app = express();
app.use(express.json());

app.use('/api/meetings', meetingsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
