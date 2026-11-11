import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Delete, ScanBarcode, X } from 'lucide-react'
import { db, DEFAULT_SETTINGS, type Settings } from './lib/db'
import { fmt, toCents, type Cents } from './lib/money'
import { categoryMeta } from './theme'

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('shop'), []) ?? DEFAULT_SETTINGS
}

export const money = (c: Cents) => fmt(c)

/** True on tablets and computers (two-pane layout). */
export function useWide(): boolean {
  const q = '(min-width: 900px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function CatBadge({ category, small }: { category: string; small?: boolean }) {
  const { Icon, hue } = categoryMeta(category)
  return (
    <span className={'badge' + (small ? ' sm' : '')} style={{ ['--hue' as string]: hue }} aria-hidden>
      <Icon size={small ? 16 : 20} strokeWidth={2} />
    </span>
  )
}

// ---- pop-up panel -----------------------------------------------------------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---- short messages ----------------------------------------------------------

const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = (m: string) => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2600)
  }
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status"><CheckCircle2 size={18} />{msg}</div>}
    </ToastCtx.Provider>
  )
}

// ---- money and number fields -------------------------------------------------

export function MoneyInput({ value, onChange, label, hint, autoFocus, large }: {
  value: Cents; onChange: (c: Cents) => void; label?: string; hint?: string; autoFocus?: boolean; large?: boolean
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : '')
  useEffect(() => {
    if (toCents(text) !== value) setText(value ? (value / 100).toFixed(2) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const input = (
    <input
      className={'input' + (large ? ' lg' : '')}
      inputMode="decimal"
      placeholder="0.00"
      value={text}
      autoFocus={autoFocus}
      onFocus={(e) => e.target.select()}
      onChange={(e) => { setText(e.target.value); onChange(toCents(e.target.value)) }}
    />
  )
  if (!label) return input
  return <label className="field">{label}{hint && <span className="hint">{hint}</span>}{input}</label>
}

export function NumberInput({ value, onChange, label, hint, step = 1 }: {
  value: number; onChange: (n: number) => void; label: string; hint?: string; step?: number
}) {
  return (
    <label className="field">{label}{hint && <span className="hint">{hint}</span>}
      <input className="input" type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ''}
        onFocus={(e) => e.target.select()} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  )
}

/** Till-style keypad: digits fill from the right, so 2-0-0-0 is $20.00. */
export function Keypad({ value, onChange }: { value: Cents; onChange: (c: Cents) => void }) {
  const press = (k: string) => {
    if (k === 'back') onChange(Math.floor(value / 10))
    else if (k === '00') onChange(Math.min(value * 100, 99999999))
    else onChange(Math.min(value * 10 + Number(k), 99999999))
  }
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((k) => (
        <button key={k} type="button" onClick={() => press(k)}>{k}</button>
      ))}
      <button type="button" aria-label="Delete" onClick={() => press('back')}><Delete size={22} /></button>
    </div>
  )
}

// ---- barcode scanner (phone camera) -----------------------------------------

interface DetectorLike { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o?: { formats: string[] }) => DetectorLike } }

export const canScan = () => typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices

export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let stop = false
    const run = async () => {
      if (!canScan()) { setError('This phone browser cannot scan barcodes. Type the number instead.'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => [])
          if (found.length) { navigator.vibrate?.(80); onCode(found[0].rawValue); return }
          await new Promise((r) => setTimeout(r, 200))
        }
      } catch {
        setError('Camera not available. Allow camera access, or type the number.')
      }
    }
    run()
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [onCode])

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      <div className="stack">
        {error ? <div className="banner warn"><ScanBarcode size={18} />{error}</div> : <video ref={video} className="scanner" muted playsInline />}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onCode(typed.trim()) }}>
          <input className="input grow" inputMode="numeric" placeholder="Or type the barcode number" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button className="btn primary">OK</button>
        </form>
      </div>
    </Sheet>
  )
}

/** Two-tap button for risky actions: first tap asks, second tap does it. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger block' }: {
  label: string; confirmLabel: string; onConfirm: () => void | Promise<void>; className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className={className} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  )
}

export function timeAgo(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  const m = Math.floor(d / 30)
  return m === 1 ? '1 month ago' : `${m} months ago`
}
