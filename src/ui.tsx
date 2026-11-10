import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings } from './lib/db'
import { fmt, toCents, type Cents } from './lib/money'

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('shop'), []) ?? DEFAULT_SETTINGS
}

export const money = (c: Cents) => fmt(c)

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
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button>
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
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  )
}

// ---- money field -------------------------------------------------------------

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
        {error ? <div className="banner warn">{error}</div> : <video ref={video} className="scanner" muted playsInline />}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onCode(typed.trim()) }}>
          <input className="input grow" inputMode="numeric" placeholder="Or type barcode number" value={typed} onChange={(e) => setTyped(e.target.value)} />
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
