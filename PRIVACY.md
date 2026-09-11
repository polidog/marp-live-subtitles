# Privacy Policy — Live Subtitles

Live Subtitles は、発表者の音声をリアルタイムで翻訳し、Marp プレゼンテーション上に字幕として表示する Chrome 拡張です。

## 収集するデータ

- **マイク音声**: 字幕を開始している間だけ録音し、翻訳のために Google Gemini API (`generativelanguage.googleapis.com`) へストリーミング送信します。停止すると録音と送信を止めます。
- **スライドの文章**: 翻訳精度を上げるため、開いているスライドの見出しと本文を Gemini API へ送ります。
- **Gemini API Key**: ユーザーが Options 画面で入力したものを `chrome.storage.local` に保存します。拡張の外へは Google Gemini API への認証以外に送りません。

## 収集しないデータ

- 音声・字幕・スライド内容を開発者のサーバーへ送ることはありません。開発者はサーバーを運用していません。
- 閲覧履歴やアカウント情報を収集しません。

## 第三者への送信

送信先は Google Gemini API のみです。送信したデータの扱いは [Google の利用規約とプライバシーポリシー](https://ai.google.dev/gemini-api/terms) に従います。

## データの保存

設定と API Key は端末内の `chrome.storage.local` にのみ保存され、拡張をアンインストールすると削除されます。音声と字幕は保存しません。

## 連絡先

https://github.com/polidog/marp-live-subtitles/issues
