const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const express = require('express');
const cors = require('cors');
const unzipper = require('unzipper');
const iconv = require('iconv-lite');
const { compressImage } = require('./compressor');

const PORT = 3000;
const app = express();
const IMAGE_PATH_PATTERNS = ['images/', 'image/', 'img/'];
const COMPRESSIBLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function decodeEntryPath(entry) {
  const isUnicode = entry.isUnicode ?? entry.props?.flags?.isUnicode;
  const pathBuffer = entry.pathBuffer ?? entry.props?.pathBuffer;

  if (!isUnicode && pathBuffer) {
    return iconv.decode(pathBuffer, 'shift_jis');
  }

  return entry.path;
}

function hasWebsiteLikeImagePath(entryPath) {
  const normalizedPath = entryPath.replace(/\\/g, '/').toLowerCase();
  return IMAGE_PATH_PATTERNS.some((pattern) => normalizedPath.includes(pattern));
}

function containsWebsiteLikeImagePath(entries) {
  // Inspect all entries in advance. If any path looks like website assets, skip the whole ZIP.
  return entries.some(({ entryPath }) => hasWebsiteLikeImagePath(entryPath));
}

function containsCompressibleImage(entries) {
  return entries.some(
    ({ entry, entryPath }) =>
      entry.type !== 'Directory' && COMPRESSIBLE_EXTENSIONS.has(path.extname(entryPath).toLowerCase()),
  );
}

async function extractAndCompressZip(filePath) {
  const zipDirectory = path.dirname(filePath);
  const directory = await unzipper.Open.file(filePath);
  const entries = directory.files.map((entry) => ({
    entry,
    entryPath: decodeEntryPath(entry),
  }));

  if (containsWebsiteLikeImagePath(entries)) {
    return {
      success: true,
      skipped: true,
      reason: 'ZIP contains website-like image directory path (images/image/img).',
      filePath,
      extractedTo: zipDirectory,
    };
  }

  if (!containsCompressibleImage(entries)) {
    return {
      success: true,
      skipped: true,
      reason: 'ZIP does not contain compressible images (jpg/jpeg/png/webp).',
      filePath,
      extractedTo: zipDirectory,
    };
  }

  const compressedResults = [];

  for (const { entry, entryPath } of entries) {
    const destinationPath = path.join(zipDirectory, entryPath);

    if (entry.type === 'Directory') {
      await fs.mkdir(destinationPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });

    await new Promise((resolve, reject) => {
      entry
        .stream()
        .pipe(fss.createWriteStream(destinationPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    const ext = path.extname(destinationPath).toLowerCase();
    if (!COMPRESSIBLE_EXTENSIONS.has(ext)) {
      continue;
    }

    const result = await compressImage(destinationPath);
    compressedResults.push(result);
  }

  return {
    success: true,
    skipped: false,
    filePath,
    extractedTo: zipDirectory,
    totalEntries: directory.files.length,
    compressedResults,
  };
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
    const result = await extractAndCompressZip(filePath);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, filePath });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Image compressor app is running on http://localhost:${PORT}`);
  });
}

module.exports = {
  containsCompressibleImage,
  containsWebsiteLikeImagePath,
  decodeEntryPath,
  extractAndCompressZip,
};
