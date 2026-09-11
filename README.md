# Live Subtitles

Marp で作った HTML プレゼンテーションの上に、発表者の音声をリアルタイム翻訳して字幕表示する Chrome Extension。

日本語で普通に話すだけで、スライド上に英語字幕が出る。

```
Japanese Speech → Chrome Microphone → AudioWorklet (16kHz PCM16)
  → Gemini Live Translation → outputTranscription → Subtitle State → Marp Overlay
```

翻訳バックエンドは Google Gemini Live API。
Gemini は `responseModalities: ["AUDIO"]` で動かしつつ、`outputAudioTranscription` から翻訳テキストだけを取り出す。翻訳音声は MVP では破棄する。

setup の組み立ては 2 段構え：

1. spec2 §6 の `translationConfig`（Live Translate 専用フィールド）
2. サーバーが `Unknown name "translationConfig"` で弾いたら、`systemInstruction` に spec §19 の翻訳プロンプトを入れて張り直す（spec2 §29 の代替戦略）。通常の Live モデルはこちらで動く

どちらが使われたかは background のコンソールの `[MLS] offscreen: setup 送信 ok — ..., strategy: ...` に出る。モデル名は Options の「この API Key で使える Live モデルを取得」で `bidiGenerateContent` 対応のものを引ける。

## セットアップ

```bash
pnpm install
pnpm dev          # 開発用 Chrome を起動（HMR あり）
pnpm build        # .output/chrome-mv3 に production build
pnpm build:embed  # dist/live-subtitles.js（拡張なしでスライドに埋め込む版）
pnpm test         # Translation Committer のテスト
pnpm compile      # 型チェック
```

`pnpm build` した `.output/chrome-mv3` を `chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で読み込む。

ローカルの HTML ファイル（`file://`）で使う場合は、拡張機能の詳細から **「ファイルの URL へのアクセスを許可する」** を ON にする。

## 使い方

1. Options を開く（Popup 右下の `Options`）
2. **マイクを許可する** を押して権限を与える（offscreen document からは権限プロンプトを出せないため、ここで一度だけ許可する）
3. Gemini API Key を入力する（Development Mode 専用。API Key を含んだビルドを配布しないこと）
4. Marp の HTML を開く
5. Popup で **Start Subtitles**

Marp HTML の作り方:

```bash
npx @marp-team/marp-cli slide.md --html -o slide.html
```

## 拡張なしで使う（Marp の HTML に埋め込む）

同じ字幕を、Chrome Extension を入れずにスライド側の `<script>` だけで出せる。

```bash
pnpm build:embed        # dist/live-subtitles.js（1 ファイル）
```

Marp の Markdown にタグを 1 行入れて、`--html` でビルドする。

```markdown
<script src="./live-subtitles.js" data-target-lang="en"></script>
```

```bash
marp slide.md --html -o slide.html
marp -s .               # http://localhost:8080 で配る
```

**`file://` では動かない。** Chrome はページからのマイク取得を `file://` で拒否するので、
`marp -s` などで `http://localhost` 経由にする（拡張版が offscreen document を持っているのは、
この制限を迂回して `file://` のスライドでもマイクを開くため）。

- **Shift+S** で開始 / 停止。`window.liveSubtitles.start()` / `.stop()` でも叩ける
- API Key は `data-api-key="..."`、または `localStorage.setItem("mls:apiKey", "...")`。
  デッキを公開する場合、`data-api-key` に書いた Key はそのまま漏れる
- `data-*` は Settings のキーがそのまま入る（`data-font-size="36"`, `data-mode="both"`,
  `data-provider="webspeech-gemini-text"`, `data-auto-start` など）
- 接続中とエラーは右上に小さく出る

拡張版との違いは 3 つだけ: 自分が書き出したデッキにしか効かない / `file://` 不可 /
設定 UI の代わりに `data-*`。翻訳・字幕まわりの実装 (`lib/translation`, `components`) は共通。

## 字幕モード

- **Translation Only**（既定）— 英語字幕のみ
- **Original + Translation** — 日本語（`inputTranscription`）+ 英語
- **Original Only** — 日本語のみ（STT 確認用）

`inputTranscription` は本来 Debug / latency 計測用なので、通常は Translation Only で使う。

## 構成

```
entrypoints/
  background.ts     lifecycle / routing / state (spec §16, §31)
  content.tsx       Marp 検出・字幕描画・fullscreen 追従 (spec §8, §28)
  offscreen/        マイク + Translation Provider (spec §16, spec2 §7)
  popup/  options/  UI (spec §26-27, spec2 §34-35)
components/
  Subtitle.tsx          字幕の見た目
  SubtitleOverlay.tsx   ロールアップ / hold / fade（拡張と embed で共通）
embed/main.tsx          Marp の HTML に直接読み込む版 (pnpm build:embed)
lib/
  audio/capture.ts               getUserMedia → AudioWorklet → 16kHz PCM16 100ms チャンク
  translation/provider.ts        TranslationProvider インターフェース + factory (spec2 §4)
  translation/types.ts           TranslationConfig / TranscriptEvent / TranslationError (spec2 §5, §16, §38)
  translation/pipeline.ts        マイク → Provider → Committer の Start/Stop (offscreen と embed で共通)
  translation/committer.ts       partial / stable / final、duplicate & stale 抑制 (spec2 §20-23)
  translation/gemini/
    provider.ts   GeminiLiveTranslationProvider（ターン管理・latency・再接続）
    client.ts     WebSocket トランスポート
    protocol.ts   setup / realtimeInput / serverContent の組み立てと解釈
    config.ts     モデル・エンドポイント・音声フォーマット・バックオフ
    audio.ts      PCM16 → base64
    errors.ts     TranslationErrorCode への分類
  marp/detector.ts   複数シグナルによる Marp 判定 (spec §9)
  marp/slide.ts      現在スライド検出とコンテキスト抽出 (spec §22-24)
  marp/context.ts    スライド → キーワード抽出 → Local Context State (spec2 §28)
  messaging/messages.ts  chrome.runtime messaging (spec §30, spec2 §16)
public/pcm16-worklet.js  リサンプル + Int16 変換 + 100ms チャンク化
stores/settings.ts
```

## 設計上のポイント

**Translation Provider の抽象化** — `Subtitle Renderer` は Provider を知らない（spec2 §29）。Gemini Live Translate が context injection に向かないので、`updateContext()` は「渡すだけ」の口として用意してある。STT + LLM 構成へ切り替えるときは `createTranslationProvider()` に 1 行足す。

**Translation Committer** — Gemini はストリーミングで翻訳 transcript を刻んで返す。DOM に直結せず一度 Subtitle State を通し、duplicate suppression（同じ内容を送り直さない）、stale 破棄（確定より古いイベントを捨てる）、flicker reduction（空文字で字幕を消さない）を行う。同じ partial が 2 回続いたら `stable` に上げる。

**AudioWorklet** — ScriptProcessorNode は使わない。`AudioContext({sampleRate: 16000})` でブラウザ側にリサンプルさせ、端末都合で 44.1/48 kHz になった場合は worklet 内で線形補間して間引く。リサンプルを main thread ではなく worklet で行うのは spec2 §9 の狙い（main thread の負荷低減・latency 安定化）に沿うため。

**Latency** — `First Subtitle Latency` = ターン最初の音声チャンクを掴んだ時刻 → 最初の `outputTranscription` 到着。VAD を持たないので発話直前の無音ぶんを含む近似値（`provider.ts` の `ponytail:` コメント参照）。

**API Key** — offscreen document は `chrome.runtime` 以外の拡張 API を使えない（`chrome.storage` が存在しない）ため、storage を読むのは background service worker と options ページだけ。API Key と設定は START メッセージに載せて offscreen へ渡す。content script・DOM・localStorage には渡さない（spec §32 / spec2 §12）。

**Marp 操作を奪わない** — 字幕は shadow DOM 内の `pointer-events: none` な overlay。キー操作は Marp 側へ素通しする。

**字幕の寿命とロールアップ** — テレビの生字幕と同じ方式。確定した文は下段に流れ込み、`maxLines`（既定 2 行）の表示枠から溢れた古い行は上へ押し出されて消える。1 枚を丸ごと差し替えないので、文の切り替わりで画面が空白にならない。

枠の切り方は CSS だけ（`max-height: maxLines × line-height` + `justify-content: flex-end` + `overflow: hidden`）で、行送りのタイマーは持たない。翻訳中の文は末尾に破線付きで続き、確定すると破線が消えてそのまま定着する。

更新が途切れたときだけ消える: 最後の字幕から 4 秒 hold → 500 ms で fade out（spec2 §24）。次の字幕が来たら fade をキャンセルする。消えたあとは在庫も捨てるので、次の発話は 1 行目から始まる。

## 未実装

- **Ephemeral token / Backend token endpoint**（spec2 §13, §14, §40）— Production 配布時の課題。MVP は Options に入れた API Key を直接使う
- **翻訳音声の再生**（spec2 §25, §26）— `enableTranslatedAudio` は常に false。Gemini が返す音声は破棄する
- Audience Mode / 複数言語同時 / Local Mode / Transcript export / Speaker Notes context

spec2 で Gemini に一本化したため、旧 spec の OpenAI Realtime STT + Chat Completions 翻訳と Web Speech フォールバックは削除した。Glossary は Gemini Live Translate に注入する口がないため設定から外し、スライドのキーワード抽出（`marp/context.ts`）だけ残してある。
