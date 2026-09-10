# Marp Live Subtitles
## Gemini Live Translation Integration Addendum

**Document Type:** Addendum / 差分仕様  
**Applies To:** `Marp Live Subtitles - Chrome Extension Specification`  
**Provider:** Google Gemini Live API  
**Primary Model:** `gemini-3.5-live-translate-preview`  
**Status:** Draft  
**Priority:** MVP Translation Backend

---

# 1. このドキュメントの位置づけ

本ドキュメントは、既存の

`Marp Live Subtitles - Chrome Extension Specification`

を置き換えるものではない。

開発は以下の順序で行う。

```text
Base Specification
      ↓
Chrome Extension / Marp Integration
      ↓
Subtitle Overlay
      ↓
Microphone Pipeline
      ↓
本 Addendum を適用
      ↓
Gemini Live Translation
```

つまり、

1. 既存仕様に従って Chrome Extension の基本構造を実装する
2. Marp 上への字幕 Overlay を完成させる
3. Microphone capture を実装する
4. Translation Provider として Gemini Live Translation を追加する

という順序とする。

---

# 2. 目的

MVP の翻訳エンジンとして Google Gemini Live Translation を利用する。

目標となるデータフローは以下。

```text
Japanese Speech
      ↓
Chrome Microphone
      ↓
Audio Processing
      ↓
Gemini Live Translation
      ↓
English Output Transcript
      ↓
Subtitle State
      ↓
Marp Subtitle Overlay
```

MVP では Gemini が生成する翻訳音声は再生しない。

使用するのは主に、

```text
outputTranscription
```

で得られる翻訳テキストとする。

---

# 3. 採用モデル

初期モデル:

```text
gemini-3.5-live-translate-preview
```

このモデルをハードコードせず、設定値として管理する。

例:

```ts
const DEFAULT_TRANSLATION_MODEL =
  "gemini-3.5-live-translate-preview";
```

将来的にモデル名が変更された場合、Translation Provider の内部のみ変更すればよい構成とする。

---

# 4. Translation Provider abstraction

既存仕様の Translation Engine は Provider 非依存に保つ。

以下の interface を導入する。

```ts
export interface TranslationProvider {
  connect(config: TranslationConfig): Promise<void>;

  pushAudio(chunk: ArrayBuffer): void;

  updateContext?(context: PresentationContext): Promise<void>;

  stop(): Promise<void>;

  onInputTranscript(
    callback: (event: TranscriptEvent) => void,
  ): void;

  onOutputTranscript(
    callback: (event: TranscriptEvent) => void,
  ): void;

  onStatus(
    callback: (status: TranslationStatus) => void,
  ): void;

  onError(
    callback: (error: TranslationError) => void,
  ): void;
}
```

Gemini 実装:

```text
TranslationProvider
        │
        └── GeminiLiveTranslationProvider
```

将来的に以下を追加できる。

```text
TranslationProvider
├── GeminiLiveTranslationProvider
├── OpenAIRealtimeTranslationProvider
├── STTLLMTranslationProvider
└── LocalTranslationProvider
```

---

# 5. TranslationConfig

```ts
export type TranslationConfig = {
  sourceLanguage?: string;
  targetLanguage: string;
  model: string;

  inputTranscription: boolean;
  outputTranscription: boolean;

  echoTargetLanguage: boolean;
};
```

初期値:

```ts
{
  sourceLanguage: "ja",
  targetLanguage: "en",
  model: "gemini-3.5-live-translate-preview",

  inputTranscription: true,
  outputTranscription: true,

  echoTargetLanguage: false
}
```

`targetLanguage` には BCP-47 language code を利用する。

例:

```text
en
ja
fr
de
ko
zh
```

---

# 6. Gemini Translation Configuration

Gemini Live Translation の session setup では Translation Config を指定する。

概念的な設定:

```ts
const config = {
  responseModalities: ["AUDIO"],

  inputAudioTranscription: {},

  outputAudioTranscription: {},

  translationConfig: {
    targetLanguageCode: "en",
    echoTargetLanguage: false,
  },
};
```

重要:

```text
responseModalities = AUDIO
```

であっても、`outputAudioTranscription` を有効化することで翻訳 transcript を取得する。

MVP では返却された翻訳音声データは破棄してよい。

---

# 7. Audio Input

ブラウザから microphone を取得する。

```ts
const stream =
  await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
```

Audio Pipeline:

```text
MediaStream
    ↓
Web Audio API
    ↓
AudioWorklet
    ↓
Resampling
    ↓
PCM16
    ↓
Gemini WebSocket
```

---

# 8. Gemini Audio Format

Gemini Live API へ送信する音声は以下を基本とする。

```text
Encoding:
PCM signed 16-bit little endian

Sample Rate:
16 kHz

Channels:
Mono
```

ブラウザの AudioContext が、

```text
44.1 kHz
48 kHz
```

等で動作する場合があるため、16 kHz へ resample する。

---

# 9. AudioWorklet

MVP では ScriptProcessorNode を使用せず、AudioWorklet を利用する。

構成:

```text
Microphone
    ↓
MediaStreamAudioSourceNode
    ↓
AudioWorkletNode
    ↓
Float32 PCM
    ↓
Resampler
    ↓
Int16 PCM
```

目的:

- main thread の負荷低減
- 音声 chunk の安定供給
- UI rendering からの分離
- latency の安定化

---

# 10. Audio Chunk

初期値:

```text
100 ms
```

程度の chunk を送信する。

16 kHz の場合:

```text
16000 samples / second

100 ms
=
1600 samples
```

PCM16 なので、

```text
1600 × 2 byte
=
3200 bytes
```

程度となる。

Chunk size は設定可能にしてもよいが、MVP では固定値でよい。

---

# 11. Gemini Live Connection

Gemini Live API とは WebSocket 接続を利用する。

概念:

```text
Chrome Extension
      ↓
WebSocket
      ↓
Gemini Live API
```

接続 lifecycle:

```text
DISCONNECTED
      ↓
CONNECTING
      ↓
CONFIGURING
      ↓
READY
      ↓
STREAMING
```

---

# 12. Authentication

## Development Mode

ローカル開発初期では Google AI API Key を利用可能とする。

ただし API Key を、

```text
content script
DOM
window
source code
git repository
```

へ埋め込んではならない。

Development build では extension settings から API Key を読み込む方式を許可する。

---

# 13. Production Authentication

Chrome Extension を配布する場合、通常の Gemini API Key を Extension に保持しない。

Production では ephemeral token を利用する。

構成:

```text
Chrome Extension
      ↓
Token Endpoint
      ↓
Application Backend
      ↓
Gemini Auth Token API
      ↓
Ephemeral Token
      ↓
Chrome Extension
      ↓
Gemini Live API
```

Extension が保持するのは短命 token のみとする。

---

# 14. Backend Token Endpoint

将来的な Production backend:

```text
POST /api/gemini/token
```

Response:

```json
{
  "token": "...",
  "expiresAt": "..."
}
```

Backend の責務:

```text
Gemini API Key
Authentication
Token Generation
Rate Limiting
Usage Limits
```

---

# 15. WebSocket Session

Connection 開始後、最初に setup message を送信する。

概念:

```text
WebSocket OPEN
       ↓
SETUP
       ↓
SETUP COMPLETE
       ↓
AUDIO STREAM
```

setup 完了前に microphone audio を送信しない。

---

# 16. Runtime Messages

Gemini Provider から Extension 内部へ送るイベントを標準化する。

```ts
export type TranscriptEvent = {
  text: string;

  final: boolean;

  timestamp: number;
};
```

Extension Message:

```ts
type TranslationMessage =
  | {
      type: "TRANSLATION_INPUT";
      payload: TranscriptEvent;
    }

  | {
      type: "TRANSLATION_OUTPUT";
      payload: TranscriptEvent;
    }

  | {
      type: "TRANSLATION_STATUS";
      status: TranslationStatus;
    }

  | {
      type: "TRANSLATION_ERROR";
      error: TranslationError;
    };
```

---

# 17. inputTranscription

Gemini が認識した入力音声 transcript を Debug 用に利用する。

例:

```text
Input

今日は新しいサービスを紹介します
```

通常の Presentation Mode では表示しない。

用途:

```text
Debug
Latency measurement
STT accuracy check
Logging
```

---

# 18. outputTranscription

翻訳された transcript を字幕として利用する。

例:

```text
Output

Today, I'd like to introduce our new service.
```

これが Marp Overlay に送られる。

---

# 19. Subtitle Data Flow

```text
Gemini
   ↓
outputTranscription
   ↓
Gemini Provider
   ↓
Translation State
   ↓
chrome.runtime message
   ↓
Content Script
   ↓
React Subtitle Component
   ↓
Marp
```

---

# 20. Subtitle State

Gemini 由来の transcript も、直接 DOM に描画しない。

一度 Subtitle State Layer を通す。

```ts
type Subtitle = {
  text: string;

  status:
    | "partial"
    | "stable"
    | "final";

  createdAt: number;

  updatedAt: number;
};
```

---

# 21. Translation Committer

既存仕様の Translation Committer は維持する。

Gemini がストリーミングで返す translation transcript に対して、

```text
Gemini output
     ↓
Translation Committer
     ↓
Subtitle Renderer
```

とする。

責務:

- partial の保持
- final の確定
- duplicate suppression
- stale subtitle の破棄
- flicker reduction

---

# 22. Partial Rendering

Partial translation は即時表示可能とする。

ただし UI 上では、

```text
partial
```

と

```text
final
```

を内部的に区別する。

推奨 UX:

```text
partial:
少し薄い

final:
通常表示
```

ただし MVP では styling difference を省略してもよい。

---

# 23. Duplicate Suppression

Gemini から似た transcript が連続して送られる可能性を考慮する。

例:

```text
Today I'd like

Today I'd like to

Today I'd like to introduce

Today I'd like to introduce our new service
```

DOM node を追加し続けるのではなく、

```text
Current Subtitle
```

を更新する。

---

# 24. Final Subtitle

発話が確定した場合:

```text
CURRENT
↓
FINAL
↓
DISPLAY
↓
HOLD
↓
FADE OUT
```

デフォルト:

```text
Hold:
4 seconds

Fade:
500 ms
```

次の字幕が到着した場合は fade をキャンセルする。

---

# 25. Gemini Audio Output

Gemini Live Translate は翻訳音声を生成可能だが、MVP では再生しない。

```text
Gemini response
├── translated audio → DROP
└── transcript       → USE
```

ただし audio pipeline は将来利用できるよう完全には除去しない。

---

# 26. Future TTS Mode

将来的には以下を可能にする。

```text
Japanese speech
       ↓
Gemini
       ├── English subtitle
       │
       └── English audio
                 ↓
              Speaker
```

Feature Flag:

```ts
enableTranslatedAudio: false
```

MVP では常に false。

---

# 27. Marp Context の扱い

重要:

Gemini Live Translation model は翻訳専用モデルであるため、通常の Agent model のような高度な instruction / tool calling / context orchestration を前提にしない。

したがって MVP では、

```text
Current Slide Context
```

を Gemini Translation model に直接強く依存させない。

既存仕様の Marp Context 機能は維持するが、Translation Provider とは疎結合にする。

---

# 28. Marp Context Phase

最初は以下を実装する。

```text
Current Marp Slide
       ↓
Extract Keywords
       ↓
Local Context State
```

Gemini Translation の精度改善に直接利用できる範囲は Provider capability に応じて適用する。

モデル制約によって利用できない場合でも、

```text
Slide Context extraction
```

自体は削除しない。

---

# 29. Alternative Context Strategy

Gemini Live Translate で十分な context injection ができない場合は、将来的に以下へ切り替えられるようにする。

```text
Audio
 ↓
Gemini Transcribe Live
 ↓
Japanese Transcript
 ↓
Gemini Flash / Translation LLM
 +
Marp Context
 ↓
English Subtitle
```

このため、

```text
TranslationProvider
```

と

```text
Subtitle Renderer
```

を直接結合してはならない。

---

# 30. Provider Selection

Settings に以下を追加する。

```text
Translation Provider

● Gemini Live Translation
○ Custom Provider
```

MVP では Gemini のみ実装する。

Provider ID:

```ts
type TranslationProviderId =
  | "gemini-live-translation";
```

---

# 31. Settings

既存 Options に以下を追加する。

```text
Translation Provider
Gemini Live Translation

Model
gemini-3.5-live-translate-preview

Source Language
Japanese

Target Language
English
```

Advanced:

```text
Show input transcript
Show latency
Log Gemini events
```

---

# 32. API Key Settings

Development Mode:

```text
Gemini API Key

[ **************** ]
```

注意文:

```text
For local development only.
Do not distribute builds containing your API key.
```

---

# 33. Extension Storage

以下の情報は保存可能。

```text
targetLanguage
sourceLanguage
subtitle settings
provider
model
debug settings
```

API Key の保存は Development Mode のみに限定する。

---

# 34. Status UI

Popup status:

```text
Idle
Connecting
Listening
Translating
Reconnecting
Error
```

Presentation Mode では原則 status UI を表示しない。

---

# 35. Debug UI

Debug Mode:

```text
┌──────────────────────────────┐
│ Gemini Live Translation      │
│                              │
│ Status      LIVE             │
│                              │
│ Input                        │
│ 今日はRedisについて...      │
│                              │
│ Output                       │
│ Today I'll talk about Redis  │
│                              │
│ Latency                      │
│ 840 ms                       │
│                              │
│ Audio                        │
│ 16kHz PCM16 Mono             │
└──────────────────────────────┘
```

---

# 36. Latency Measurement

以下を測定する。

```text
audioCaptureTime
firstInputTranscriptTime
firstOutputTranscriptTime
finalOutputTime
```

主要 KPI:

```text
Speech
  ↓
First Visible English Subtitle
```

これを、

```text
First Subtitle Latency
```

と定義する。

---

# 37. Latency Target

MVP 目標:

```text
First partial subtitle:
< 1.5 sec

Stable / final subtitle:
< 3 sec
```

ネットワーク品質に依存するため、絶対保証値ではない。

---

# 38. Error Types

```ts
type TranslationErrorCode =
  | "MIC_PERMISSION_DENIED"
  | "MIC_UNAVAILABLE"
  | "AUTH_FAILED"
  | "TOKEN_EXPIRED"
  | "WEBSOCKET_FAILED"
  | "SESSION_FAILED"
  | "AUDIO_ENCODING_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "UNKNOWN";
```

---

# 39. Reconnection

WebSocket 切断時:

```text
STREAMING
   ↓
DISCONNECTED
   ↓
RECONNECTING
```

指数バックオフ:

```text
1 sec
2 sec
4 sec
8 sec
```

最大:

```text
10 sec
```

程度とする。

---

# 40. Token Expiration

ephemeral token を利用する Production Mode では token expiration を考慮する。

token が期限切れになる前に新しい token を取得する。

ただし Translation session の途中で不用意に connection を切り替えない。

安全な session boundary で reconnect する。

---

# 41. Privacy

マイク音声が Google Gemini API へ送信されることを Start 前に明示する。

例:

```text
Audio will be streamed to Google Gemini
for real-time translation.
```

ユーザーが Stop を押した場合:

```text
MediaStream tracks
WebSocket
AudioContext
AudioWorklet
```

を停止する。

---

# 42. Gemini Provider Directory

既存 directory に以下を追加する。

```text
lib/
└── translation/
    ├── provider.ts
    ├── types.ts
    │
    └── gemini/
        ├── provider.ts
        ├── client.ts
        ├── protocol.ts
        ├── audio.ts
        ├── config.ts
        └── errors.ts
```

---

# 43. 推奨 Directory 全体

```text
marp-live-subtitles/
│
├── entrypoints/
│   ├── background.ts
│   ├── content.tsx
│   │
│   ├── offscreen/
│   │   ├── index.html
│   │   └── main.ts
│   │
│   ├── popup/
│   │   └── App.tsx
│   │
│   └── options/
│       └── App.tsx
│
├── lib/
│   │
│   ├── audio/
│   │   ├── capture.ts
│   │   ├── res
