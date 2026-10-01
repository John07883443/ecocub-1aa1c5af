/**
 * Голос «Архитектора Льва» через InWorld Realtime. Браузер говорит только с
 * сервером пилота (ws://localhost:8790/voice), ключ InWorld — на сервере.
 * Протокол и приёмы — как в МедиаМашине (LiveVoiceSession.tsx), без её UI.
 */
import { PILOT } from "../pilot.config.ts";

export type VoiceState =
  "idle" | "connecting" | "ready" | "listening" | "thinking" | "speaking" | "closed";

/** Подпись состояния для панели голоса. */
export const VOICE_STATE_RU: Record<VoiceState, string> = {
  idle: "выключен",
  connecting: "подключаюсь…",
  ready: "готов — удерживайте кнопку и говорите",
  listening: "слушаю",
  thinking: "думаю…",
  speaking: "говорит",
  closed: "выключен",
};

/** Тишина дольше этого в голосовом режиме — сессия закрывается сама (экономим минуты). */
export const VOICE_IDLE_MS = 60_000;

export interface VoiceHandlers {
  onState: (s: VoiceState, detail?: string) => void;
  onUserText: (t: string) => void;
  onAssistantText: (t: string) => void;
  /** Вызов инструмента: вернуть строку-результат для модели. */
  onToolCall: (name: string, args: unknown) => Promise<string>;
}

const OUTPUT_RATE = 24000;

function b64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class VoiceSession {
  private ws: WebSocket | null = null;
  private capture: AudioContext | null = null;
  private playback: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nextPlay = 0;
  private sending = false;
  private handledCalls = new Set<string>();
  private greeted = false;
  private lastActivity = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private speaking = false;

  constructor(
    private url: string,
    private h: VoiceHandlers,
    private opts: {
      instructions: () => string;
      tools: unknown[];
      continuous: boolean;
      /** Первая служебная реплика: что сказать при подключении. */
      greeting?: () => string;
      /** LLM внутри InWorld Realtime (с сервера: PILOT_REALTIME_MODEL). */
      model?: string;
    },
  ) {}

  private touch() {
    this.lastActivity = Date.now();
  }

  /** Обновить инструкции (анкета, дом, бюджет поменялись) без переподключения. */
  updateInstructions() {
    if (!this.greeted) return;
    this.send({
      type: "session.update",
      session: { type: "realtime", instructions: this.opts.instructions() },
    });
  }

  async start() {
    this.h.onState("connecting");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.capture = new AudioContext({ sampleRate: 24000 });
    this.playback = new AudioContext();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onclose = (e) => {
      this.h.onState("closed", e.reason || `код ${e.code}`);
      this.cleanup();
    };
    ws.onerror = () =>
      this.h.onState("closed", "сервер пилота недоступен — запущен ли npm run pilot?");
    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      void this.onMessage(msg);
    };
    await this.startMic();
    if (this.opts.continuous) {
      this.idleTimer = setInterval(() => {
        if (!this.speaking && Date.now() - this.lastActivity > VOICE_IDLE_MS) {
          this.h.onState("closed", "минуту тишины — голосовой режим выключен");
          this.stop();
        }
      }, 5000);
    }
  }

  private send(o: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  private async startMic() {
    const ctx = this.capture!;
    const chunk = Math.round(ctx.sampleRate / 10);
    const code = `class P extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}
process(i){const c=i[0]&&i[0][0];if(!c)return true;const p=new Int16Array(c.length);
for(let k=0;k<c.length;k++){const s=Math.max(-1,Math.min(1,c[k]));p[k]=s<0?s*0x8000:s*0x7fff}
this.b.push(p);this.n+=p.length;if(this.n>=${chunk}){const o=new Int16Array(this.n);let f=0;
for(const x of this.b){o.set(x,f);f+=x.length}this.b=[];this.n=0;this.port.postMessage(o.buffer,[o.buffer])}return true}}
registerProcessor('pcm',P)`;
    const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, "pcm");
    node.port.onmessage = (e) => {
      if (this.opts.continuous || this.sending)
        this.send({
          type: "input_audio_buffer.append",
          audio: b64FromBuffer(e.data as ArrayBuffer),
        });
    };
    ctx.createMediaStreamSource(this.stream!).connect(node);
    node.connect(ctx.destination);
  }

  /** Нажми и говори: начать. */
  pressTalk() {
    this.touch();
    this.stopSpeech();
    this.sending = true;
    this.h.onState("listening");
  }

  /** Нажми и говори: отпустить — отправить реплику. */
  releaseTalk() {
    if (!this.sending) return;
    this.sending = false;
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
    this.h.onState("thinking");
  }

  /** Служебное сообщение модели (например, «человек нажал кнопку X»). */
  notify(text: string) {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `[служебное, не произноси] ${text}` }],
      },
    });
  }

  private stopSpeech() {
    this.speaking = false;
    if (!this.playback) return;
    this.nextPlay = 0;
    void this.playback.close();
    this.playback = new AudioContext();
  }

  private play(b64: string) {
    const ctx = this.playback!;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      pcm[i] = v >= 0x8000 ? v - 0x10000 : v;
    }
    const buf = ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (this.nextPlay < now + 0.05) this.nextPlay = now + 0.15;
    src.start(this.nextPlay);
    this.nextPlay += buf.duration;
  }

  private async onMessage(msg: Record<string, unknown> & { type?: string }) {
    switch (msg.type) {
      case "session.created":
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            model: this.opts.model || PILOT.architect.realtimeModel,
            instructions: this.opts.instructions(),
            output_modalities: ["audio", "text"],
            audio: {
              input: {
                format: { type: "audio/pcm", rate: this.capture?.sampleRate ?? 24000 },
                transcription: { model: PILOT.architect.sttModel, language: "ru" },
                turn_detection: this.opts.continuous
                  ? {
                      type: "semantic_vad",
                      eagerness: "medium",
                      create_response: true,
                      interrupt_response: true,
                    }
                  : null,
              },
              output: { model: PILOT.architect.ttsModel, voice: PILOT.architect.voice, speed: 1 },
            },
            tools: this.opts.tools,
            providerData: {
              tts: {
                delivery_mode: "STABLE",
                segmenter_strategy: "full_turn",
                conversational: true,
              },
            },
          },
        });
        break;
      case "session.updated":
        // Повторный session.updated — это обновление инструкций, а не новое подключение.
        if (this.greeted) break;
        this.greeted = true;
        this.touch();
        this.h.onState(this.opts.continuous ? "listening" : "ready");
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  this.opts.greeting?.() ??
                  "[служебное] Поздоровайся одной фразой и спроси, кто будет жить в доме.",
              },
            ],
          },
        });
        this.send({ type: "response.create" });
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (typeof msg.delta === "string") {
          this.touch();
          if (!this.speaking) this.h.onState("speaking");
          this.speaking = true;
          this.play(msg.delta);
        }
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (typeof msg.transcript === "string") this.h.onAssistantText(msg.transcript);
        break;
      case "response.done":
        this.touch();
        // Ответ дозвучит из буфера; сразу снова слушаем (в режиме без кнопки).
        this.speaking = false;
        this.h.onState(this.opts.continuous ? "listening" : "ready");
        break;
      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.committed":
        this.touch();
        this.h.onState("thinking");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof msg.transcript === "string" && msg.transcript.trim())
          this.h.onUserText(msg.transcript);
        break;
      case "input_audio_buffer.speech_started":
        // Перебили — Лев замолкает сразу (barge-in).
        this.touch();
        this.stopSpeech();
        this.h.onState("listening");
        break;
      case "response.function_call_arguments.done": {
        const callId = String(msg.call_id ?? "");
        if (!callId || this.handledCalls.has(callId)) break;
        this.handledCalls.add(callId);
        let args: unknown = {};
        try {
          args = JSON.parse(String(msg.arguments ?? "{}"));
        } catch {
          args = {};
        }
        const output = await this.h.onToolCall(String(msg.name ?? ""), args);
        this.send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output },
        });
        this.send({ type: "response.create" });
        break;
      }
      case "error":
        this.h.onState("ready", `InWorld: ${JSON.stringify(msg.error ?? msg).slice(0, 160)}`);
        break;
    }
  }

  stop() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.ws?.close();
    this.cleanup();
  }

  private cleanup() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.capture?.close().catch(() => {});
    void this.playback?.close().catch(() => {});
    this.capture = null;
    this.playback = null;
    this.stream = null;
  }
}
