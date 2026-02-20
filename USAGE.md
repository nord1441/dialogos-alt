# dialogos - 使い方ガイド

## アプリケーション概要

dialogos は、Anthropic Claude API を利用したリアルタイムストリーミング対応のチャットアプリケーションです。

- **バックエンド**: Express (TypeScript) + better-sqlite3
- **フロントエンド**: バニラ HTML/CSS/JS (SPA)
- **LLM**: Anthropic Claude API (`claude-opus-4-6`)

### 主な機能

- Claude とのリアルタイムチャット (Server-Sent Events によるストリーミング応答)
- システムプロンプトのカスタマイズ
- アバター画像/動画のアップロード (jpg, png, gif, webp, mp4, webm)
- ダーク/ライトテーマの切り替え
- 会話履歴の永続化と全削除

---

## 実行方法

### 前提条件

- Node.js (v18 以上推奨)
- npm
- Anthropic API キー

### セットアップ

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定 (.env.example をコピーして編集)
cp .env.example .env
# .env ファイル内の ANTHROPIC_API_KEY に API キーを設定
```

### 起動

```bash
# 開発用 (ビルド + 起動)
npm run dev

# 本番用 (テスト実行 + ビルド後に起動)
npm run build
npm start
```

### テスト

```bash
npm test
```

起動後、ブラウザで `http://localhost:3000` にアクセスしてください。

---

## 環境変数

プロジェクトルートに `.env` ファイルを作成し、以下の環境変数を設定します。

| 変数名 | 説明 | デフォルト値 | 値の例 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API の認証キー (必須) | なし | `sk-ant-api03-xxxxxxxxxxxx` |
| `HOST` | サーバーのバインドアドレス | `0.0.0.0` | `127.0.0.1` |
| `PORT` | サーバーのリッスンポート | `3000` | `8080` |
| `DATA_DIR` | データ永続化ディレクトリのパス | `./data` | `/var/lib/dialogos/data` |

`.env` ファイルの例:

```env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
HOST=0.0.0.0
PORT=3000
DATA_DIR=./data
```

---

## データの永続化

すべてのデータは `DATA_DIR` 環境変数で指定されたディレクトリ (デフォルト: `./data`) 配下に保存されます。

### ディレクトリ構成

```
data/
├── dialogos.db      # SQLite データベースファイル
└── uploads/         # アップロードされたアバターファイル
    └── avatar.png   # (例) アバター画像
```

### SQLite データベース (`dialogos.db`)

WAL (Write-Ahead Logging) モードで動作する SQLite データベースに、以下の 2 テーブルが格納されます。

#### `settings` テーブル

アプリケーション設定を Key-Value 形式で保存します。

| カラム | 型 | 説明 |
|---|---|---|
| `key` | TEXT (PRIMARY KEY) | 設定キー (例: `system_prompt`) |
| `value` | TEXT NOT NULL | 設定値 |

現在保存される設定:
- `system_prompt` - AI のシステムプロンプト (デフォルト: `"You are a helpful assistant."`)

#### `messages` テーブル

チャットの会話履歴を保存します。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | INTEGER (PRIMARY KEY, AUTOINCREMENT) | メッセージ ID |
| `role` | TEXT NOT NULL | 発言者 (`user` または `assistant`) |
| `content` | TEXT NOT NULL | メッセージ本文 |
| `created_at` | TEXT NOT NULL | 作成日時 (デフォルト: `datetime('now')`) |

### アップロードファイル (`uploads/`)

設定画面からアップロードされたアバター画像・動画は `data/uploads/` ディレクトリに `avatar.<拡張子>` というファイル名で保存されます。対応形式は jpg, jpeg, png, gif, webp, mp4, webm で、最大ファイルサイズは 50MB です。
