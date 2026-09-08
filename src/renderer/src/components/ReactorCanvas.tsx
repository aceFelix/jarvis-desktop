/**
 * 反应炉背景动画组件：挂载 canvas + ArcReactor 实例，并注册到 reactorRef
 * （dispatcher 经 ref 驱动说话律动）。
 *
 * @author aceFelix
 */

import { useEffect, useRef } from 'react'
import { ArcReactor } from '../reactor'
import { setReactor } from '../stores/reactorRef'

export default function ReactorCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const reactor = new ArcReactor(canvasRef.current)
    setReactor(reactor)
    return () => {
      setReactor(null)
      reactor.destroy()
    }
  }, [])

  return <canvas id="reactor-canvas" ref={canvasRef} />
}
