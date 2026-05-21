# ImageCompressor (Electron メニューバーアプリ)

画像自動圧縮ツールを Electron 化し、macOS メニューバー常駐アプリとして利用できます。

## 開発セットアップ

```bash
npm install
cd app && npm install && cd ..
npm start
```

## ビルド

```bash
npm run build
```

`dist/` 配下に `.dmg` が生成されます。

## 付属コンポーネント

- `app/`: 既存の Node.js 圧縮サーバー（Express + sharp）
- `extension/`: 既存の Chrome 拡張
- `CHROME_EXTENSION_SETUP.md`: Chrome 拡張の手動導入手順
