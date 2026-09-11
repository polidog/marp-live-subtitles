/** spec §16 / spec2 §2, §7, §19, §34, §41 — Microphone と Translation Provider を担う Offscreen Document */
import { onMessage, send } from "../../lib/messaging/messages";
import { formatError } from "../../lib/translation/gemini/errors";
import { TranslationPipeline } from "../../lib/translation/pipeline";
import type { Settings } from "../../types";

let settings: Settings | null = null;

const pipeline = new TranslationPipeline({
  onSubtitle: (out, slideIndex) => {
    send("background", {
      type: "SUBTITLE",
      text: out.text,
      original: out.original,
      status: out.status,
      latencyMs: out.latencyMs,
    });

    if (settings?.debug && out.status === "final") {
      send("background", {
        type: "DEBUG_LOG",
        log: {
          timestamp: Date.now(),
          slide: slideIndex,
          transcript: out.original,
          translation: out.text,
          firstSubtitleLatencyMs: out.latencyMs ?? -1,
          finalOutputLatencyMs: out.latencyMs ?? -1,
        },
      });
    }
  },

  onState: (state, error) => {
    if (error) send("background", { type: "TRANSLATION_ERROR", error });
    send("background", {
      type: "STATUS",
      state,
      ...(error ? { error: formatError(error), code: error.code } : {}),
    });
  },

  onProviderStatus: (status) => send("background", { type: "TRANSLATION_STATUS", status }),

  onTranscript: (direction, payload) =>
    send("background", {
      type: direction === "input" ? "TRANSLATION_INPUT" : "TRANSLATION_OUTPUT",
      payload,
    }),
});

onMessage("offscreen", (msg) => {
  switch (msg.type) {
    case "OFFSCREEN_START":
      settings = msg.settings;
      void pipeline.start({
        settings: msg.settings,
        apiKey: msg.apiKey,
        context: msg.context,
      });
      break;
    case "STOP":
      void pipeline.stop();
      break;
    case "PRESENTATION_CONTEXT":
      // spec §24 / spec2 §27 — セッションは張り直さず context だけ差し替える
      void pipeline.updateContext(msg.context);
      break;
  }
});
