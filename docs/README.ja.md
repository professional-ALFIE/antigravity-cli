[English](../README.md) | [한국어](./README.ko.md) | **[日本語](./README.ja.md)** | [中文](./README.zh.md)

# antigravity-cli

> **ターミナルからAntigravityのOpusに直接コマンドを送信。**
>
> Claude CodeやCodexから、Antigravityをサブエージェントとして使えます。

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](../CHANGELOG.md)

## ハイライト

- **プロジェクトごとにtranscriptを自動保存** — `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl`に[Claude Code](https://docs.anthropic.com/en/docs/claude-code)の慣例と同じ形式で保存。grep、replay、pipeすべて可能。
- **`--json`はリアルタイムストリーミング** — 各ステップが到着するとJSONLイベントをstdoutに即座にemit。Telegramボット、ログアグリゲータ、ダッシュボードなど何にでもパイプ可能。

## バージョン変遷

| バージョン | アプローチ |
|-----------|----------|
| **v0.1.0** | Extension → Bridge HTTP API → SDK |
| **v0.1.3** | Offlineのみ — 自前のLS spawn、IDE不要 |
| **v0.2.0** | **ハイブリッド** — IDEが起動中ならlive sync(!)、なければoffline spawn(!!) |

## クイックスタート

### ワンライナーインストール

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

## デモ

<div align="center">
  <img src="../screenshots/screen-recoding-2026-04-12-02.55.33.gif" alt="antigravity-cli デモ — ターミナルからAntigravityセッションまで" />
</div>

---

## なぜ必要？

### 1. Antigravityのクォータを合法的に活用

Antigravity Pro/ULTRAは**Opus**を提供しますが、IDE内でしか使えません。

OpenClaw、プロキシ、opencodeなどのツールがAntigravityのOAuthトークンを抜き出して外部で使おうとし、**Googleはそれらのアカウントを大量BANしました。**

**このCLIはトークンを抜き出しません。**
Antigravity.appに内蔵された公式LSバイナリを直接実行し、IDEがローカルに保存した認証情報（`state.vscdb`）をそのまま使用します。アカウントBAN？ゼロリスク。

### 2. 他のエージェントからAntigravityをサブエージェントとして召喚

Claude CodeやCodexで作業中：

```bash
# Claude Code内からAntigravityのOpusに別タスクを投げる
antigravity-cli "このモジュールをリファクタリングして"
antigravity-cli -b "テストコードを書いて"     # バックグラウンド — UI表示スキップ
```

メインエージェントがメインタスクに集中している間、**Antigravityが並列でサブタスクを処理します。**

### 3. Antigravity内でもサブエージェントとしてコンテキストを分離

Antigravityで長いセッションを続けると：
- **コンテキスト爆発** — 一つの会話にあれこれ詰め込むとトークンが膨らみ品質が低下
- **フロー中断** — 「ちょっとこれだけ」と割り込むとコンテキストが絡まる

このCLIで別のサブエージェントを召喚すれば、**メインの会話コンテキストを汚染せず**に別タスクを投げられます。

*一つのエージェントに全部詰め込まない。コンテキストも効率的に管理しよう。*

---

## 何ができる？

| コマンド | → | 効果 |
|---------|---|------|
| `antigravity-cli "リファクタリングして"` | → | **新セッション**を作成、レスポンスを待機 |
| `antigravity-cli -r` | → | 現在のワークスペースの**セッション一覧** |
| `antigravity-cli -r <cascadeId> "続けて"` | → | 既存セッションを**再開** |
| `antigravity-cli -b "素早く回答"` | → | **UI表示登録をスキップ** |
| `antigravity-cli -j "要約して"` | → | **JSONL transcriptイベント出力** |
| `antigravity-cli auth list` | → | **アカウント一覧** + GEMINI/CLAUDEクォータ状態 |
| `antigravity-cli auth login` | → | Antigravityアプリで**新規managedアカウント追加** |

**ポイント：** Antigravity IDEが起動中なら**既存のLSに直接接続**してUIに即反映。IDEがなければ**自前でLSをspawn**し、内蔵extension shimで認証を注入 — IDEウィンドウ不要。

---

## インストール

### ワンライナー

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

実行内容：
- `~/.antigravity-cli/source`にリポをcloneまたは更新
- `bun install`で依存関係をインストール
- `~/.local/bin`に`antigravity-cli`と`agcl`（短縮エイリアス）のシンボリックリンクを作成
- `antigravity-cli --help`でインストールを検証

**必須：** macOS、Antigravity.appインストール済み＋少なくとも1回サインイン、Git、[Bun](https://bun.sh)

> **更新？** 同じコマンドを再実行するだけ。

### 手動インストール

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli/source
cd ~/.antigravity-cli/source
bun install
chmod +x src/main.ts src/entrypoints/cli.ts
mkdir -p ~/.local/bin
ln -sf ~/.antigravity-cli/source/src/entrypoints/cli.ts ~/.local/bin/antigravity-cli
```

`~/.local/bin`が`PATH`にない場合は追加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 使い方

```bash
antigravity-cli 'hello'                               # または: agcl 'hello'
antigravity-cli "hello"                               # または: agcl "hello"
antigravity-cli hello world                           # 引用符なし — 自動結合
antigravity-cli 'review this code'                    # 新しい会話を作成
antigravity-cli 'write tests' --model flash           # または: agcl -m flash 'write tests'
antigravity-cli --resume                              # または: agcl -r ⭢ セッション一覧
antigravity-cli --resume <cascadeId> 'continue'       # または: agcl -r <cascadeId> 'continue'
antigravity-cli --background 'quick task'             # または: agcl -b 'quick task'
antigravity-cli --json 'summarize this'               # または: agcl -j 'summarize this' ⭢ JSONL → stdout
antigravity-cli --help                                # または: agcl -h

# アカウント管理
antigravity-cli auth list                             # または: agcl auth list ⭢ アカウント + クォータ表示
antigravity-cli auth login                            # または: agcl auth login ⭢ 新規アカウント追加

# Stdinパイプ — シェルエスケープ問題(!, "等)を回避
antigravity-cli -                                     # 明示的stdinマーカー
echo "hello!" | antigravity-cli
cat prompt.txt | antigravity-cli
```

---

## サポートオプション

| オプション | 説明 |
|----------|------|
| *(`--model`省略時)* | **IDEで最後に使ったモデルを自動適用** — IDEでモデルを変えるとCLIも追従 |
| `"メッセージ"` | 新しい会話を作成（複数ワードは自動結合） |
| `-m, --model <モデル>` | 会話モデル指定（デフォルト：IDEの最終使用モデル） |
| `-r, --resume` | セッション一覧 |
| `-r, --resume [cascadeId] "メッセージ"` | cascadeId（UUID）でセッション再開 |
| `-b, --background` | UI表示登録スキップ |
| `-j, --json` | transcriptイベントをJSONLでstdoutに出力 |
| `--timeout-ms <数値>` | タイムアウトオーバーライド（ミリ秒、デフォルト：120000） |
| `-h, --help` | ヘルプ表示 |
| `auth list` | アカウント一覧 + GEMINI/CLAUDEクォータプログレスバー |
| `auth login` | Antigravityアプリで新規managedアカウント追加 |

**サポートモデル：**
- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

`--model`を省略すると、CLIが**Antigravity IDEで最後に選択したモデルを自動的に使用**します（`state.vscdb`から読み取り）。IDEでモデルを変えるとCLIも追従 — フラグ不要。

---

## Transcript

すべての会話は`--json`の有無にかかわらずJSONLで自動保存されます。

```
~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl
```

公式Antigravity IDEはtranscriptを公開していません。このCLIは[Claude Code](https://docs.anthropic.com/en/docs/claude-code)の慣例（`~/.claude/projects/…/<sessionId>.jsonl`）に従い、会話履歴をファイルとして残します。grep、replay、パイプなど同じ方法で活用できます。

plainモードセッション終了後、以下のガイダンスが表示されます：

```
cascadeId: 8ed28f7a-…
transcript_path: ~/.antigravity-cli/projects/-Users-…/8ed28f7a-….jsonl

To continue this session, run antigravity-cli --resume 8ed28f7a-… '<message>'
```

---

## 動作原理

CLIが実行パスを自動的に判断します：

```
                      antigravity-cli
                            │
                  argv / config / model
                            │
                 live Language Server探索
                            │
                 ┌──────────┴──────────┐
                 │                     │
           LSが起動中？           LSが見つからない？
                 │                     │
          ⭢ Live Sync           ⭢ Offline Spawn
                 │                     │
          IDEの既存LSに          自前のLS spawn +
          直接接続               extension shim注入
                 │                     │
                 └──────────┬──────────┘
                            │
                 ConnectRPC (HTTPS)
                            │
                 StartCascade → stream
                 → steps → transcript
```

### パスA — Live Sync（IDE起動中）

1. プロセス探索（`ps` + `lsof`）で起動中のLSを発見
2. live discoveryファイルからCSRFトークンとHTTPSポートを抽出
3. 既存のLSに**ConnectRPC**で直接接続 — spawnなし、fake serverなし
4. 会話がIDE UIに即座に反映
5. `state.vscdb`には**触れない** — IDEが自前で管理

### パスB — Offline Spawn（IDE無し）

1. **`state.vscdb`**からOAuthトークン、モデル設定、USS topicバイトを読み取り
2. `Antigravity.app`の**LSバイナリ**をspawnし、stdinでprotobufメタデータを渡す
3. **内蔵extension shim**が逆方向RPC処理（USS認証ハンドオフ、heartbeat）
4. spawnされたLSに**ConnectRPC** over HTTPS（自己署名`cert.pem`）で通信
5. agent stateの更新をストリーミングし、会話進行に応じてtrajectory stepsを取得
6. 後処理：`trajectorySummaries`を`state.vscdb`にhydrationして後でIDEから見えるように

**Bridge Extension不要。** IDEウィンドウの有無に関わらず、LSバイナリと直接通信します。

---

## 注意事項

- `--model`を省略すると、CLIが**IDEの最終使用モデルを自動追従** — IDEでモデルを変えるとCLIも追従。
- `--background`はUI表示登録をスキップ（`trajectorySummaries` hydrationなし）。
- 複数ワードを引用符なしで並べると自動的にスペースで結合 — 引用符はオプション。
- stdinパイプ（`echo "プロンプト" | agcl`）で`!`、`"`等のシェルエスケープ問題を回避可能。
- Antigravity.appがインストール済みで、少なくとも1回サインイン必要（`state.vscdb`に依存）。
- IDEが起動中なら**既存のLSに接続**。なければ**LSインスタンスを新規spawn**（1:1ワンショット）。

---

## Contributors

このプロジェクトはAIエージェントと共に構築しました。

| | 役割 |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | 設計、ディレクション、検証 |
| **[Antigravity](https://antigravity.google)** | 実装、デバッグ、リファクタリング |
| **[Codex](https://openai.com/codex)** | protobuf分析、コードレビュー |

---

## ライセンス

AGPL-3.0-or-later
