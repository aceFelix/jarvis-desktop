/**
 * 桌面全双工语音播放 —— 接收引擎 talk_audio 事件的 24kHz PCM16 帧并连贯播放。
 *
 * 与 Python 侧 BridgeSpk 的约定：
 * - data 为非空 base64 → 一帧 AI 语音（24kHz / 16bit / 单声道），入队按
 *   AudioContext 时钟无缝排播（nextTime 接续，避免帧间咔哒声）；
 * - data 为空串 → 打断 flush：停掉所有在播 source 并清空队列（引擎
 *   spk.stop_stream 的远端镜像，用户插话打断 AI 播报时触发）。
 *
 * @author aceFelix
 */

/** 引擎输出契约采样率（DashScope 实时语音输出 24kHz PCM16）。 */
export const PLAYBACK_SAMPLE_RATE = 24000

interface PlaybackState {
  ctx: AudioContext
  /** 下一帧的排播起点（AudioContext 时钟）：永远 ≥ currentTime。 */
  nextTime: number
  active: Set<AudioBufferSourceNode>
}

let state: PlaybackState | null = null

/** Web Audio 可用性：jsdom/单测环境或受限上下文下退化为 no-op，不抛异常。 */
function webAudioAvailable(): boolean {
  return typeof AudioContext !== 'undefined'
}

/** 启动播放通道（幂等）。进入 talk 模式时调用一次。 */
export function startTalkPlayback(): void {
  if (state || !webAudioAvailable()) return
  const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
  state = { ctx, nextTime: 0, active: new Set() }
}

/** 推入一帧 AI 语音（talk_audio 事件，非空 base64）。 */
export function pushTalkAudio(b64Frame: string): void {
  if (!state) return
  const bytes = base64ToBytes(b64Frame)
  if (!bytes.length) {
    flushTalkAudio()
    return
  }
  const sampleCount = bytes.length / 2
  const buffer = state.ctx.createBuffer(1, sampleCount, PLAYBACK_SAMPLE_RATE)
  const out = buffer.getChannelData(0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768
  }
  const src = state.ctx.createBufferSource()
  src.buffer = buffer
  src.connect(state.ctx.destination)
  const now = state.ctx.currentTime
  // 接续排播：缓冲深水时按队列尾部时间排，避免叠音；断档时立即起播
  state.nextTime = Math.max(now + 0.02, state.nextTime)
  src.start(state.nextTime)
  state.nextTime += buffer.duration
  state.active.add(src)
  src.onended = () => state?.active.delete(src)
}

/** 打断 flush：清空在播与待播（引擎 spk.stop_stream 的远端镜像）。 */
export function flushTalkAudio(): void {
  if (!state) return
  for (const src of state.active) {
    try {
      src.onended = null
      src.stop()
      src.disconnect()
    } catch {
      // 已结束的 source stop 会抛异常，吞掉
    }
  }
  state.active.clear()
  state.nextTime = 0
}

/** 停止播放通道并释放（talk 会话结束时调用）。 */
export function stopTalkPlayback(): void {
  if (!state) return
  flushTalkAudio()
  void state.ctx.close()
  state = null
}

/** base64 → Uint8Array。 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
