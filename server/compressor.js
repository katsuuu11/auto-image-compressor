const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 3;

const SUPPORTED_FORMATS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SKIPPED_FORMATS = new Set(['.gif', '.svg']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFormat(filePath) {
  return path.extname(filePath).toLowerCase();
}

async function writeCompressedBuffer(filePath, ext, inputBuffer) {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return sharp(inputBuffer).jpeg({ quality: 80 }).toBuffer();
    case '.png':
      return sharp(inputBuffer)
        .png({ compressionLevel: 8, effort: 10 })
        .toBuffer();
    case '.webp':
      return sharp(inputBuffer).webp({ quality: 80 }).toBuffer();
    default:
      return null;
  }
}

async function compressImage(filePath) {
  const ext = getFormat(filePath);

  if (SKIPPED_FORMATS.has(ext) || !SUPPORTED_FORMATS.has(ext)) {
    return {
      success: true,
      skipped: true,
      reason: `Unsupported format: ${ext || 'unknown'}`,
      filePath,
    };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await fs.access(filePath);

      const originalBuffer = await fs.readFile(filePath);
      const compressedBuffer = await writeCompressedBuffer(
        filePath,
        ext,
        originalBuffer,
      );

      if (!compressedBuffer) {
        return {
          success: true,
          skipped: true,
          reason: `Unsupported format: ${ext}`,
          filePath,
        };
      }

      if (compressedBuffer.length >= originalBuffer.length) {
        return {
          success: true,
          skipped: true,
          reason: 'Compressed file is not smaller than original. Kept original.',
          filePath,
        };
      }

      await fs.writeFile(filePath, compressedBuffer);

      return {
        success: true,
        skipped: false,
        filePath,
        originalSize: originalBuffer.length,
        compressedSize: compressedBuffer.length,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: false, error: 'File does not exist', filePath };
      }

      const lockErrorCodes = new Set(['EBUSY', 'EPERM', 'EACCES']);
      const shouldRetry = lockErrorCodes.has(error.code) && attempt < MAX_RETRIES;

      if (shouldRetry) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return {
        success: false,
        error: error.message,
        filePath,
      };
    }
  }

  return {
    success: false,
    error: 'Failed after retries',
    filePath,
  };
}

module.exports = {
  compressImage,
};
