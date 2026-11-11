import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, CircleAlert, Coins, PackagePlus, Plus, ScanBarcode, Search, Sparkles, Tag } from 'lucide-react'
import { db, isLow, stockTracked, type Product } from '../lib/db'
import { suggestPrice, unitCost, unitProfit, type Cents } from '../lib/money'
import { adjustStock, receiveStock } from '../lib/ops'
import { search } from '../lib/search'
import { CATEGORIES } from '../lib/catalog'
import { canScan, CatBadge, ConfirmButton, money, MoneyInput, NumberInput, Scanner, Sheet, useSettings, useToast } from '../ui'
import { CatalogPicker, catalogToProduct } from './Setup'

export function Items() {
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'noprice'>('all')
  const [editing, setEditing] = useState<Product | null | 'new'>(null)
  const [receiving, setReceiving] = useState<Product | null>(null)
  const [picking, setPicking] = useState(false)
  const toast = useToast()

  const low = products.filter(isLow)
  const noPrice = products.filter((p) => !p.price)
  const stockValue = products.reduce((a, p) => a + Math.max(p.stock, 0) * p.cost, 0)
  let list = filter === 'low' ? low : filter === 'noprice' ? noPrice : products
  list = q ? search(list, q, 200) : [...list].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  return (
    <main className="page">
      <div className="section-head">
        <h1>Items</h1>
        <div className="row">
          <button className="btn" onClick={() => setPicking(true)}><Sparkles size={18} />Add from list</button>
          <button className="btn primary" onClick={() => setEditing('new')}><Plus size={18} />New item</button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="top"><span className="label">Items</span><Boxes size={18} className="muted" /></div><div className="value">{products.length}</div></div>
        <div className="kpi"><div className="top"><span className="label">Running low</span><CircleAlert size={18} className="warn" /></div><div className="value warn">{low.length}</div></div>
        <div className="kpi"><div className="top"><span className="label">No price yet</span><Tag size={18} className="muted" /></div><div className="value">{noPrice.length}</div></div>
        <div className="kpi"><div className="top"><span className="label">Stock value (cost)</span><Coins size={18} className="muted" /></div><div className="value">{money(stockValue)}</div></div>
      </div>
      <label className="search"><Search size={20} /><input className="input" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="chips">
        <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All</button>
        <button className={'chip' + (filter === 'low' ? ' on' : '')} onClick={() => setFilter('low')}>Running low · {low.length}</button>
        <button className={'chip' + (filter === 'noprice' ? ' on' : '')} onClick={() => setFilter('noprice')}>No price · {noPrice.length}</button>
      </div>
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="item">
            <CatBadge category={p.category} />
            <button style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setEditing(p)}>
              <div className="ellipsis" style={{ fontWeight: 650 }}>{p.name}</div>
              <div className="meta">
                {p.price ? <span className="money" style={{ color: 'var(--ink)', fontWeight: 700 }}>{money(p.price)}</span> : <span className="warn">No price</span>}
                {p.cost > 0 && <> · cost {money(p.cost)}</>}{p.barcode && <> · <ScanBarcode size={12} style={{ verticalAlign: '-2px' }} /></>}
                {' · '}{stockTracked(p)
                  ? <span className={p.stock <= 0 ? 'bad' : isLow(p) ? 'warn' : 'good'} style={{ fontWeight: 650 }}>{p.stock} in stock</span>
                  : <span>stock not counted</span>}
              </div>
            </button>
            <button className="btn soft sm" onClick={() => setReceiving(p)} aria-label={`Stock in ${p.name}`}><PackagePlus size={16} /><span className="hide-narrow">Stock in</span></button>
          </div>
        ))}
        {!list.length && <div className="empty"><Boxes size={28} />Nothing to show.</div>}
      </div>

      {editing && <ItemEditor product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      {receiving && <ReceiveSheet product={receiving} onClose={() => setReceiving(null)} />}
      {picking && (
        <Sheet title="Caribbean item list" onClose={() => setPicking(false)}>
          <CatalogPicker existing={products.map((p) => p.name)} doneLabel="Add these"
            onDone={async (items) => { await db.products.bulkAdd(items.map(catalogToProduct)); setPicking(false); toast(`Added ${items.length} items`) }} />
        </Sheet>
      )}
    </main>
  )
}

const blank = (): Product => ({
  name: '', category: 'Groceries', aliases: [], price: 0, cost: 0, stock: 0, reorderAt: 3,
  packSize: 1, packName: 'case', unit: 'each', zeroRated: false, active: true, createdAt: Date.now(),
})

export function ItemEditor({ product, barcode, onClose, onSaved }: { product: Product | null; barcode?: string; onClose: () => void; onSaved: (p: Product) => void }) {
  const s = useSettings()
  const toast = useToast()
  const [p, setP] = useState<Product>(product ?? { ...blank(), barcode })
  const [aliases, setAliases] = useState(p.aliases.join(', '))
  const [scan, setScan] = useState(false)
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }))
  const suggested = p.cost ? suggestPrice(p.cost, s, p.zeroRated) : 0
  const margin = p.price && p.cost ? unitProfit(p.price, p.cost, s, p.zeroRated) : null

  const save = async () => {
    if (!p.name.trim()) { toast('Give the item a name.'); return }
    const clean = { ...p, name: p.name.trim(), aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) }
    if (clean.barcode) {
      const other = await db.products.where('barcode').equals(clean.barcode).first()
      if (other && other.id !== clean.id) { toast(`That barcode is already on ${other.name}.`); return }
    }
    if (clean.id) {
      const before = await db.products.get(clean.id)
      if (before && before.stock !== clean.stock) await adjustStock(clean.id, clean.stock, 'Edited count')
      await db.products.put(clean)
    } else {
      clean.id = await db.products.add(clean)
    }
    onSaved(clean)
  }

  const remove = async () => {
    if (!p.id) return
    await db.products.update(p.id, { active: false })
    onClose()
  }

  return (
    <Sheet title={product ? 'Edit item' : 'New item'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="row">
          <CatBadge category={p.category} />
          <label className="field grow">Name<input className="input" autoFocus={!product} value={p.name} onChange={(e) => set('name', e.target.value)} /></label>
        </div>
        <div className="card flat stack">
          <MoneyInput label="Selling price" value={p.price} onChange={(v) => set('price', v)} large />
          {suggested > 0 && suggested !== p.price && (
            <button type="button" className="btn soft" onClick={() => set('price', suggested)}>
              <Sparkles size={16} />Use suggested {money(suggested)} ({Math.round(s.defaultMarkup * 100)}% markup)
            </button>
          )}
          {margin != null && (
            <p className={'small ' + (margin > 0 ? 'good' : 'bad')}>You make {money(margin)} on each one{p.zeroRated ? '' : ' after VAT'}.</p>
          )}
          <MoneyInput label="Cost price (each)" hint="What one unit costs you" value={p.cost} onChange={(v) => set('cost', v)} />
        </div>
        <div className="row">
          <div className="grow"><NumberInput label="In stock" value={p.stock} onChange={(v) => set('stock', v)} /></div>
          <div className="grow"><NumberInput label="Warn me at" value={p.reorderAt} onChange={(v) => set('reorderAt', v)} /></div>
        </div>
        <div className="row">
          <div className="grow"><NumberInput label="Units per case" value={p.packSize} onChange={(v) => set('packSize', Math.max(1, Math.round(v)))} /></div>
          <label className="field grow">Pack called
            <select className="input" value={p.packName} onChange={(e) => set('packName', e.target.value)}>
              {['case', 'pack', 'box', 'bag', 'tray', 'dozen', 'carton', 'bundle'].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label className="field">Section
          <select className="input" value={p.category} onChange={(e) => set('category', e.target.value)}>
            {[...new Set([...CATEGORIES, p.category])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">Other names people use <span className="hint">Comma separated, helps search and voice. e.g. sweet drink, soda</span>
          <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">Barcode<input className="input" inputMode="numeric" value={p.barcode ?? ''} onChange={(e) => set('barcode', e.target.value || undefined)} /></label>
          {canScan() && <button type="button" className="btn soft" onClick={() => setScan(true)}><ScanBarcode size={18} />Scan</button>}
        </div>
        <label className="check"><input type="checkbox" checked={p.zeroRated} onChange={(e) => set('zeroRated', e.target.checked)} /> No VAT on this item (zero-rated)</label>
        <button className="btn primary lg block">Save item</button>
        {p.id && <ConfirmButton label="Remove item" confirmLabel={`Tap again to remove ${p.name} (past sales are kept)`} onConfirm={remove} />}
      </form>
      {scan && <Scanner onCode={(c) => { set('barcode', c); setScan(false) }} onClose={() => setScan(false)} />}
    </Sheet>
  )
}

export function ReceiveSheet({ product: p, onClose }: { product: Product; onClose: () => void }) {
  const s = useSettings()
  const toast = useToast()
  const [packs, setPacks] = useState(1)
  const [units, setUnits] = useState(0)
  const [costMode, setCostMode] = useState<'pack' | 'unit'>(p.packSize > 1 ? 'pack' : 'unit')
  const [cost, setCost] = useState<Cents>(p.cost ? (p.packSize > 1 ? p.cost * p.packSize : p.cost) : 0)
  const qty = packs * p.packSize + units
  const each = costMode === 'pack' ? unitCost(cost, p.packSize) : cost
  const suggested = each ? suggestPrice(each, s, p.zeroRated) : 0
  const [updatePrice, setUpdatePrice] = useState(!p.price)

  const save = async () => {
    try {
      await receiveStock(p.id!, { packs, units, ...(cost ? (costMode === 'pack' ? { packCost: cost } : { unitCostEach: cost }) : {}) })
      if (updatePrice && suggested) await db.products.update(p.id!, { price: suggested })
      toast(`Added ${qty} × ${p.name}`)
      onClose()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <Sheet title="Stock coming in" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="row"><CatBadge category={p.category} /><strong className="grow">{p.name}</strong><span className="pill">{p.stock} in stock now</span></div>
        <div className="row">
          {p.packSize > 1 && <div className="grow"><NumberInput label={`${p.packName}s (${p.packSize} each)`} value={packs} onChange={setPacks} /></div>}
          <div className="grow"><NumberInput label={p.packSize > 1 ? 'Plus loose units' : 'How many'} value={p.packSize > 1 ? units : packs} onChange={p.packSize > 1 ? setUnits : setPacks} /></div>
        </div>
        {p.packSize > 1 && (
          <div className="seg">
            <button type="button" className={costMode === 'pack' ? 'on' : ''} onClick={() => setCostMode('pack')}>Cost per {p.packName}</button>
            <button type="button" className={costMode === 'unit' ? 'on' : ''} onClick={() => setCostMode('unit')}>Cost per unit</button>
          </div>
        )}
        <MoneyInput label={costMode === 'pack' ? `Cost of one ${p.packName}` : 'Cost of one unit'} value={cost} onChange={setCost} large />
        <div className="card flat stack tight">
          <div className="row spread"><span className="muted">Coming in</span><strong className="num">{qty} units</strong></div>
          {each > 0 && <div className="row spread"><span className="muted">Cost each</span><strong className="num">{money(each)}</strong></div>}
          {suggested > 0 && <div className="row spread"><span className="muted">Suggested price</span><strong className="num good">{money(suggested)}</strong></div>}
          <div className="row spread"><span className="muted">Selling price now</span><strong className="num">{p.price ? money(p.price) : 'not set'}</strong></div>
        </div>
        {suggested > 0 && suggested !== p.price && (
          <label className="check"><input type="checkbox" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} /> Change selling price to {money(suggested)}</label>
        )}
        <button className="btn primary lg block" disabled={qty <= 0}><PackagePlus size={20} />Add to stock</button>
      </form>
    </Sheet>
  )
}
