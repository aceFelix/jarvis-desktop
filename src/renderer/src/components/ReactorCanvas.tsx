/**
 * 反应炉背景动画组件：挂载 canvas + ArcReactor 实例，并注册到 reactorRef
 * （dispatcher 经 ref 驱动说话律动）。
 *
 * 订阅主题：荧光绿（retro）切 setRetro(true) 换绿系配色，其余蓝系；
 * 三主题同为 Y2K 像素复古风，setPixelated(true) 恒开（1/4 分辨率像素化绘制）。
 *
 * @author aceFelix
 */

import { useEffect, useRef } from 'react'
import { ArcReactor } from '../reactor'
import { setReactor } from '../stores/reactorRef'
import { useSettingsStore } from '../stores/settingsStore'

export default function ReactorCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reactorRef = useRef<ArcReactor | null>(null)
  const theme = useSettingsStore((s) => s.theme)

  useEffect(() => {
    if (!canvasRef.current) return
    const reactor = new ArcReactor(canvasRef.current)
    reactorRef.current = reactor
    reactor.setRetro(theme === 'retro')
    reactor.setPixelated(true)
    setReactor(reactor)
    return () => {
      setReactor(null)
      reactorRef.current = null
      reactor.destroy()
    }
    // 仅在挂载时建实例；主题切换走下方独立 effect，避免重建 canvas。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主题变化：仅切配色表（像素化三主题恒开，实例已建不重建 canvas）。
  useEffect(() => {
    reactorRef.current?.setRetro(theme === 'retro')
  }, [theme])

  return <canvas id="reactor-canvas" ref={canvasRef} />
}
