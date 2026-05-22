const TARGET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.zip']);

function getExtension(filePath) {
  const match = filePath.toLowerCase().match(/\.[^./\\]+$/);
  return match ? match[0] : '';
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || delta.state.current !== 'complete' || !delta.id) {
    return;
  }

  chrome.downloads.search({ id: delta.id }, async (results) => {
    if (!results || results.length === 0) {
      console.log('[Image Auto Compressor] Download item not found:', delta.id);
      return;
    }

    const downloadItem = results[0];
    const filePath = downloadItem.filename;
    const ext = getExtension(filePath);

    if (!TARGET_EXTENSIONS.has(ext)) {
      return;
    }

    const endpoint = ext === '.zip' ? '/extract' : '/compress';

    try {
      const response = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath }),
      });

      const data = await response.json();
      console.log('[Image Auto Compressor] Processing result:', data);
    } catch (error) {
      console.error('[Image Auto Compressor] Compression request failed:', error);
    }
  });
});
