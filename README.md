# 画像自動圧縮ツール

Chromeで画像保存完了時にローカルNode.jsアプリへ通知し、画像を自動圧縮する構成です。

## ディレクトリ構成

```
image-compressor/
├── app/
│   ├── package.json
│   ├── index.js
│   └── compressor.js
├── extension/
│   ├── manifest.json
│   └── background.js
└── launchd/
    └── com.image-compressor.plist
```

## セットアップ

1. `cd app && npm install`
2. `node index.js` で起動確認（`http://localhost:3000`）
3. Chromeで `chrome://extensions/` を開く
4. 「デベロッパーモード」をON
5. 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選択
6. `launchd/com.image-compressor.plist` の `/path/to/app/index.js` を絶対パスへ変更
7. `cp launchd/com.image-compressor.plist ~/Library/LaunchAgents/`
8. `launchctl load ~/Library/LaunchAgents/com.image-compressor.plist`

## 動作確認

1. ローカルアプリ起動中にChromeで画像を保存
2. 保存先を問わず圧縮処理が呼ばれることを確認
3. ファイルが上書きされることを確認
4. ファイルサイズが削減されることを確認
