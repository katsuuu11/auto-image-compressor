const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { compressImage } = require('./compressor');

const PORT = 3000;
const app = express();

app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (origin.startsWith('chrome-extension://')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  }),
);

app.post('/compress', async (req, res) => {
  const { filePath } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    return res
      .status(400)
      .json({ success: false, error: 'filePath is required and must be a string' });
  }

  const result = await compressImage(filePath);

  if (result.success) {
    return res.json({ success: true, filePath: result.filePath, ...result });
  }

  return res.status(500).json({ success: false, error: result.error, filePath });
});

app.listen(PORT, () => {
  console.log(`Image compressor app is running on http://localhost:${PORT}`);
});
