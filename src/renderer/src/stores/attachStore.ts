/**
 * 附件 store —— 待发送附件（chips）的集中状态。
 *
 * 从 ChatArea 提升为独立 store：右栏快捷操作「截屏发给贾维斯」与
 * 输入区 📎/粘贴共用同一份待发送列表，截屏入列后在输入区上方直接可见。
 *
 * 附件口径与 serve/server.py 入队校验一致：
 * - 图片 ≤8 张（base64 走 vision）；
 * - 文本文件 ≤5 个（单文件内容截 20 万字符后拼进消息正文）。
 *
 * @author aceFelix
 */

import { create } from 'zustand'
import { useChatStore } from './chatStore'

// 附件上限（与 serve/server.py 入队校验同口径）：超限提示并忽略多余项。
// @author aceFelix
export const MAX_ATTACH_IMAGES = 8
export const MAX_ATTACH_FILES = 5
/** 单个文本文件客户端截断上限（字符）：先截再发，避免超大 payload 被 WS 拒收。 */
export const MAX_FILE_CHARS = 200_000

/** 待发送附件（本地选中后、发送前）：图片存 base64 + 缩略图 data URL，
 * 文本文件存截断后的内容。@author aceFelix */
export interface PendingAttach {
  id: number
  name: string
  kind: 'image' | 'file'
  dataUrl?: string
  mediaType?: string
  b64?: string
  content?: string
}

let pendingSeq = 1

/** 读单个附件：图片 → base64 + data URL；其余 → 文本内容（超限截断）。
 * 读失败返回 null。@author aceFelix */
function readAttach(f: File): Promise<PendingAttach | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    if (f.type.startsWith('image/')) {
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        if (!b64) return resolve(null)
        resolve({ id: pendingSeq++, name: f.name, kind: 'image', dataUrl, mediaType: f.type, b64 })
      }
      reader.readAsDataURL(f)
    } else {
      reader.onload = () => {
        let content = String(reader.result || '')
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + '\n…（文件过长，仅发送前 20 万字符）'
        }
        resolve({ id: pendingSeq++, name: f.name, kind: 'file', content })
      }
      reader.readAsText(f)
    }
  })
}

export interface AttachState {
  /** 待发送附件列表（chips 渲染源）。 */
  pending: PendingAttach[]
  /** 选中/粘贴的文件读入待发送区：异步读完后按类别上限入列，超限提示忽略。 */
  addFiles: (list: FileList | File[]) => void
  /** 直接入列一张图片（右栏截屏桥入口：主进程给 base64，不经 FileReader）。 */
  addImage: (name: string, b64: string, mediaType: string) => void
  /** 移除单个附件（chip ✕）。 */
  remove: (id: number) => void
  /** 清空（发送后调用）。 */
  clear: () => void
}

/** 按类别上限入列：超限写系统提示并忽略。@author aceFelix */
function pushCapped(prev: PendingAttach[], item: PendingAttach): PendingAttach[] {
  const count = prev.filter((p) => p.kind === item.kind).length
  const cap = item.kind === 'image' ? MAX_ATTACH_IMAGES : MAX_ATTACH_FILES
  if (count >= cap) {
    useChatStore.getState().addSystem(
      item.kind === 'image'
        ? `单条消息最多 ${MAX_ATTACH_IMAGES} 张图片，已忽略「${item.name}」`
        : `单条消息最多 ${MAX_ATTACH_FILES} 个文件，已忽略「${item.name}」`,
      'warn'
    )
    return prev
  }
  return [...prev, item]
}

export const useAttachStore = create<AttachState>((set) => ({
  pending: [],

  addFiles: (list) => {
    const incoming = Array.from(list)
    if (!incoming.length) return
    void Promise.all(incoming.map(readAttach)).then((loaded) => {
      set((s) => {
        let next = s.pending
        for (const item of loaded) {
          if (!item) continue
          next = pushCapped(next, item)
        }
        return { pending: next }
      })
    })
  },

  addImage: (name, b64, mediaType) => {
    if (!b64) return
    const item: PendingAttach = {
      id: pendingSeq++,
      name,
      kind: 'image',
      dataUrl: `data:${mediaType};base64,${b64}`,
      mediaType,
      b64
    }
    set((s) => ({ pending: pushCapped(s.pending, item) }))
  },

  remove: (id) => set((s) => ({ pending: s.pending.filter((x) => x.id !== id) })),

  clear: () => set({ pending: [] })
}))
