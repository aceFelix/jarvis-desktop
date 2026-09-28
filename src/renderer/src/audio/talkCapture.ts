/**
 * 桌面全双工语音采集 —— getUserMedia + AudioWorklet 重采样到 16kHz PCM16。
 *
 * 关键约束（这也是全双工成立的前提）：
 * - `echoCancellation: true`：浏览器内置 AEC，补齐 WebSocket 协议官方标注
 *   "回声消除：无"的短板——AI 外放声音被麦克风重新拾取时由系统级 AEC 消除，
 *   不会触发服务端打断（服务端 VAD 听到的只有用户真实语音）。
 * - 帧格式与 Python 侧 BridgeMic 约定：16kHz / 16bit / 单声道，~100ms/帧。
 *
 * Worklet 以 Blob URL 注册（不经打包器特殊配置，electron-vite 直出可用）。
 *
 * @author aceFelix
 */

/** 采集音频的目标采样率（DashScope 实时语音输入契约）。 */
export const CAPTURE_SAMPLE_RATE = 16000
/** 每帧采样数：100ms @16kHz，对齐引擎 CHUNK_BYTES=3200 的拉取节拍。 */
export const CAPTURE_FRAME_SAMPLES = 1600

/** AudioWorkletProcessor 源码（全局作用域执行，不可引用外部符号）。 */
const WORKLET_SOURCE = `
class JarvisPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    // 整数倍抽取比：48k/16k=3，44.1k 等非整数比用最近邻抽稀（语音场景足够）
    this._ratio = Math.max(1, Math.round(sampleRate / ${CAPTURE_SAMPLE_RATE}))
    this._acc = new Float32Array(${CAPTURE_FRAME_SAMPLES})
    this._accLen = 0
    this._phase = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const ch = input[0]
    for (let i = 0; i < ch.length; i++) {
      if (this._phase === 0) {
        // 简单限幅，避免爆音产生 >1 的样本值
        const v = Math.max(-1, Math.min(1, ch[i]))
        this._acc[this._accLen++] = v
        if (this._accLen === ${CAPTURE_FRAME_SAMPLES}) {
          const pcm = new Int16Array(${CAPTURE_FRAME_SAMPLES})
          for (let j = 0; j < ${CAPTURE_FRAME_SAMPLES}; j++) {
            pcm[j] = Math.round(this._acc[j] * 32767)
          }
          this.port.postMessage(pcm.buffer, [pcm.buffer])
          this._accLen = 0
        }
      }
      this._phase = (this._phase + 1) % this._ratio
    }
    return true
  }
}
registerProcessor('jarvis-pcm-capture', JarvisPcmCapture)
`

interface CaptureState {
  stream: MediaStream
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  worklet: AudioWorkletNode
}

let state: CaptureState | null = null

/**
 * 启动采集：浏览器 AEC 采麦克风 → 16kHz PCM16 帧回调。
 *
 * @param onFrame - 每 ~100ms 调用一次，参数为 base64 编码的 PCM16 帧。
 * @returns 是否启动成功（失败时已自行降级提示，调用方中断 talk 流程）。
 */
export async function startTalkCapture(
  onFrame: (b64Frame: string) => void
): Promise<boolean> {
  if (state) return true
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    })
    // 用流自身采样率建上下文，重采样比由 worklet 按 sampleRate 计算
    const ctx = new AudioContext({ sampleRate: stream.getAudioTracks()[0]?.getSettings().sampleRate ?? 48000 })
    const blobUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    )
    await ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)
    const source = ctx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(ctx, 'jarvis-pcm-capture')
    worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      onFrame(base64FromBytes(new Uint8Array(ev.data)))
    }
    source.connect(worklet)
    // worklet 不连 destination（只采集不监听，避免回授）
    state = { stream, ctx, source, worklet }
    return true
  } catch (err) {
    stopTalkCapture()
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** 停止采集并释放麦克风（talk 会话结束/中断时必须调用，否则系统麦克风占用灯常亮）。 */
export function stopTalkCapture(): void {
  if (!state) return
  try {
    state.worklet.port.onmessage = null
    state.source.disconnect()
    state.worklet.disconnect()
    for (const track of state.stream.getTracks()) track.stop()
    void state.ctx.close()
  } catch {
    // 释放路径的异常一律吞掉——目标是"一定释放干净"
  }
  state = null
}

/** Uint8Array → base64（分块 String.fromCharCode 避免栈溢出）。 */
function base64FromBytes(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x2000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
