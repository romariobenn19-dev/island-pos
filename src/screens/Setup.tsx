import { useMemo, useState } from 'react'
import { ArrowLeft, Check, NotebookPen, Search, ShoppingCart, Store, WifiOff } from 'lucide-react'
import { CATALOG, CATEGORIES, type CatalogItem } from '../lib/catalog'
import { db, saveSettings, type Product } from '../lib/db'
import { search } from '../lib/search'
import { categoryMeta } from '../theme'
import { CatBadge } from '../ui'

export function catalogToProduct(c: CatalogItem): Product {
  return {
    name: c.name, category: c.category, aliases: c.aliases ?? [], price: 0, cost: 0, stock: 0,
    reorderAt: 3, packSize: c.packSize ?? 1, packName: c.packName ?? 'pack', unit: c.unit ?? 'each',
    zeroRated: false, active: true, createdAt: Date.now(),
  }
}

/** Items most corner shops carry: a one-tap starting point. */
const STAPLES = [
  'Water 500ml', 'Coca-Cola 20oz', 'Sprite 20oz', 'Ju-C (assorted)', 'Tiger Malt Bottle', 'Mauby Drink',
  'Banks Beer Bottle', 'Deputy Bottle', 'Mount Gay Eclipse Flask 200ml', 'E.S.A. Field White Rum Flask 200ml',
  'Sliced Bread White', 'Salt Bread', 'Coconut Bread', 'White Rice 2kg', 'Flour 2kg', 'Brown Sugar 2kg',
  'Cooking Oil 1L', 'Macaroni', 'Corned Beef', 'Sardines', 'Tuna', 'Evaporated Milk', 'Eggs (each)',
  'Cheese (block)', 'Crackers', 'Potato Chips', 'Sweeties', 'Bajan Seasoning', 'Pepper Sauce', 'Ketchup',
  'Toilet Paper Single roll', 'Bleach', 'Bath Soap', 'Toothpaste', 'Paracetamol / Panadol',
  'Flow Top Up $10', 'Digicel Top Up $10', 'Bag of Ice', 'Matches', 'Candles',
]

/** Tick items from the Caribbean starter list. Already-added items are hidden. */
export function CatalogPicker({ existing, onDone, doneLabel }: { existing: string[]; onDone: (items: CatalogItem[]) => void; doneLabel: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [cat, setCat] = useState(CATEGORIES[0])
  const [q, setQ] = useState('')
  const have = useMemo(() => new Set(existing.map((n) => n.toLowerCase())), [existing])
  const available = CATALOG.filter((c) => !have.has(c.name.toLowerCase()))
  const shown = q ? search(available, q, 80) : available.filter((c) => c.category === cat)
  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })
  const allOn = shown.length > 0 && shown.every((c) => picked.has(c.name))
  const staples = available.filter((c) => STAPLES.includes(c.name))

  return (
    <div className="stack">
      {staples.length > 0 && picked.size === 0 && (
        <button className="btn soft lg block" onClick={() => setPicked(new Set(staples.map((c) => c.name)))}>
          <ShoppingCart size={20} />Start with {staples.length} everyday best sellers
        </button>
      )}
      <label className="search"><Search size={20} /><input className="input" placeholder="Search, e.g. rum, corn beef, top up" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!q && (
        <div className="chips">
          {CATEGORIES.map((c) => {
            const { Icon } = categoryMeta(c)
            const n = available.filter((x) => x.category === c && picked.has(x.name)).length
            return <button key={c} className={'chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}><Icon size={15} />{c}{n ? ` · ${n}` : ''}</button>
          })}
        </div>
      )}
      <div className="row spread">
        <span className="small muted">{shown.length} items{q ? '' : ` in ${cat}`}</span>
        <button className="btn ghost sm" onClick={() => setPicked((s) => { const n = new Set(s); shown.forEach((c) => (allOn ? n.delete(c.name) : n.add(c.name))); return n })}>
          {allOn ? 'Untick all shown' : 'Tick all shown'}
        </button>
      </div>
      <div className="pick-grid">
        {shown.map((c) => (
          <button key={c.name} className={'pick' + (picked.has(c.name) ? ' on' : '')} onClick={() => toggle(c.name)} aria-pressed={picked.has(c.name)}>
            <CatBadge category={c.category} small />
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</span>
              <span className="tiny muted">{c.packSize ? `${c.packSize} per ${c.packName}` : c.unit === 'lb' ? 'sold by the pound' : c.category}</span>
            </span>
            <span className="tick">{picked.has(c.name) && <Check size={14} strokeWidth={3} />}</span>
          </button>
        ))}
        {!shown.length && <p className="muted">Nothing here. You can add your own items any time.</p>}
      </div>
      <button className="btn primary lg block" style={{ position: 'sticky', bottom: 8 }} onClick={() => onDone(CATALOG.filter((c) => picked.has(c.name)))}>
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
    <div className="setup">
      <div className="setup-inner">
        <div className="row">
          <div className="brandmark"><Store size={22} /></div>
          <div className="grow"><strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>Island POS</strong><div className="tiny muted">Sales, stock and credit for Caribbean shops</div></div>
          <span className="small muted">Step {step} of 2</span>
        </div>
        <div className="steps"><span className="on" /><span className={step === 2 ? 'on' : ''} /></div>
        {step === 1 ? (
          <>
            <div className="card stack">
              <h1>Let's set up your shop</h1>
              <p className="muted">Two quick steps. You can change everything later in Settings.</p>
              <label className="field">Shop name
                <input className="input lg" autoFocus placeholder="e.g. Miss Joy's Shop" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">Shop phone <span className="hint">Shown on receipts (optional)</span>
                <input className="input" inputMode="tel" placeholder="246-555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <div className="banner brand small">Set for Barbados: prices in BBD with 17.5% VAT included, US$ at 2 to 1, cash rounded to 5¢.</div>
            </div>
            <div className="kpis">
              <div className="kpi"><ShoppingCart size={20} className="good" /><span className="small">Sell in a few taps, cash, US$, card or credit</span></div>
              <div className="kpi"><NotebookPen size={20} className="warn" /><span className="small">Credit book with WhatsApp reminders</span></div>
              <div className="kpi"><WifiOff size={20} className="muted" /><span className="small">Keeps working when the internet or power drops</span></div>
              <div className="kpi"><Store size={20} className="muted" /><span className="small">{CATALOG.length} Bajan shop items ready to pick</span></div>
            </div>
            <button className="btn primary lg block" onClick={() => setStep(2)}>Next: choose what you sell</button>
          </>
        ) : (
          <>
            <div className="row">
              <button className="iconbtn" aria-label="Back" onClick={() => setStep(1)}><ArrowLeft size={20} /></button>
              <div className="grow">
                <h1>What do you sell?</h1>
                <p className="muted small">Tap the items you carry. Prices go in when you first sell an item, or when stock comes in.</p>
              </div>
            </div>
            <CatalogPicker existing={[]} onDone={finish} doneLabel="Open my shop" />
            <button className="btn ghost block" onClick={() => finish([])}>Skip, I'll add items myself</button>
          </>
        )}
      </div>
    </div>
  )
}
