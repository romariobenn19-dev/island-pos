import { useMemo, useState } from 'react'
import { CATALOG, CATEGORIES, type CatalogItem } from '../lib/catalog'
import { db, saveSettings, type Product } from '../lib/db'
import { search } from '../lib/search'

export function catalogToProduct(c: CatalogItem): Product {
  return {
    name: c.name, category: c.category, aliases: c.aliases ?? [], price: 0, cost: 0, stock: 0,
    reorderAt: 3, packSize: c.packSize ?? 1, packName: c.packName ?? 'pack', unit: c.unit ?? 'each',
    zeroRated: false, active: true, createdAt: Date.now(),
  }
}

/** Tick items from the Caribbean starter list. Already-added items are hidden. */
export function CatalogPicker({ existing, onDone, doneLabel }: { existing: string[]; onDone: (items: CatalogItem[]) => void; doneLabel: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [cat, setCat] = useState(CATEGORIES[0])
  const [q, setQ] = useState('')
  const have = useMemo(() => new Set(existing.map((n) => n.toLowerCase())), [existing])
  const available = CATALOG.filter((c) => !have.has(c.name.toLowerCase()))
  const shown = q ? search(available, q, 60) : available.filter((c) => c.category === cat)
  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })
  const allOn = shown.length > 0 && shown.every((c) => picked.has(c.name))

  return (
    <div className="stack">
      <input className="input" placeholder="Search e.g. rum, corn beef, top up" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && (
        <div className="chips">
          {CATEGORIES.map((c) => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      )}
      <button className="btn soft" onClick={() => setPicked((s) => { const n = new Set(s); shown.forEach((c) => (allOn ? n.delete(c.name) : n.add(c.name))); return n })}>
        {allOn ? 'Untick all shown' : 'Tick all shown'}
      </button>
      <div className="grid">
        {shown.map((c) => (
          <button key={c.name} className={'tile' + (picked.has(c.name) ? ' on' : '')} onClick={() => toggle(c.name)} aria-pressed={picked.has(c.name)}>
            <span className="name">{picked.has(c.name) ? '✓ ' : ''}{c.name}</span>
            <span className="small muted">{c.packSize ? `${c.packSize} per ${c.packName}` : c.category}</span>
          </button>
        ))}
        {!shown.length && <p className="muted">Nothing here. You can add your own items any time.</p>}
      </div>
      <button className="btn primary lg block" onClick={() => onDone(CATALOG.filter((c) => picked.has(c.name)))}>
        {doneLabel}{picked.size ? ` (${picked.size})` : ''}
      </button>
    </div>
  )
}

export function Setup() {
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const finish = async (items: CatalogItem[]) => {
    await db.products.bulkAdd(items.map(catalogToProduct))
    await saveSettings({ shopName: name.trim() || 'My Shop', phone, onboarded: true })
  }

  return (
    <div className="app">
      <header className="topbar"><h1>Welcome 👋</h1></header>
      <main className="screen stack">
        {step === 1 ? (
          <>
            <div className="card stack">
              <h2>Let's set up your shop</h2>
              <p className="muted">Two quick steps. You can change everything later.</p>
              <label className="field">Shop name
                <input className="input lg" autoFocus placeholder="e.g. Miss Joy's Shop" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">Shop phone <span className="hint">Shown on receipts (optional)</span>
                <input className="input" inputMode="tel" placeholder="246-555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <p className="small muted">Set for Barbados: prices in BBD with VAT included, US$ taken at 2 to 1, cash rounded to 5¢.</p>
            </div>
            <button className="btn primary lg block" onClick={() => setStep(2)}>Next</button>
          </>
        ) : (
          <>
            <div className="card stack">
              <h2>What do you sell?</h2>
              <p className="muted">Tap the items you carry. You'll put in prices when you first sell them, or when stock comes in.</p>
            </div>
            <CatalogPicker existing={[]} onDone={finish} doneLabel="Start selling" />
            <button className="btn block" onClick={() => finish([])}>Skip, I'll add items myself</button>
          </>
        )}
      </main>
    </div>
  )
}
