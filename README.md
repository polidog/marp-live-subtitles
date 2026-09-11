# Marp Live Subtitles

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
components/Subtitle.tsx
lib/
  audio/capture.ts               getUserMedia → AudioWorklet → 16kHz PCM16 100ms チャンク
  translation/provider.ts        TranslationProvider インターフェース + factory (spec2 §4)
  translation/types.ts           TranslationConfig / TranscriptEvent / TranslationError (spec2 §5, §16, §38)
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

**字幕の寿命** — final は 4 秒 hold してから 500 ms かけて fade out。次の字幕が来たら fade をキャンセルする（spec2 §24）。

## 未実装

- **Ephemeral token / Backend token endpoint**（spec2 §13, §14, §40）— Production 配布時の課題。MVP は Options に入れた API Key を直接使う
- **翻訳音声の再生**（spec2 §25, §26）— `enableTranslatedAudio` は常に false。Gemini が返す音声は破棄する
- Audience Mode / 複数言語同時 / Local Mode / Transcript export / Speaker Notes context

spec2 で Gemini に一本化したため、旧 spec の OpenAI Realtime STT + Chat Completions 翻訳と Web Speech フォールバックは削除した。Glossary は Gemini Live Translate に注入する口がないため設定から外し、スライドのキーワード抽出（`marp/context.ts`）だけ残してある。
