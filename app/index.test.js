const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');
const {
  containsCompressibleImage,
  containsWebsiteLikeImagePath,
  decodeEntryPath,
} = require('./index');

test('decodeEntryPath decodes non-Unicode Shift-JIS file names as UTF-8 strings', () => {
  const fileName = '日本語画像.jpg';
  const entry = {
    path: iconv.encode(fileName, 'shift_jis').toString('utf8'),
    pathBuffer: iconv.encode(fileName, 'shift_jis'),
    isUnicode: false,
  };

  assert.equal(decodeEntryPath(entry), fileName);
});

test('decodeEntryPath keeps Unicode file names unchanged', () => {
  const entry = {
    path: '日本語画像.jpg',
    pathBuffer: Buffer.from('日本語画像.jpg'),
    isUnicode: true,
  };

  assert.equal(decodeEntryPath(entry), entry.path);
});

test('containsCompressibleImage detects supported images using decoded names', () => {
  assert.equal(
    containsCompressibleImage([
      { entry: { type: 'File' }, entryPath: '資料/readme.txt' },
      { entry: { type: 'File' }, entryPath: '資料/写真.WEBP' },
    ]),
    true,
  );
  assert.equal(
    containsCompressibleImage([{ entry: { type: 'File' }, entryPath: '資料/readme.txt' }]),
    false,
  );
});

test('containsWebsiteLikeImagePath checks decoded paths', () => {
  assert.equal(
    containsWebsiteLikeImagePath([{ entryPath: 'サイト/images/写真.jpg' }]),
    true,
  );
  assert.equal(containsWebsiteLikeImagePath([{ entryPath: '写真.jpg' }]), false);
});

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { extractAndCompressZip } = require('./index');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(fileNameBuffer, contents) {
  const checksum = crc32(contents);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(contents.length, 18);
  localHeader.writeUInt32LE(contents.length, 22);
  localHeader.writeUInt16LE(fileNameBuffer.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(contents.length, 20);
  centralHeader.writeUInt32LE(contents.length, 24);
  centralHeader.writeUInt16LE(fileNameBuffer.length, 28);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length + fileNameBuffer.length, 12);
  endRecord.writeUInt32LE(localHeader.length + fileNameBuffer.length + contents.length, 16);

  return Buffer.concat([
    localHeader,
    fileNameBuffer,
    contents,
    centralHeader,
    fileNameBuffer,
    endRecord,
  ]);
}

test('extractAndCompressZip extracts Shift-JIS image names with readable Japanese characters', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-compressor-'));
  const zipPath = path.join(temporaryDirectory, 'images.zip');
  const imageName = '日本語画像.png';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFgAI/ScL3WQAAAABJRU5ErkJggg==',
    'base64',
  );

  try {
    await fs.writeFile(zipPath, createStoredZip(iconv.encode(imageName, 'shift_jis'), png));

    const result = await extractAndCompressZip(zipPath);

    assert.equal(result.skipped, false);
    assert.equal(result.compressedResults.length, 1);
    await fs.access(path.join(temporaryDirectory, imageName));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('extractAndCompressZip skips extraction when a ZIP contains no supported images', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-compressor-'));
  const zipPath = path.join(temporaryDirectory, 'documents.zip');
  const textName = '説明.txt';

  try {
    await fs.writeFile(
      zipPath,
      createStoredZip(iconv.encode(textName, 'shift_jis'), Buffer.from('read me')),
    );

    const result = await extractAndCompressZip(zipPath);

    assert.equal(result.skipped, true);
    assert.match(result.reason, /does not contain compressible images/);
    await assert.rejects(fs.access(path.join(temporaryDirectory, textName)), { code: 'ENOENT' });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
