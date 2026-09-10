# Marp Live Subtitles
## Chrome Extension Product Specification

**Status:** Draft  
**Target:** Chrome / Chromium  
**Primary Use Case:** Marp HTML Presentation  
**Version:** 0.1 Specification

---

# 1. 概要

Marp Live Subtitles は、Marp で生成された HTML プレゼンテーション上に、発表者の音声をリアルタイムで文字起こし・翻訳し、字幕として表示する Chrome Extension である。

発表者は日本語で通常通りプレゼンテーションを行う。

Extension が PC のマイク音声を取得し、

```text
Speech
  ↓
Speech-to-Text
  ↓
Translation
  ↓
Subtitle
```

の処理をリアルタイムで実行する。

翻訳された字幕は Content Script によって Marp HTML の DOM 上へ直接描画する。

主な利用イメージ:

```text
発表者

「今日は新しいサービスを紹介します」

                 ↓

┌─────────────────────────────────────┐
│                                     │
│          Marp Presentation          │
│                                     │
│                                     │
│   Today, I'd like to introduce      │
│   our new service.                  │
│                                     │
└─────────────────────────────────────┘
```

---

# 2. プロダクトゴール

目指す体験は、

> 日本語で普通にプレゼンするだけで、Marp スライド上に自然な英語字幕がリアルタイム表示される。

ことである。

単純な音声認識ツールではなく、

**「現在表示しているスライドの内容を理解したリアルタイム翻訳」**

を最終的な差別化要素とする。

---

# 3. MVP ゴール

MVP では以下を実現する。

1. Chrome Extension としてインストールできる
2. Marp HTML を検出できる
3. Marp ページへ字幕 Overlay を挿入できる
4. PC のマイク音声を取得できる
5. 日本語音声をリアルタイム文字起こしできる
6. 日本語を英語へ翻訳できる
7. 英語字幕をリアルタイム表示できる
8. Marp の fullscreen presentation で利用できる
9. Marp のページ送り操作を阻害しない
10. Extension Popup から字幕を ON / OFF できる

---

# 4. 非ゴール

MVP では以下を対象外とする。

- 翻訳音声の読み上げ
- AI 同時通訳音声
- Voice Cloning
- 多人数会話
- Speaker Diarization
- 完全オフライン動作
- Firefox Extension
- Safari Extension
- モバイルブラウザ
- Audience QR Mode
- OBS Plugin
- Zoom Plugin
- Google Meet Plugin

これらは将来的な拡張候補とする。

---

# 5. 基本アーキテクチャ

システム全体は以下の構成とする。

```text
┌──────────────────────────────┐
│ Chrome Extension             │
│                              │
│ ┌──────────────────────────┐ │
│ │ Popup / Settings         │ │
│ └────────────┬─────────────┘ │
│              │               │
│ ┌────────────▼─────────────┐ │
│ │ Background Service       │ │
│ │ Worker                   │ │
│ └────────────┬─────────────┘ │
│              │               │
│ ┌────────────▼─────────────┐ │
│ │ Offscreen Document       │ │
│ │                          │ │
│ │ Microphone               │ │
│ │ Realtime API             │ │
│ │ STT                      │ │
│ │ Translation              │ │
│ └────────────┬─────────────┘ │
│              │               │
│ ┌────────────▼─────────────┐ │
│ │ Content Script           │ │
│ │                          │ │
│ │ Marp Detection           │ │
│ │ Slide Context            │ │
│ │ Subtitle Renderer        │ │
│ └──────────────────────────┘ │
│                              │
└──────────────────────────────┘
```

---

# 6. データフロー

通常時のデータフロー:

```text
Microphone
    ↓
getUserMedia()
    ↓
Audio Stream
    ↓
Realtime Speech Recognition
    ↓
Japanese Transcript
    ↓
Translation
    ↓
English Subtitle
    ↓
chrome.runtime messaging
    ↓
Content Script
    ↓
Subtitle DOM
```

将来的には現在のスライド情報も Translation Context として利用する。

```text
Current Marp Slide
        ↓
Context Extraction
        ↓
Translation Context
        ↑
Japanese Transcript
```

---

# 7. Chrome Extension 構成

Manifest V3 を使用する。

主要コンポーネント:

```text
Extension
├── Background Service Worker
├── Content Script
├── Offscreen Document
├── Popup
└── Options
```

---

# 8. Content Script

Content Script は Marp HTML 内で動作する。

主な責務:

- Marp ページ検出
- 字幕 DOM の生成
- 字幕更新
- fullscreen 対応
- 現在のスライド検出
- スライド内容抽出
- Background との通信

---

# 9. Marp 検出

Extension は現在のページが Marp Presentation か判定する。

判定には複数の条件を利用する。

例:

```text
section
section[data-marpit-fragment]
svg[data-marp-fitting]
marp specific styles
```

単一の DOM selector に強く依存しない。

判定結果:

```typescript
type MarpDetection = {
  detected: boolean;
  slideCount: number;
};
```

Marp が検出されなかった場合も、将来的には Generic Presentation Mode として利用可能にする。

MVP では Marp を優先する。

---

# 10. Subtitle DOM

Content Script は字幕用 DOM をページへ挿入する。

例:

```html
<div id="marp-live-subtitles-root">
  <div class="subtitle">
    Today, I'd like to introduce our new service.
  </div>
</div>
```

React を利用する場合は `marp-live-subtitles-root` に mount する。

---

# 11. Subtitle Overlay

字幕は viewport に対して固定表示する。

基本仕様:

```css
position: fixed;
left: 50%;
bottom: 5vh;
transform: translateX(-50%);
z-index: 2147483647;
pointer-events: none;
```

字幕コンテナ:

```text
width: 80vw
max-width: 1400px
```

表示位置:

```text
bottom center
```

---

# 12. 字幕デザイン

デフォルト:

```text
Font Size:
  36–48px

Lines:
  max 2–3

Background:
  black / semi-transparent

Text:
  white

Alignment:
  center
```

Presentation Mode では可読性を最優先する。

ユーザーが変更可能な項目:

- Font Size
- Position
- Background Opacity
- Max Lines
- Subtitle Width
- Japanese 表示有無

---

# 13. 字幕モード

以下の表示モードを提供する。

## Translation Only

```text
Today, I'd like to introduce our new service.
```

デフォルト。

## Original + Translation

```text
今日は新しいサービスを紹介します

Today, I'd like to introduce our new service.
```

## Original Only

```text
今日は新しいサービスを紹介します
```

主に Debug / STT 確認用途。

---

# 14. 字幕状態

字幕は以下の状態を持つ。

```typescript
type SubtitleState =
  | "listening"
  | "partial"
  | "stable"
  | "committed";
```

## Listening

音声待機。

字幕表示なし。

## Partial

認識途中。

例:

```text
Today I'd like...
```

表示する場合は視覚的に暫定状態と分かるようにする。

## Stable

意味がほぼ確定。

## Committed

確定字幕。

通常表示する字幕は原則として Stable / Committed を利用する。

---

# 15. Microphone

マイク入力には Web Media API を利用する。

```javascript
navigator.mediaDevices.getUserMedia({
  audio: true
});
```

ユーザーによる明示的な microphone permission を必要とする。

---

# 16. Offscreen Document

Manifest V3 の Background Service Worker は常時 Audio Processing を行う用途には適さない。

そのため、マイクおよびリアルタイム音声処理は Offscreen Document へ分離する。

責務:

```text
Microphone Capture
Audio Processing
Realtime API Connection
Speech Recognition
Translation
```

Background Service Worker は lifecycle / routing / state coordination を担当する。

---

# 17. Speech Recognition

MVP の第一候補として OpenAI の realtime-capable API を利用する。

必要要件:

- Streaming Audio Input
- Partial Transcript
- Final Transcript
- Japanese Speech Recognition
- Low Latency

API 実装は Provider Interface の後ろへ隠蔽する。

```typescript
interface SpeechRecognizer {
  connect(): Promise<void>;

  pushAudio(data: ArrayBuffer): void;

  onPartial(
    callback: (text: string) => void
  ): void;

  onFinal(
    callback: (text: string) => void
  ): void;

  disconnect(): Promise<void>;
}
```

これにより将来的に別 Provider へ変更可能にする。

---

# 18. Translation

基本設定:

```text
Source:
Japanese

Target:
English
```

翻訳方針:

- プレゼン向け自然な英語
- 簡潔
- 話し言葉として自然
- 技術用語を保持
- 固有名詞を保持
- 不要な説明を追加しない
- 原文にない情報を追加しない

---

# 19. Translation Prompt

基本 Prompt:

```text
You are a real-time interpreter for a technical presentation.

Translate spoken Japanese into concise and natural English
suitable for presentation subtitles.

Rules:

- Preserve technical terms.
- Preserve product names.
- Prefer short sentences.
- Do not add information.
- Do not explain the translation.
- Avoid unnecessarily long expressions.
- Use the current slide as context when available.
- Output only the translated subtitle.
```

---

# 20. Translation Committer

日本語では文末によって意味が変化する可能性がある。

例:

```text
この機能は去年から開発していたものではありません
```

途中段階:

```text
This is a feature we've been developing since last year...
```

最終:

```text
This isn't something we've been developing since last year.
```

そのため翻訳結果を即座に確定字幕にしない。

内部状態:

```text
UNSTABLE
    ↓
STABLE
    ↓
COMMITTED
```

Translation Committer が字幕確定タイミングを管理する。

---

# 21. Partial Translation

低遅延を実現するため、Partial Transcript から暫定翻訳を生成可能にする。

```text
Japanese partial

今日は新しい

↓

English partial

Today I'd like to...
```

ただし Partial Translation は変更される可能性がある。

UI 上で、

```text
Partial
Stable
```

を区別する。

---

# 22. Current Slide Detection

Content Script は現在表示されている Marp slide を検出する。

取得する情報:

```typescript
type SlideContext = {
  index: number;
  title?: string;
  text: string;
  codeBlocks: string[];
};
```

---

# 23. Slide Context

現在のスライドを翻訳コンテキストへ利用する。

例:

```markdown
# Architecture

- Ruby on Rails
- PostgreSQL
- Redis
- Kubernetes
```

発表者:

```text
ここではレディスを使っています
```

Slide Context があることで、

```text
Redis
```

という固有名詞を認識・翻訳しやすくする。

---

# 24. Context Update

スライド変更を検知した場合:

```text
Slide Change
     ↓
Extract Context
     ↓
Send Context
     ↓
Update Translation Session
```

Context 更新によって Realtime Session 自体を再接続することは避ける。

---

# 25. Glossary

ユーザーが用語集を登録できる。

例:

```json
{
  "Marp": "Marp",
  "Omarchy": "Omarchy",
  "Active Record": "Active Record",
  "PostgreSQL": "PostgreSQL"
}
```

Translation Context に追加する。

将来的には Marp 全体を解析して glossary candidate を自動生成する。

---

# 26. Popup UI

Extension アイコンをクリックすると Popup を表示する。

イメージ:

```text
┌──────────────────────────┐
│ Marp Live Subtitles      │
│                          │
│ ● Marp detected          │
│                          │
│ Microphone               │
│ [ Default Microphone ▼ ] │
│                          │
│ Japanese → English       │
│                          │
│ [ Start Subtitles ]      │
│                          │
│ Status                   │
│ ● Ready                  │
└──────────────────────────┘
```

実行中:

```text
┌──────────────────────────┐
│ Marp Live Subtitles      │
│                          │
│ ● LIVE                   │
│                          │
│ Japanese → English       │
│                          │
│ Latency                  │
│ 0.9 sec                  │
│                          │
│ [ Stop ]                 │
└──────────────────────────┘
```

---

# 27. Options

Options Page では以下を設定可能にする。

## General

```text
Source Language
Target Language
Microphone
```

## Subtitle

```text
Font Size
Position
Opacity
Width
Max Lines
Original Text
```

## Translation

```text
Translation Style
Partial Translation
Glossary
```

## Advanced

```text
API Provider
Debug Mode
Latency Display
```

---

# 28. Fullscreen

Marp Presentation が fullscreen になった場合も字幕を表示する。

Content Script は fullscreen change を監視する。

```javascript
document.addEventListener(
  "fullscreenchange",
  ...
);
```

必要に応じて subtitle root を fullscreen element 配下へ移動する。

---

# 29. Marp 操作との共存

字幕 UI は、

```css
pointer-events: none;
```

を基本とする。

これにより、

- Arrow Right
- Arrow Left
- Space
- Escape
- Fullscreen

など Marp 側の操作を妨げない。

---

# 30. Chrome Messaging

Extension 内部通信には `chrome.runtime` messaging を利用する。

主な Message:

```typescript
type ExtensionMessage =
  | {
      type: "START";
    }
  | {
      type: "STOP";
    }
  | {
      type: "TRANSCRIPT_PARTIAL";
      text: string;
    }
  | {
      type: "TRANSCRIPT_FINAL";
      text: string;
    }
  | {
      type: "TRANSLATION_PARTIAL";
      text: string;
    }
  | {
      type: "TRANSLATION_FINAL";
      text: string;
    }
  | {
      type: "SLIDE_CONTEXT";
      context: SlideContext;
    }
  | {
      type: "ERROR";
      error: string;
    };
```

---

# 31. State Machine

アプリケーション状態:

```text
IDLE
 ↓
REQUESTING_PERMISSION
 ↓
CONNECTING
 ↓
LISTENING
 ↓
TRANSLATING
 ↓
LISTENING
```

エラー時:

```text
LISTENING
 ↓
ERROR
 ↓
RECONNECTING
 ↓
LISTENING
```

停止:

```text
ANY STATE
 ↓
STOPPING
 ↓
IDLE
```

---

# 32. API Key

API Key を Content Script へ渡してはならない。

以下の場所には保存しない。

```text
DOM
window
localStorage
Content Script
```

API 通信は Extension 内部 context から行う。

MVP では Extension storage を利用できるが、本番配布時には API Key 管理方式を再検討する。

---

# 33. Production API Architecture

Chrome Web Store で一般配布する場合、ユーザーへ直接 API Key を要求する方式は避ける。

将来的には、

```text
Chrome Extension
       ↓
Application Backend
       ↓
Realtime Provider
```

の構成を検討する。

Backend の責務:

- Authentication
- Temporary Token
- Rate Limit
- Billing
- Usage Tracking

---

# 34. 技術スタック

## Extension Framework

```text
WXT
```

## Language

```text
TypeScript
```

## UI

```text
React
```

## Build

```text
Vite / WXT
```

## Extension

```text
Chrome Extension
Manifest V3
```

## Audio

```text
Web Media API
Web Audio API
```

## STT / Translation

```text
Realtime API
```

## State

MVP:

```text
Zustand
```

またはシンプルな React state。

---

# 35. ディレクトリ構成

```text
marp-live-subtitles/
│
├── entrypoints/
│   │
│   ├── background.ts
│   │
│   ├── content.tsx
│   │
│   ├── offscreen/
│   │   ├── index.html
│   │   └── main.ts
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   │
│   └── options/
│       ├── index.html
│       ├── main.tsx
│       └── App.tsx
│
├── components/
│   ├── Subtitle.tsx
│   ├── Status.tsx
│   └── Settings.tsx
│
├── lib/
│   ├── audio/
│   │   ├── microphone.ts
│   │   └── processor.ts
│   │
│   ├── realtime/
│   │   ├── client.ts
│   │   └── protocol.ts
│   │
│   ├── translation/
│   │   ├── translator.ts
│   │   └── committer.ts
│   │
│   ├── marp/
│   │   ├── detector.ts
│   │   ├── slide.ts
│   │   └── context.ts
│   │
│   └── messaging/
│       └── messages.ts
│
├── stores/
│   └── settings.ts
│
├── types/
│   └── index.ts
│
├── public/
│
├── wxt.config.ts
├── package.json
└── README.md
```

---

# 36. ログ

Debug Mode では以下を記録する。

```json
{
  "timestamp": 1720000000,
  "slide": 4,
  "transcript": "ここではRedisを利用しています",
  "translation": "We're using Redis here.",
  "sttLatencyMs": 420,
  "translationLatencyMs": 310,
  "totalLatencyMs": 730
}
```

ログはデフォルトでは永続保存しない。

---

# 37. Performance Goals

MVP の目標値:

| Metric | Target |
|---|---:|
| Partial Transcript | < 1 sec |
| Translation Subtitle | < 2 sec |
| Subtitle UI Update | < 50 ms |
| Slide Detection | < 100 ms |
| Slide Context Update | < 500 ms |
| Startup | < 2 sec |

最重要指標は、

```text
Speech
  ↓
Visible English Subtitle
```

までの **End-to-End Latency** とする。

---

# 38. Privacy

音声を外部 API へ送信する場合、ユーザーへ明示する。

Extension は字幕開始前に必ずユーザー操作を要求する。

停止時には、

```text
Microphone Stream
Realtime Connection
Audio Processing
```

をすべて終了する。

---

# 39. Error Handling

## Microphone Permission Denied

Popup:

```text
Microphone permission is required.
```

## API Connection Error

```text
Connection lost.
Reconnecting...
```

## Realtime API Error

自動再接続を試みる。

## Marp Not Detected

```text
Marp presentation not detected.
```

MVP では Start を無効化してもよい。

---

# 40. MVP Development Phases

## Phase 0 — Subtitle Overlay

目的:

Chrome Extension と Marp の統合検証。

実装:

```text
Extension
 ↓
Content Script
 ↓
Marp Detection
 ↓
Subtitle DOM
```

Popup からテキストを入力し、その文字列を Marp 上へ表示する。

### Acceptance Criteria

- Extension を Load Unpacked できる
- Marp を検出できる
- 字幕を表示できる
- fullscreen でも表示できる
- ページ送りを阻害しない

---

## Phase 1 — Microphone + STT

```text
Microphone
 ↓
Realtime STT
 ↓
Japanese Subtitle
```

### Acceptance Criteria

- Microphone permission が取得できる
- 日本語を認識できる
- Partial Transcript が表示される
- Final Transcript が表示される

---

## Phase 2 — Translation

```text
Microphone
 ↓
STT
 ↓
Translation
 ↓
English Subtitle
```

### Acceptance Criteria

- 日本語音声から英語字幕が生成される
- End-to-End Latency が概ね 2 秒以内
- 字幕が自然に更新される

---

## Phase 3 — Translation Committer

```text
Partial Transcript
 ↓
Partial Translation
 ↓
Stable Detection
 ↓
Committed Subtitle
```

目的:

字幕の低遅延と翻訳精度のバランスを取る。

---

## Phase 4 — Marp Context

```text
Current Slide
 ↓
Context Extraction
 ↓
Realtime Translation
```

### Acceptance Criteria

- 現在の slide を検出できる
- slide text を取得できる
- slide change を検出できる
- 翻訳 context を更新できる

---

## Phase 5 — Glossary

Marp 全体から、

```text
Product Names
Libraries
Frameworks
Technical Terms
```

を取得し翻訳コンテキストへ利用する。

---

# 41. MVP 完了条件

以下をすべて満たした時点で MVP 完了とする。

- Chrome Extension として動作する
- Marp HTML を検出できる
- Microphone を利用できる
- 日本語音声をリアルタイム認識できる
- 英語字幕へ翻訳できる
- Marp 上に字幕表示できる
- fullscreen で利用できる
- Marp の操作を阻害しない
- 字幕 ON / OFF が可能
- Partial / Final 字幕を扱える
- 30 分以上連続利用できる
- 接続断から復帰できる

---

# 42. 将来機能

## Generic Web Presentation

Marp 以外にも対応する。

```text
Reveal.js
Slidev
Google Slides
Speaker Deck
```

## Audience Mode

参加者が QR コードから字幕を閲覧。

```text
Speaker
   ↓
Translation Server
   ↓
┌────────┬────────┬────────┐
EN       FR       KO       ZH
```

## Multiple Languages

一つの発表から複数言語へ翻訳。

## TTS

翻訳字幕を音声化する。

## Local Mode

ローカル STT / LLM を利用し、外部 API を必要としないモード。

## Presentation Transcript

発表終了後、

```text
Slide 1
Japanese Transcript
English Translation

Slide 2
Japanese Transcript
English Translation
```

を Markdown として export する。

## Speaker Notes Context

Marp Speaker Notes を翻訳 context として利用する。

## Automatic Glossary

Marp Markdown 全体から専門用語を自動抽出する。

---

# 43. 将来的な理想アーキテクチャ

最終的には、

```text
                 Marp Markdown
                       │
                       ↓
                Presentation Context
                       │
                       ↓
Microphone → Realtime Interpreter
                       │
                       ↓
              Translation Stream
                       │
           ┌───────────┴───────────┐
           ↓                       ↓
    Presenter Subtitle      Audience Stream
           │                       │
           ↓                  EN / FR / KO
     Marp HTML
```

まで拡張可能な設計とする。

---

# 44. プロダクト原則

## Presentation First

汎用文字起こしアプリではなく、プレゼンテーション体験を優先する。

## Low Latency

完全な文章を待つことより、理解可能な字幕を早く表示することを重視する。

ただし意味が逆転するような誤訳は避ける。

## Context Aware

音声だけでなく、

```text
Current Slide
Speaker Notes
Glossary
Presentation Title
```

を翻訳コンテキストとして利用する。

## Invisible UI

発表中に Extension の UI を操作する必要がない状態を理想とする。

## Safe Failure

翻訳に確信が持てない場合、壊れた字幕を確定表示するより、一時的に字幕を遅らせることを優先する。

---

# 45. コアとなる価値

本プロダクトの価値は、

```text
Speech Recognition
+
Translation
+
Marp Integration
```

そのものではない。

本質的には、

> **発表者が自分の言語で自然に話しながら、外国語話者にも同じプレゼンテーション体験を提供すること**

である。

そのため技術的な最重要領域は、

1. End-to-End Latency
2. Translation Stability
3. Slide Context
4. Subtitle Readability

の4点とする。
