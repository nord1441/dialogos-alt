# dialogos - 使い方ガイド

## アプリケーション概要

dialogos は、複数の LLM プロバイダーに対応したリアルタイムストリーミングチャットアプリケーションです。

- **バックエンド**: Express (TypeScript) + better-sqlite3
- **フロントエンド**: バニラ HTML/CSS/JS (SPA)
- **対応プロバイダー**: Anthropic / OpenAI / Gemini / Ollama

### 主な機能

- 複数 LLM プロバイダーの切り替え (Anthropic, OpenAI, Gemini, Ollama)
- リアルタイムチャット (Server-Sent Events によるストリーミング応答)
- 設定画面から API キーやモデルをブラウザ上で管理
- 利用するモデルをチェックボックスで選択
- システムプロンプトのカスタマイズ
- アバター画像/動画のアップロード (jpg, png, gif, webp, mp4, webm)
- ダーク/ライトテーマの切り替え
- 会話履歴の永続化と全削除

### 対応モデル

| プロバイダー | モデル |
|---|---|
| Anthropic | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5 |
| OpenAI | GPT-4o, GPT-4o Mini, O1, O3 Mini |
| Gemini | Gemini 2.0 Flash, Gemini 2.0 Pro, Gemini 1.5 Pro, Gemini 1.5 Flash |
| Ollama | ローカルサーバーから動的に取得 |

---

## ローカル実行

### 前提条件

- Node.js (v18 以上推奨)
- npm
- いずれかの LLM プロバイダーの API キー (または Ollama ローカルサーバー)

### セットアップ

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env ファイルを編集し、使用するプロバイダーの API キーを設定
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

プロジェクトルートに `.env` ファイルを作成し、以下の環境変数を設定します。API キーとエンドポイントは環境変数のほか、設定画面からも登録可能です (設定画面の値が優先)。

各プロバイダーに対して **API キー** (認証) と **ベース URL** (エンドポイント) の両方を設定できます。プロキシや互換 API サーバーを使用する場合にベース URL を変更してください。

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API の認証キー | なし |
| `ANTHROPIC_BASE_URL` | Anthropic API のエンドポイント | `https://api.anthropic.com` |
| `OPENAI_API_KEY` | OpenAI API の認証キー | なし |
| `OPENAI_BASE_URL` | OpenAI API のエンドポイント | `https://api.openai.com/v1` |
| `GEMINI_API_KEY` | Gemini API の認証キー | なし |
| `GEMINI_BASE_URL` | Gemini API のエンドポイント | `https://generativelanguage.googleapis.com` |
| `OLLAMA_API_KEY` | Ollama の認証キー (通常は不要) | なし |
| `OLLAMA_BASE_URL` | Ollama サーバーのエンドポイント | `http://localhost:11434` |
| `HOST` | サーバーのバインドアドレス | `0.0.0.0` |
| `PORT` | サーバーのリッスンポート | `3000` |
| `DATA_DIR` | データ永続化ディレクトリのパス | `./data` |

`.env` ファイルの例:

```env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
ANTHROPIC_BASE_URL=https://api.anthropic.com
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=AIza-your-gemini-key-here
OLLAMA_BASE_URL=http://localhost:11434
HOST=0.0.0.0
PORT=3000
DATA_DIR=./data
```

### 接続テスト

設定画面の **providers** タブで各プロバイダーの API キーとエンドポイントを設定した後、**test** ボタンで接続を確認できます。接続成功時は「connected」、失敗時はエラーメッセージが表示されます。

---

## Docker で実行

### 前提条件

- Docker Engine 20.10 以上
- Docker Compose v2 (docker compose サブコマンド対応)

### docker compose による起動 (推奨)

最も簡単な起動方法です。

```bash
# .env ファイルを準備
cp .env.example .env
# .env を編集して API キーを設定

# ビルド & 起動
docker compose up -d

# ログの確認
docker compose logs -f

# 停止
docker compose down
```

起動後、`http://localhost:3000` にアクセスしてください。

#### データの永続化

`docker-compose.yaml` では `dialogos-data` という名前付きボリュームが定義されており、SQLite データベースとアップロードファイルが永続化されます。

```bash
# ボリュームの確認
docker volume ls | grep dialogos

# ボリュームの詳細
docker volume inspect dialogos-alt_dialogos-data
```

コンテナを `docker compose down` で停止してもデータは保持されます。ボリュームごと削除する場合は:

```bash
docker compose down -v
```

#### Ollama との連携

ホスト上で Ollama が動作している場合、Docker コンテナからは `host.docker.internal` 経由でアクセスします。`docker-compose.yaml` のデフォルト設定で対応済みです。

```yaml
OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
```

Linux で `host.docker.internal` が解決できない場合は、`.env` に直接ホストの IP を指定してください:

```env
OLLAMA_BASE_URL=http://172.17.0.1:11434
```

### Docker 単体での実行

docker compose を使わない場合:

```bash
# イメージのビルド
docker build -t dialogos .

# コンテナの起動
docker run -d \
  --name dialogos \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-api03-your-key \
  -v dialogos-data:/app/data \
  dialogos
```

### Dockerfile の構成

マルチステージビルドを採用しています。

| ステージ | 内容 |
|---|---|
| **builder** | Node.js 20 上で `npm ci` → TypeScript コンパイル |
| **production** | 本番用依存のみインストール、コンパイル済み JS + 静的ファイルをコピー |

最終イメージには TypeScript ソースやテストコード、devDependencies は含まれません。

---

## GitHub Actions (CI/CD)

`.github/workflows/docker-build.yaml` に、テスト実行とDockerイメージのビルド・プッシュを行うワークフローが定義されています。

### ワークフローの動作

| トリガー | テスト | Docker ビルド | GHCR プッシュ |
|---|---|---|---|
| `main` ブランチへの push | 実行 | 実行 | 実行 |
| `main` ブランチへの PR | 実行 | 実行 (キャッシュ検証) | スキップ |

### イメージタグ

プッシュ時に以下のタグが自動付与されます:

| タグ | 例 | 条件 |
|---|---|---|
| `sha-<コミットハッシュ>` | `sha-f9dc086` | 常時 |
| ブランチ名 | `main` | ブランチ push 時 |
| セマンティックバージョン | `1.0.0` | tag push 時 |
| `latest` | `latest` | デフォルトブランチ push 時 |

### 必要な設定

GitHub リポジトリの設定で以下を確認してください:

1. **Packages 書き込み権限**: Settings → Actions → General → Workflow permissions で「Read and write permissions」を有効化
2. `GITHUB_TOKEN` は自動で利用されるため、追加のシークレット設定は不要です

### ローカルでの動作確認

ワークフローを手元で検証したい場合:

```bash
# テスト
npm ci && npm test

# Docker ビルド
docker build -t dialogos .
```

---

## Kubernetes デプロイ

`k8s/` ディレクトリに素のマニフェストファイル一式が用意されています。

### マニフェスト一覧

| ファイル | リソース | 説明 |
|---|---|---|
| `namespace.yaml` | Namespace | `dialogos` namespace の作成 |
| `secret.yaml` | Secret | API キーの格納 |
| `pvc.yaml` | PersistentVolumeClaim | データ永続化用 (1Gi) |
| `deployment.yaml` | Deployment | アプリケーション Pod の定義 |
| `service.yaml` | Service | ClusterIP サービス (80 → 3000) |
| `ingress.yaml` | Ingress | 外部公開用 Ingress ルール |

### デプロイ手順

```bash
# 1. namespace の作成
kubectl apply -f k8s/namespace.yaml

# 2. API キーの設定 (secret.yaml を編集してから適用)
kubectl apply -f k8s/secret.yaml

# 3. PVC、Deployment、Service の適用
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# 4. (オプション) Ingress の適用
# ingress.yaml 内の host を実際のドメインに変更してから適用
kubectl apply -f k8s/ingress.yaml
```

または一括適用:

```bash
kubectl apply -f k8s/
```

### イメージの変更

`k8s/deployment.yaml` 内の `image` フィールドを実際のレジストリ・リポジトリに書き換えてください:

```yaml
image: ghcr.io/<OWNER>/dialogos-alt:latest
```

### API キーの設定

`k8s/secret.yaml` を編集して、使用するプロバイダーの API キーを設定します:

```yaml
stringData:
  ANTHROPIC_API_KEY: "sk-ant-api03-your-key"
  OPENAI_API_KEY: "sk-your-openai-key"
  GEMINI_API_KEY: "AIza-your-gemini-key"
```

本番環境では外部シークレット管理 (Sealed Secrets, External Secrets Operator 等) の利用を推奨します。

### ヘルスチェック

Deployment には以下のプローブが設定されています:

- **Liveness Probe**: `GET /` (10秒後開始、30秒間隔)
- **Readiness Probe**: `GET /` (5秒後開始、10秒間隔)

### ポートフォワードでの動作確認

Ingress を設定せずに動作確認する場合:

```bash
kubectl port-forward -n dialogos svc/dialogos 3000:80
# ブラウザで http://localhost:3000 にアクセス
```

---

## Helm チャートによるデプロイ

`helm/dialogos/` ディレクトリに Helm チャートが用意されています。Kubernetes マニフェストをより柔軟にカスタマイズしてデプロイできます。

### インストール

```bash
helm install dialogos ./helm/dialogos \
  --namespace dialogos \
  --create-namespace \
  --set secrets.ANTHROPIC_API_KEY="sk-ant-api03-your-key"
```

### 主な設定値 (values.yaml)

| パラメータ | デフォルト値 | 説明 |
|---|---|---|
| `replicaCount` | `1` | Pod のレプリカ数 |
| `image.repository` | `ghcr.io/OWNER/dialogos-alt` | コンテナイメージのリポジトリ |
| `image.tag` | `latest` | イメージタグ |
| `image.pullPolicy` | `IfNotPresent` | イメージプルポリシー |
| `service.type` | `ClusterIP` | Service タイプ |
| `service.port` | `80` | Service ポート |
| `ingress.enabled` | `false` | Ingress の有効化 |
| `ingress.hosts[0].host` | `dialogos.example.com` | Ingress ホスト名 |
| `persistence.enabled` | `true` | PVC の有効化 |
| `persistence.size` | `1Gi` | PVC サイズ |
| `persistence.storageClass` | `""` | StorageClass (空欄でデフォルト) |
| `resources.requests.cpu` | `100m` | CPU リクエスト |
| `resources.requests.memory` | `128Mi` | メモリリクエスト |
| `resources.limits.cpu` | `500m` | CPU リミット |
| `resources.limits.memory` | `512Mi` | メモリリミット |
| `secrets.ANTHROPIC_API_KEY` | `""` | Anthropic API キー |
| `secrets.OPENAI_API_KEY` | `""` | OpenAI API キー |
| `secrets.GEMINI_API_KEY` | `""` | Gemini API キー |
| `env.OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama ベース URL |

### カスタマイズ例

#### Ingress 有効化 + TLS

```bash
helm install dialogos ./helm/dialogos \
  --namespace dialogos \
  --create-namespace \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=chat.example.com \
  --set ingress.tls[0].secretName=chat-tls \
  --set ingress.tls[0].hosts[0]=chat.example.com \
  --set secrets.ANTHROPIC_API_KEY="sk-ant-api03-your-key"
```

#### values ファイルによるカスタマイズ

`values.yaml` をコピーして編集し、`-f` で指定する方法:

```bash
cp helm/dialogos/values.yaml my-values.yaml
# my-values.yaml を編集

helm install dialogos ./helm/dialogos \
  --namespace dialogos \
  --create-namespace \
  -f my-values.yaml
```

#### リソースの調整

```bash
helm install dialogos ./helm/dialogos \
  --namespace dialogos \
  --create-namespace \
  --set resources.requests.memory=256Mi \
  --set resources.limits.memory=1Gi \
  --set persistence.size=5Gi
```

### アップグレード

```bash
helm upgrade dialogos ./helm/dialogos \
  --namespace dialogos \
  --set image.tag=sha-abc1234
```

### アンインストール

```bash
helm uninstall dialogos --namespace dialogos
```

PVC はデフォルトで残ります。データも削除する場合:

```bash
kubectl delete pvc -n dialogos -l app.kubernetes.io/instance=dialogos
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
| `key` | TEXT (PRIMARY KEY) | 設定キー |
| `value` | TEXT NOT NULL | 設定値 |

保存される主な設定:

| キー | 説明 |
|---|---|
| `system_prompt` | AI のシステムプロンプト |
| `active_model` | 現在選択中のプロバイダーとモデル (JSON) |
| `enabled_models` | 有効化されたモデル一覧 (JSON 配列) |
| `anthropic_api_key` | Anthropic API キー |
| `anthropic_base_url` | Anthropic API エンドポイント |
| `openai_api_key` | OpenAI API キー |
| `openai_base_url` | OpenAI API エンドポイント |
| `gemini_api_key` | Gemini API キー |
| `gemini_base_url` | Gemini API エンドポイント |
| `ollama_api_key` | Ollama 認証キー |
| `ollama_base_url` | Ollama サーバーのエンドポイント |

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
