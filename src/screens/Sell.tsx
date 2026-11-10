import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer, type PayMethod, type Product, type Sale, type Settings } from '../lib/db'
import { cartTotals, roundCash, type Cents } from '../lib/money'
import { completeSale, creditCheck, PosError, type CartLine } from '../lib/ops'
import { search } from '../lib/search'
import { canScan, money, MoneyInput, Scanner, Sheet, useSettings, useToast } from '../ui'
import { ItemEditor } from './Items'

export function receiptText(sale: Sale, s: Settings, customer?: Customer): string {
  const d = new Date(sale.at)
  const lines = [
    s.shopName, s.phone, d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), '',
    ...sale.lines.map((l) => `${l.qty} x ${l.name}  ${money(l.price * l.qty)}`), '',
    `Total: ${money(sale.total)}`,
    `incl. VAT ${money(sale.vat)}`,
  ]
  if (sale.method === 'credit') lines.push(`On credit${customer ? ` - ${customer.name}` : ''}`)
  if (sale.usdPaid) lines.push(`Paid US${money(sale.usdPaid)}`)
  if (sale.cashPaid) lines.push(`Paid ${money(sale.cashPaid)}`)
  if (sale.change) lines.push(`Change ${money(sale.change)}`)
  lines.push('', 'Thank you!')
  return lines.filter((l, i) => l !== '' || i > 0).join('\n')
}

export function Sell() {
  const s = useSettings()
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? []
  const recent = useLiveQuery(() => db.sales.orderBy('at').reverse().limit(300).toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [needPrice, setNeedPrice] = useState<Product | null>(null)
  const [scanning, setScanning] = useState(false)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<{ sale: Sale; customer?: Customer } | null>(null)
  const [showCart, setShowCart] = useState(false)

  const popular = useMemo(() => {
    const count = new Map<number, number>()
    for (const sale of recent) for (const l of sale.lines) count.set(l.productId, (count.get(l.productId) ?? 0) + l.qty)
    return [...products].sort((a, b) => (count.get(b.id!) ?? 0) - (count.get(a.id!) ?? 0) || a.name.localeCompare(b.name)).slice(0, 24)
  }, [products, recent])

  const shown = q ? search(products, q, 30) : popular
  const totals = cartTotals(cart.map((l) => ({ price: l.price, qty: l.qty, zeroRated: l.product.zeroRated })), s)
  const count = cart.reduce((n, l) => n + l.qty, 0)

  const add = (p: Product, price = p.price) => {
    if (!price) { setNeedPrice(p); return }
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { product: p, qty: 1, price }]
    })
    setQ('')
  }

  const setQty = (id: number, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))))

  const onCode = useCallback((code: string) => {
    setScanning(false)
    const p = products.find((x) => x.barcode === code)
    if (p) add(p)
    else setUnknownCode(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

  return (
    <>
      <main className="screen stack">
        <div className="row">
          <input className="input lg grow" placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search item" />
          {canScan() && <button className="btn soft lg" onClick={() => setScanning(true)} aria-label="Scan barcode">▦ Scan</button>}
        </div>
        {!q && products.length > 0 && <p className="small muted">{recent.length ? 'Best sellers' : 'Your items'}</p>}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className="tile" onClick={() => add(p)}>
              <span className="name">{p.name}</span>
              <span className="row spread small">
                <strong>{p.price ? money(p.price) : <span className="warn">Set price</span>}</strong>
                <span className={p.stock <= p.reorderAt ? 'bad' : 'muted'}>{p.stock}</span>
              </span>
            </button>
          ))}
        </div>
        {q && !shown.length && <div className="banner warn">No item called "{q}". Add it in the Items tab.</div>}
        {!products.length && <div className="banner warn">No items yet. Go to Items to add what you sell.</div>}
      </main>

      {cart.length > 0 && (
        <div className="cartbar stack">
          {showCart && (
            <div className="list">
              {cart.map((l) => (
                <div key={l.product.id} className="item">
                  <div className="grow">
                    <div className="ellipsis">{l.product.name}</div>
                    <div className="small muted">{money(l.price)} each</div>
                  </div>
                  <div className="qty">
                    <button onClick={() => setQty(l.product.id!, l.qty - 1)} aria-label="Less">−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => setQty(l.product.id!, l.qty + 1)} aria-label="More">+</button>
                  </div>
                </div>
              ))}
              <button className="item muted" onClick={() => { setCart([]); setShowCart(false) }}>✕ Clear all</button>
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={() => setShowCart((v) => !v)}>{showCart ? '▾' : '▴'} {count} item{count === 1 ? '' : 's'}</button>
            <button className="btn good lg grow" onClick={() => setPaying(true)}>Pay {money(totals.total)}</button>
          </div>
        </div>
      )}

      {needPrice && <SetPrice product={needPrice} onClose={() => setNeedPrice(null)} onSet={(p) => { setNeedPrice(null); add(p) }} />}
      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
      {unknownCode && (
        <LinkBarcode code={unknownCode} products={products} onClose={() => setUnknownCode(null)}
          onLinked={(p) => { setUnknownCode(null); add(p) }} />
      )}
      {paying && (
        <PaySheet cart={cart} settings={s} onClose={() => setPaying(false)}
          onDone={(sale, customer) => { setPaying(false); setCart([]); setShowCart(false); setDone({ sale, customer }) }} />
      )}
      {done && <DoneSheet {...done} settings={s} onClose={() => setDone(null)} />}
    </>
  )
}

function SetPrice({ product, onClose, onSet }: { product: Product; onClose: () => void; onSet: (p: Product) => void }) {
  const [price, setPrice] = useState(0)
  const save = async () => {
    if (!price) return
    await db.products.update(product.id!, { price })
    onSet({ ...product, price })
  }
  return (
    <Sheet title={`Price for ${product.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <p className="muted">Enter it once, the app remembers.</p>
        <MoneyInput value={price} onChange={setPrice} autoFocus large />
        <button className="btn primary lg block" disabled={!price}>Save & add</button>
      </form>
    </Sheet>
  )
}

function LinkBarcode({ code, products, onClose, onLinked }: { code: string; products: Product[]; onClose: () => void; onLinked: (p: Product) => void }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const link = async (p: Product) => {
    await db.products.update(p.id!, { barcode: code })
    onLinked({ ...p, barcode: code })
  }
  if (creating) {
    return <ItemEditor product={null} barcode={code} onClose={onClose} onSaved={(p) => (p.price ? onLinked(p) : onClose())} />
  }
  return (
    <Sheet title="New barcode" onClose={onClose}>
      <div className="stack">
        <p className="muted">Barcode {code} isn't saved yet. Which item is it? The app will remember it next time.</p>
        <input className="input" autoFocus placeholder="Search your items" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {(q ? search(products, q, 8) : products.slice(0, 8)).map((p) => (
            <button key={p.id} className="item" onClick={() => link(p)}>
              <span className="grow">{p.name}</span>
              {p.barcode && <span className="pill warn">has a code</span>}
            </button>
          ))}
        </div>
        <button className="btn soft block" onClick={() => setCreating(true)}>+ It's a new item</button>
      </div>
    </Sheet>
  )
}

const METHODS: { id: PayMethod; label: string }[] = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'usd', label: 'US$' },
  { id: 'card', label: '💳 Card' },
  { id: 'credit', label: '📒 Credit' },
]

function quickNotes(total: Cents): Cents[] {
  const notes = [500, 1000, 2000, 5000, 10000]
  const out = new Set<Cents>()
  for (const n of notes) { const v = Math.ceil(total / n) * n; if (v > total) out.add(v) }
  return [...out].sort((a, b) => a - b).slice(0, 4)
}

function PaySheet({ cart, settings: s, onClose, onDone }: {
  cart: CartLine[]; settings: Settings; onClose: () => void; onDone: (sale: Sale, customer?: Customer) => void
}) {
  const toast = useToast()
  const [method, setMethod] = useState<PayMethod>('cash')
  const [cash, setCash] = useState<Cents>(0)
  const [usd, setUsd] = useState<Cents>(0)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [busy, setBusy] = useState(false)
  const t = cartTotals(cart.map((l) => ({ price: l.price, qty: l.qty, zeroRated: l.product.zeroRated })), s)
  const cashTotal = roundCash(t.total, s.cashRounding)
  const isCash = method === 'cash' || method === 'usd'
  const due = isCash ? cashTotal : t.total
  const paid = cash + Math.round(usd * s.usdRate)
  const change = paid - due
  const limit = customer ? creditCheck(customer, t.total) : null

  const finish = async (allowOverLimit = false) => {
    setBusy(true)
    try {
      const m: PayMethod = method === 'usd' && cash > 0 ? 'mixed' : method
      const sale = await completeSale(cart, {
        method: m, cashPaid: isCash ? (method === 'cash' && !cash ? cashTotal : cash) : 0,
        usdPaid: method === 'usd' ? usd : 0, customerId: customer?.id,
      }, { allowOverLimit })
      onDone(sale, customer ?? undefined)
    } catch (e) {
      toast(e instanceof PosError ? e.message : 'Could not save the sale.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Payment" onClose={onClose}>
      <div className="stack">
        <div className="center">
          <div className="huge">{money(due)}</div>
          {t.vat > 0 && <div className="small muted">includes VAT {money(t.vat)}</div>}
        </div>
        <div className="chips" role="tablist">
          {METHODS.map((m) => <button key={m.id} className={m.id === method ? 'on' : ''} onClick={() => setMethod(m.id)}>{m.label}</button>)}
        </div>

        {method === 'cash' && (
          <>
            <div className="row wrap">
              <button className="btn soft" onClick={() => setCash(cashTotal)}>Exact</button>
              {quickNotes(cashTotal).map((n) => <button key={n} className="btn" onClick={() => setCash(n)}>{money(n)}</button>)}
            </div>
            <MoneyInput label="Cash handed over" value={cash} onChange={setCash} large />
            {cash > 0 && <div className={'banner ' + (change >= 0 ? 'good' : 'bad')}>{change >= 0 ? `Change: ${money(change)}` : `Still owes ${money(-change)}`}</div>}
            <button className="btn good lg block" disabled={busy || (cash > 0 && change < 0)} onClick={() => finish()}>
              {cash ? 'Done' : 'Paid exact'}
            </button>
          </>
        )}

        {method === 'usd' && (
          <>
            <p className="small muted">US$1 = {money(Math.round(100 * s.usdRate))}. Change is given in local money.</p>
            <MoneyInput label="US$ handed over" value={usd} onChange={setUsd} large />
            <MoneyInput label="Plus local cash (if any)" value={cash} onChange={setCash} />
            {paid > 0 && <div className={'banner ' + (change >= 0 ? 'good' : 'bad')}>{change >= 0 ? `Change: ${money(roundCash(change, s.cashRounding))}` : `Still owes ${money(-change)}`}</div>}
            <button className="btn good lg block" disabled={busy || paid <= 0 || change < 0} onClick={() => finish()}>Done</button>
          </>
        )}

        {method === 'card' && (
          <>
            <p className="muted">Charge {money(t.total)} on the card machine, then tap Done.</p>
            <button className="btn good lg block" disabled={busy} onClick={() => finish()}>Card paid</button>
          </>
        )}

        {method === 'credit' && (
          <>
            <CustomerPicker selected={customer} onPick={setCustomer} />
            {customer && limit && (
              <div className={'banner ' + (limit.ok ? 'good' : 'bad')}>
                {customer.name} owes {money(customer.balance)} now, {money(limit.newBalance)} after this.
                {!limit.ok && <> Over their limit by {money(limit.over)}.</>}
              </div>
            )}
            {customer && limit?.ok && <button className="btn good lg block" disabled={busy} onClick={() => finish()}>Put on credit</button>}
            {customer && limit && !limit.ok && <button className="btn danger lg block" disabled={busy} onClick={() => finish(true)}>Allow anyway</button>}
          </>
        )}
      </div>
    </Sheet>
  )
}

export function CustomerPicker({ selected, onPick }: { selected: Customer | null; onPick: (c: Customer | null) => void }) {
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  if (selected) {
    return (
      <div className="card row">
        <div className="grow"><strong>{selected.name}</strong><div className="small muted">owes {money(selected.balance)}</div></div>
        <button className="btn" onClick={() => onPick(null)}>Change</button>
      </div>
    )
  }
  if (adding) {
    return (
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const c: Customer = { name: name.trim(), nickname: '', phone, creditLimit: 0, balance: 0, note: '', createdAt: Date.now() }
        c.id = await db.customers.add(c)
        onPick(c)
      }}>
        <input className="input" autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" inputMode="tel" placeholder="Phone (for WhatsApp reminders)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn primary block">Save customer</button>
      </form>
    )
  }
  const list = q ? search(customers.map((c) => ({ ...c, aliases: [c.nickname, c.phone] })), q, 8) : [...customers].sort((a, b) => b.balance - a.balance).slice(0, 8)
  return (
    <div className="stack">
      <input className="input" placeholder="Who is it for?" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="item" onClick={() => onPick(c)}>
            <span className="grow">{c.name}{c.nickname ? ` (${c.nickname})` : ''}</span>
            <span className={c.balance > 0 ? 'warn' : 'muted'}>{money(c.balance)}</span>
          </button>
        ))}
        <button className="item" onClick={() => { setAdding(true); setName(q) }}>+ New customer{q ? ` "${q}"` : ''}</button>
      </div>
    </div>
  )
}

function DoneSheet({ sale, customer, settings, onClose }: { sale: Sale; customer?: Customer; settings: Settings; onClose: () => void }) {
  const text = receiptText(sale, settings, customer)
  const phone = customer?.phone.replace(/\D/g, '')
  const to = phone ? (phone.length === 7 ? settings.countryCode + phone : phone) : ''
  return (
    <Sheet title="Sale done ✓" onClose={onClose}>
      <div className="stack center">
        {sale.change > 0 ? (
          <><div className="muted">Give change</div><div className="huge good">{money(sale.change)}</div></>
        ) : (
          <div className="big">{sale.method === 'credit' ? `${money(sale.total)} on ${customer?.name}'s credit` : money(sale.total)}</div>
        )}
        <a className="btn soft block" href={`https://wa.me/${to}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send receipt on WhatsApp</a>
        <button className="btn primary lg block" autoFocus onClick={onClose}>Next customer</button>
      </div>
    </Sheet>
  )
}
