const path = require('node:path');
const streamFs = require('node:fs');
const fs = require('node:fs/promises');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
const cors = require(path.join(__dirname, '..', 'node_modules', 'cors'));
const unzipper = require(path.join(__dirname, '..', 'node_modules', 'unzipper'));
const { compressImage } = require('./compressor');

const PORT = 3000;
const app = express();
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const WEB_DATA_PATH_MARKERS = ['images/', 'image/', 'img/'];

function hasWebDataPath(entryPath) {
  return WEB_DATA_PATH_MARKERS.some((marker) => entryPath.toLowerCase().includes(marker));
}

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

app.post('/extract', async (req, res) => {
  const { filePath } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    return res
      .status(400)
      .json({ success: false, error: 'filePath is required and must be a string' });
  }

  try {
    const directory = path.dirname(filePath);
    const zipDirectory = await unzipper.Open.file(filePath);
    const entryPaths = zipDirectory.files.map((file) => file.path || '');

    const shouldSkip = entryPaths.some(hasWebDataPath);
    if (shouldSkip) {
      return res.json({
        success: true,
        filePath,
        skipped: true,
        reason: 'ZIP appears to contain web site data paths (images/image/img)',
      });
    }

    await fs.mkdir(directory, { recursive: true });
    await streamFs
      .createReadStream(filePath)
      .pipe(unzipper.Extract({ path: directory }))
      .promise();

    const imageEntryPaths = entryPaths.filter((entryPath) => {
      const ext = path.extname(entryPath).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    });

    const compressionResults = await Promise.all(
      imageEntryPaths.map(async (entryPath) => {
        const extractedFilePath = path.resolve(directory, entryPath);
        const result = await compressImage(extractedFilePath);
        return { entryPath, ...result };
      }),
    );

    return res.json({
      success: true,
      filePath,
      extractedTo: directory,
      totalImageEntries: imageEntryPaths.length,
      compressedCount: compressionResults.filter((result) => result.success).length,
      results: compressionResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Image compressor app is running on http://localhost:${PORT}`);
});
