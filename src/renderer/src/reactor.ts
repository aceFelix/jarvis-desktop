/**
 * 方舟反应炉（Arc Reactor）Canvas 动画 —— TS 移植版（源自 workbench reactor.js）。
 *
 * 性能口径（实机验证过的经验，直接沿用）：
 * - 限帧 30fps + dpr 固定 1 + 粒子 160 颗；
 * - document.hidden 时跳过绘制；
 * - 辉光粒子预渲染离屏精灵，逐帧 drawImage（规避 shadowBlur）。
 *
 * 与 workbench 的差异：Electron 窗口不透明，深蓝实底由 CSS 承担，
 * canvas 仍透明清屏（clearRect）叠在其上。
 *
 * @author aceFelix
 */

export type ReactorStatus = 'standby' | 'listening' | 'speaking' | 'error' | 'connecting'

interface Particle {
  angle: number
  orbit: number
  speed: number
  sprite: number
  phase: number
  alpha: number
}

interface Ripple {
  radius: number
  alpha: number
  delay: number
}

export class ArcReactor {
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private frameInterval = 1000 / 30
  private lastFrame = 0
  private rafId = 0

  private status: ReactorStatus = 'standby'
  private volume = 0
  private userSpeaking = false
  private aiSpeaking = false
  private speed = 1
  private energy = 0.35
  private time = 0
  private rippleTimer = 0

  private width = 0
  private height = 0
  private cx = 0
  private cy = 0
  private baseRadius = 0

  private particles: Particle[] = []
  private ripples: Ripple[] = []
  private sprites: HTMLCanvasElement[] = []

  private readonly colors: Record<ReactorStatus, string> = {
    standby: '#5bc8ff',
    listening: '#00f0ff',
    speaking: '#8fe3ff',
    error: '#ff5a5a',
    connecting: '#5bc8ff'
  }
  private readonly coilCount = 10
  private hasConic: boolean

  private readonly onResize = (): void => this.resize()

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: true })!
    this.hasConic = typeof this.ctx.createConicGradient === 'function'
    this.resize()
    window.addEventListener('resize', this.onResize)
    this.buildSprites()
    this.initParticles()
    this.rafId = requestAnimationFrame((t) => this.animate(t))
  }

  /** 释放资源（React useEffect cleanup）。 */
  destroy(): void {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.onResize)
  }

  // ================= 尺寸与精灵 =================

  private resize(): void {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = this.width * this.dpr
    this.canvas.height = this.height * this.dpr
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.cx = this.width / 2
    this.cy = this.height / 2
    this.baseRadius = Math.min(this.width, this.height) * 0.3
    if (this.sprites.length) this.buildSprites()
  }

  /** 预渲染三档尺寸的辉光粒子精灵（一次绘制，逐帧 drawImage）。 */
  private buildSprites(): void {
    const base = Math.max(10, this.baseRadius * 0.06)
    this.sprites = [12, 20, 30].map((px) => {
      const size = base * (px / 15)
      const c = document.createElement('canvas')
      c.width = size * 2
      c.height = size * 2
      const g = c.getContext('2d')!
      const grad = g.createRadialGradient(size, size, 0, size, size, size)
      grad.addColorStop(0, 'rgba(255,255,255,0.95)')
      grad.addColorStop(0.25, 'rgba(143,227,255,0.55)')
      grad.addColorStop(0.6, 'rgba(91,200,255,0.18)')
      grad.addColorStop(1, 'rgba(91,200,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, size * 2, size * 2)
      return c
    })
  }

  private initParticles(): void {
    const count = 160
    this.particles = []
    for (let i = 0; i < count; i++) {
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        orbit: 0.42 + Math.pow(Math.random(), 0.8) * 0.95,
        speed: (0.0012 + Math.random() * 0.004) * (Math.random() < 0.2 ? -1 : 1),
        sprite: (Math.random() * 3) | 0,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.25 + Math.random() * 0.55
      })
    }
  }

  // ================= 公共控制 API =================

  setStatus(status: ReactorStatus): void {
    if (this.status === status) return
    this.status = status
    if (status === 'speaking' || status === 'listening') this.triggerRipple(2)
  }

  setVolume(level: number): void {
    this.volume = this.volume * 0.7 + Math.max(0, Math.min(1, level)) * 0.3
  }

  setUserSpeaking(speaking: boolean): void {
    if (this.userSpeaking === speaking) return
    this.userSpeaking = speaking
    if (speaking) {
      this.setStatus('listening')
      this.triggerRipple(1)
    } else if (!this.aiSpeaking && this.status === 'listening') {
      this.setStatus('standby')
    }
  }

  setAiSpeaking(speaking: boolean): void {
    if (this.aiSpeaking === speaking) return
    this.aiSpeaking = speaking
    if (speaking) {
      this.setStatus('speaking')
      this.triggerRipple(3)
    } else if (!this.userSpeaking && this.status === 'speaking') {
      this.setStatus('standby')
    }
  }

  triggerRipple(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.ripples.push({ radius: this.baseRadius * 0.22, alpha: 0.55, delay: i * 9 })
    }
  }

  // ================= 绘制 =================

  private getColor(): string {
    return this.colors[this.status] ?? this.colors.standby
  }

  private pulse(): number {
    const breath = 0.5 + 0.5 * Math.sin(this.time * 0.035 * this.speed)
    return 0.85 + breath * 0.1 + this.volume * 0.25 + this.energy * 0.15
  }

  private drawAmbient(color: string): void {
    const { ctx, cx, cy } = this
    const r = this.baseRadius * (1.55 + this.energy * 0.25)
    const grad = ctx.createRadialGradient(cx, cy, this.baseRadius * 0.05, cx, cy, r)
    grad.addColorStop(0, color + '30')
    grad.addColorStop(0.45, color + '12')
    grad.addColorStop(1, color + '00')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawSweep(color: string): void {
    if (!this.hasConic) return
    const { ctx, cx, cy, baseRadius } = this
    const angle = this.time * 0.006 * this.speed
    const grad = ctx.createConicGradient(angle, cx, cy)
    grad.addColorStop(0, color + '26')
    grad.addColorStop(0.08, color + '00')
    grad.addColorStop(1, color + '00')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, baseRadius * 1.28, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawCore(color: string): void {
    const { ctx, cx, cy } = this
    const r = this.baseRadius * 0.24 * this.pulse()

    const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.4)
    glow.addColorStop(0, color + '55')
    glow.addColorStop(0.5, color + '1a')
    glow.addColorStop(1, color + '00')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2)
    ctx.fill()

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    core.addColorStop(0, 'rgba(255,255,255,0.95)')
    core.addColorStop(0.35, color + 'cc')
    core.addColorStop(0.8, color + '40')
    core.addColorStop(1, color + '00')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = color
    ctx.globalAlpha = 0.8
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private drawCoils(color: string): void {
    const { ctx, cx, cy, baseRadius, coilCount } = this
    const inner = baseRadius * 0.34
    const outer = baseRadius * 0.48
    const seg = (Math.PI * 2) / coilCount
    const gap = seg * 0.22
    const wave = this.time * 0.02 * this.speed

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this.time * 0.0012 * this.speed)
    for (let i = 0; i < coilCount; i++) {
      const a0 = i * seg + gap / 2
      const a1 = (i + 1) * seg - gap / 2
      const diff = Math.cos(i * seg - wave)
      const lit = Math.max(0, diff) ** 2
      const alpha = 0.18 + lit * (0.5 + this.energy * 0.3)

      const ix0 = Math.cos(a0) * inner
      const iy0 = Math.sin(a0) * inner
      const ix1 = Math.cos(a1) * inner
      const iy1 = Math.sin(a1) * inner
      const ox1 = Math.cos(a1) * outer
      const oy1 = Math.sin(a1) * outer
      const ox0 = Math.cos(a0) * outer
      const oy0 = Math.sin(a0) * outer

      ctx.beginPath()
      ctx.moveTo(ix0, iy0)
      ctx.lineTo(ix1, iy1)
      ctx.lineTo(ox1, oy1)
      ctx.lineTo(ox0, oy0)
      ctx.closePath()

      ctx.fillStyle = color
      ctx.globalAlpha = alpha * 0.55
      ctx.fill()
      ctx.globalAlpha = alpha
      ctx.lineWidth = 1
      ctx.strokeStyle = color
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  private drawArcs(color: string): void {
    const { ctx, baseRadius } = this
    const rings = [
      { r: 0.58, w: 2.5, dash: [baseRadius * 0.22, baseRadius * 0.1], v: 0.006, a: 0.55 },
      { r: 0.7, w: 2, dash: [baseRadius * 0.05, baseRadius * 0.045], v: -0.009, a: 0.42 },
      { r: 0.85, w: 3, dash: [baseRadius * 0.3, baseRadius * 0.16], v: 0.004, a: 0.35 },
      { r: 1.0, w: 1.5, dash: [baseRadius * 0.08, baseRadius * 0.12], v: -0.005, a: 0.28 }
    ]
    ctx.save()
    ctx.translate(this.cx, this.cy)
    rings.forEach((ring, idx) => {
      ctx.save()
      ctx.rotate(this.time * ring.v * this.speed + idx * 1.3)
      ctx.strokeStyle = color
      ctx.globalAlpha = ring.a * (0.8 + this.energy * 0.5)
      ctx.lineWidth = ring.w
      ctx.lineCap = 'round'
      ctx.setLineDash(ring.dash)
      ctx.beginPath()
      ctx.arc(0, 0, baseRadius * ring.r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    })
    ctx.restore()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  private drawTicks(color: string): void {
    const { ctx, baseRadius } = this
    const r = baseRadius * 1.12
    const n = 60
    ctx.save()
    ctx.translate(this.cx, this.cy)
    ctx.rotate(-this.time * 0.0018 * this.speed)
    for (let i = 0; i < n; i++) {
      const major = i % 5 === 0
      const len = major ? baseRadius * 0.05 : baseRadius * 0.022
      const a = (i / n) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      ctx.strokeStyle = color
      ctx.globalAlpha = major ? 0.5 : 0.22
      ctx.lineWidth = major ? 1.5 : 1
      ctx.beginPath()
      ctx.moveTo(c * r, s * r)
      ctx.lineTo(c * (r + len), s * (r + len))
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  private drawParticles(): void {
    const { ctx, cx, cy, baseRadius } = this
    const expansion = this.aiSpeaking ? 1.1 : this.userSpeaking ? 1.04 : 1.0
    const boost = this.speed * (this.userSpeaking ? 1.4 + this.volume : 1.0)

    for (const p of this.particles) {
      p.angle += p.speed * boost
      const orbit =
        baseRadius * p.orbit * expansion +
        Math.sin(this.time * 0.02 + p.phase) * this.volume * 10
      const x = cx + Math.cos(p.angle) * orbit
      const y = cy + Math.sin(p.angle) * orbit * 0.92
      const sprite = this.sprites[p.sprite]
      const twinkle = 0.6 + 0.4 * Math.sin(this.time * 0.05 + p.phase)
      ctx.globalAlpha = Math.min(1, p.alpha * twinkle * (0.7 + this.energy))
      ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2)
    }
    ctx.globalAlpha = 1
  }

  private drawRipples(color: string): void {
    const { ctx, cx, cy } = this
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i]
      if (rp.delay > 0) {
        rp.delay--
        continue
      }
      rp.radius += this.baseRadius * 0.014 * this.speed
      rp.alpha -= 0.009 * this.speed
      if (rp.alpha <= 0 || rp.radius > this.baseRadius * 1.6) {
        this.ripples.splice(i, 1)
        continue
      }
      ctx.strokeStyle = color
      ctx.globalAlpha = rp.alpha
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, rp.radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = rp.alpha * 0.45
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, rp.radius * 0.93, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // ================= 主循环 =================

  private animate(now: number): void {
    this.rafId = requestAnimationFrame((t) => this.animate(t))
    if (document.hidden) return
    if (now - this.lastFrame < this.frameInterval) return
    this.lastFrame = now

    this.time++
    const ctx = this.ctx
    const color = this.getColor()

    const targetSpeed = this.aiSpeaking ? 2.6 : this.userSpeaking ? 1.6 : 1.0
    this.speed += (targetSpeed - this.speed) * 0.06
    const targetEnergy = this.aiSpeaking ? 0.85 : this.userSpeaking ? 0.55 : 0.35
    this.energy += (targetEnergy - this.energy) * 0.05

    this.rippleTimer += this.speed
    if (this.rippleTimer > 130) {
      this.rippleTimer = 0
      this.triggerRipple(1)
    }

    ctx.clearRect(0, 0, this.width, this.height)
    this.drawAmbient(color)
    this.drawSweep(color)
    this.drawCore(color)
    this.drawCoils(color)
    this.drawArcs(color)
    this.drawTicks(color)
    this.drawParticles()
    this.drawRipples(color)
  }
}
