import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, Check, ChevronUp, CreditCard, DollarSign, LayoutGrid, MessageCircle, Minus, NotebookPen, Plus, ScanBarcode, Search, ShoppingCart, Trash2, UserPlus } from 'lucide-react'
import { db, isLow, stockTracked, type Customer, type PayMethod, type Product, type Sale, type Settings } from '../lib/db'
import { cartTotals, roundCash, type Cents } from '../lib/money'
import { completeSale, creditCheck, PosError, type CartLine } from '../lib/ops'
import { search } from '../lib/search'
import { categoryMeta } from '../theme'
import { canScan, CatBadge, initials, Keypad, money, MoneyInput, Scanner, Sheet, useSettings, useToast, useWide } from '../ui'
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
  const wide = useWide()
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? []
  const recent = useLiveQuery(() => db.sales.orderBy('at').reverse().limit(300).toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [needPrice, setNeedPrice] = useState<Product | null>(null)
  const [scanning, setScanning] = useState(false)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState<{ sale: Sale; customer?: Customer } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)

  const popular = useMemo(() => {
    const count = new Map<number, number>()
    for (const sale of recent) for (const l of sale.lines) count.set(l.productId, (count.get(l.productId) ?? 0) + l.qty)
    return [...products].sort((a, b) => (count.get(b.id!) ?? 0) - (count.get(a.id!) ?? 0) || a.name.localeCompare(b.name))
  }, [products, recent])
  const cats = useMemo(() => [...new Set(products.map((p) => p.category))], [products])

  const shown = q ? search(products, q, 40) : cat ? popular.filter((p) => p.category === cat) : popular.slice(0, 48)
  const totals = cartTotals(cart.map((l) => ({ price: l.price, qty: l.qty, zeroRated: l.product.zeroRated })), s)
  const count = cart.reduce((n, l) => n + l.qty, 0)
  const inCart = new Map(cart.map((l) => [l.product.id, l.qty]))

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

  const cartPanel = (
    <CartPanel cart={cart} totals={totals} count={count} onQty={setQty} onClear={() => setCart([])}
      onPay={() => { setCartOpen(false); setPaying(true) }} />
  )

  return (
    <div className="sell">
      <section className="sell-products">
        <div className="row">
          <label className="search">
            <Search size={20} />
            <input className="input" placeholder="Search items, e.g. sweet drink, corn beef" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          </label>
          {canScan() && <button className="btn soft lg" onClick={() => setScanning(true)} aria-label="Scan barcode"><ScanBarcode size={22} />{wide && 'Scan'}</button>}
        </div>
        {!q && cats.length > 1 && (
          <div className="chips" role="tablist" aria-label="Sections">
            <button className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}><LayoutGrid size={15} />{recent.length ? 'Best sellers' : 'All'}</button>
            {cats.map((c) => {
              const { Icon } = categoryMeta(c)
              return <button key={c} className={'chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}><Icon size={15} />{c}</button>
            })}
          </div>
        )}
        <div className="grid">
          {shown.map((p) => (
            <button key={p.id} className={'tile' + (inCart.has(p.id) ? ' on' : '')} onClick={() => add(p)}>
              <CatBadge category={p.category} small />
              {inCart.has(p.id) && <span className="incart">{inCart.get(p.id)}</span>}
              <span className="name">{p.name}</span>
              <span className="foot">
                {p.price ? <span className="price">{money(p.price)}</span> : <span className="price unset">Set price</span>}
                {stockTracked(p) && <span className={'pill' + (p.stock <= 0 ? ' bad' : isLow(p) ? ' warn' : '')}>{p.stock} left</span>}
              </span>
            </button>
          ))}
        </div>
        {q && !shown.length && <div className="empty"><Search size={28} />No item called "{q}". Add it in Items.</div>}
        {!products.length && <div className="empty"><ShoppingCart size={28} />No items yet. Go to Items to add what you sell.</div>}
      </section>

      {wide ? <aside className="cart-aside" aria-label="Basket">{cartPanel}</aside> : cart.length > 0 && (
        <div className="cartbar">
          <button className="btn" onClick={() => setCartOpen(true)}><ChevronUp size={18} />{count} item{count === 1 ? '' : 's'}</button>
          <button className="btn pay lg grow" onClick={() => setPaying(true)}>Pay {money(roundCash(totals.total, s.cashRounding))}</button>
        </div>
      )}

      {!wide && cartOpen && <Sheet title="Basket" onClose={() => setCartOpen(false)}>{cartPanel}</Sheet>}
      {needPrice && <SetPrice product={needPrice} onClose={() => setNeedPrice(null)} onSet={(p) => { setNeedPrice(null); add(p) }} />}
      {scanning && <Scanner onCode={onCode} onClose={() => setScanning(false)} />}
      {unknownCode && <LinkBarcode code={unknownCode} products={products} onClose={() => setUnknownCode(null)} onLinked={(p) => { setUnknownCode(null); add(p) }} />}
      {paying && (
        <PaySheet cart={cart} settings={s} onClose={() => setPaying(false)}
          onDone={(sale, customer) => { setPaying(false); setCart([]); setDone({ sale, customer }) }} />
      )}
      {done && <DoneSheet {...done} settings={s} onClose={() => setDone(null)} />}
    </div>
  )
}

function CartPanel({ cart, totals, count, onQty, onClear, onPay }: {
  cart: CartLine[]; totals: { subtotal: Cents; vat: Cents; total: Cents }; count: number
  onQty: (id: number, q: number) => void; onClear: () => void; onPay: () => void
}) {
  const s = useSettings()
  const due = roundCash(totals.total, s.cashRounding)
  return (
    <div className="cart">
      <div className="cart-head">
        <h2>Basket {count > 0 && <span className="pill brand">{count}</span>}</h2>
        {cart.length > 0 && <button className="btn ghost sm" onClick={onClear}><Trash2 size={16} />Clear</button>}
      </div>
      <div className="cart-lines">
        {cart.length === 0 ? (
          <div className="empty"><ShoppingCart size={32} /><span>Tap items to add them here.</span></div>
        ) : cart.map((l) => (
          <div key={l.product.id} className="cart-line">
            <CatBadge category={l.product.category} small />
            <div className="grow">
              <div className="lname ellipsis">{l.product.name}</div>
              <div className="tiny muted">{money(l.price)} each</div>
            </div>
            <div className="qty">
              <button onClick={() => onQty(l.product.id!, l.qty - 1)} aria-label={`One less ${l.product.name}`}><Minus size={16} /></button>
              <span>{l.qty}</span>
              <button onClick={() => onQty(l.product.id!, l.qty + 1)} aria-label={`One more ${l.product.name}`}><Plus size={16} /></button>
            </div>
            <span className="ltotal">{money(l.price * l.qty)}</span>
          </div>
        ))}
      </div>
      <div className="cart-foot">
        <div className="totals stack tight">
          <div className="row"><span>Before VAT</span><span className="num">{money(totals.subtotal)}</span></div>
          <div className="row"><span>VAT</span><span className="num">{money(totals.vat)}</span></div>
          <div className="row" style={{ alignItems: 'baseline' }}><span style={{ color: 'var(--ink)', fontWeight: 650 }}>Total</span><span className="grand">{money(due)}</span></div>
        </div>
        <button className="btn pay lg block" disabled={!cart.length} onClick={onPay}>Take payment</button>
      </div>
    </div>
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
        <p className="muted">Enter it once and the app remembers it.</p>
        <MoneyInput value={price} onChange={setPrice} autoFocus large />
        <button className="btn primary lg block" disabled={!price}>Save and add</button>
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
  if (creating) return <ItemEditor product={null} barcode={code} onClose={onClose} onSaved={(p) => (p.price ? onLinked(p) : onClose())} />
  return (
    <Sheet title="New barcode" onClose={onClose}>
      <div className="stack">
        <p className="muted">Barcode {code} isn't saved yet. Which item is it? The app will remember it next time.</p>
        <label className="search"><Search size={18} /><input className="input" autoFocus placeholder="Search your items" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="list">
          {(q ? search(products, q, 8) : products.slice(0, 8)).map((p) => (
            <button key={p.id} className="item" onClick={() => link(p)}>
              <CatBadge category={p.category} small />
              <span className="grow">{p.name}</span>
              {p.barcode && <span className="pill warn">has a code</span>}
            </button>
          ))}
        </div>
        <button className="btn soft block" onClick={() => setCreating(true)}><Plus size={18} />It's a new item</button>
      </div>
    </Sheet>
  )
}

const METHODS = [
  { id: 'cash', label: 'Cash', Icon: Banknote },
  { id: 'usd', label: 'US$', Icon: DollarSign },
  { id: 'card', label: 'Card', Icon: CreditCard },
  { id: 'credit', label: 'Credit', Icon: NotebookPen },
] as const

function quickNotes(total: Cents): Cents[] {
  const notes = [500, 1000, 2000, 5000, 10000]
  const out = new Set<Cents>()
  for (const n of notes) { const v = Math.ceil(total / n) * n; if (v > total) out.add(v) }
  return [...out].sort((a, b) => a - b).slice(0, 3)
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
    <Sheet title="Take payment" onClose={onClose}>
      <div className="stack">
        <div className="card flat center stack tight">
          <span className="label">Amount due</span>
          <div className="huge">{money(due)}</div>
          {t.vat > 0 && <div className="small muted">includes VAT {money(t.vat)}</div>}
        </div>
        <div className="seg" role="tablist" aria-label="Payment method">
          {METHODS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={id === method} className={id === method ? 'on' : ''} onClick={() => setMethod(id)}>
              <Icon size={20} />{label}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <>
            <div className="amount-display">
              <span className="label">Cash given</span>
              <span className="val">{money(cash)}</span>
            </div>
            <div className="row wrap">
              <button className="btn soft grow" onClick={() => setCash(cashTotal)}>Exact</button>
              {quickNotes(cashTotal).map((n) => <button key={n} className="btn grow" onClick={() => setCash(n)}>{money(n)}</button>)}
            </div>
            <Keypad value={cash} onChange={setCash} />
            {cash > 0 && (
              <div className={'banner ' + (change >= 0 ? 'good' : 'bad')}>
                {change >= 0 ? <>Change to give <strong className="money" style={{ marginLeft: 'auto', fontSize: '1.3rem' }}>{money(change)}</strong></> : `Still owes ${money(-change)}`}
              </div>
            )}
            <button className="btn pay lg block" disabled={busy || (cash > 0 && change < 0)} onClick={() => finish()}>
              <Check size={22} />{cash ? 'Complete sale' : 'Paid exact amount'}
            </button>
          </>
        )}

        {method === 'usd' && (
          <>
            <p className="small muted">US$1 = {money(Math.round(100 * s.usdRate))}. Change is given in local money.</p>
            <MoneyInput label="US$ handed over" value={usd} onChange={setUsd} large />
            <MoneyInput label="Plus local cash (if any)" value={cash} onChange={setCash} />
            {paid > 0 && <div className={'banner ' + (change >= 0 ? 'good' : 'bad')}>{change >= 0 ? `Change to give: ${money(roundCash(change, s.cashRounding))}` : `Still owes ${money(-change)}`}</div>}
            <button className="btn pay lg block" disabled={busy || paid <= 0 || change < 0} onClick={() => finish()}><Check size={22} />Complete sale</button>
          </>
        )}

        {method === 'card' && (
          <>
            <div className="banner brand"><CreditCard size={18} />Charge {money(t.total)} on the card machine, then tap below.</div>
            <button className="btn pay lg block" disabled={busy} onClick={() => finish()}><Check size={22} />Card payment approved</button>
          </>
        )}

        {method === 'credit' && (
          <>
            <CustomerPicker selected={customer} onPick={setCustomer} />
            {customer && limit && (
              <div className={'banner ' + (limit.ok ? 'brand' : 'bad')}>
                {customer.name} owes {money(customer.balance)} now, {money(limit.newBalance)} after this.
                {!limit.ok && <> Over their limit by {money(limit.over)}.</>}
              </div>
            )}
            {customer && limit?.ok && <button className="btn pay lg block" disabled={busy} onClick={() => finish()}><NotebookPen size={20} />Put on {customer.nickname || customer.name.split(' ')[0]}'s credit</button>}
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
      <div className="card flat row">
        <span className="avatar">{initials(selected.name)}</span>
        <div className="grow"><strong>{selected.name}</strong><div className="small muted">owes {money(selected.balance)}</div></div>
        <button className="btn sm" onClick={() => onPick(null)}>Change</button>
      </div>
    )
  }
  if (adding) {
    return (
      <form className="card flat stack" onSubmit={async (e) => {
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
      <label className="search"><Search size={18} /><input className="input" placeholder="Who is it for?" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="item" onClick={() => onPick(c)}>
            <span className="avatar">{initials(c.name)}</span>
            <span className="grow">{c.name}{c.nickname ? <span className="muted"> ({c.nickname})</span> : ''}</span>
            <span className={'money ' + (c.balance > 0 ? 'warn' : 'muted')}>{money(c.balance)}</span>
          </button>
        ))}
        <button className="item" onClick={() => { setAdding(true); setName(q) }}><span className="avatar"><UserPlus size={18} /></span>New customer{q ? ` "${q}"` : ''}</button>
      </div>
    </div>
  )
}

function DoneSheet({ sale, customer, settings, onClose }: { sale: Sale; customer?: Customer; settings: Settings; onClose: () => void }) {
  const text = receiptText(sale, settings, customer)
  const phone = customer?.phone.replace(/\D/g, '')
  const to = phone ? (phone.length === 7 ? settings.countryCode + phone : phone) : ''
  const time = new Date(sale.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <Sheet title="Sale complete" onClose={onClose}>
      <div className="stack">
        {sale.change > 0 && (
          <div className="banner good" style={{ justifyContent: 'space-between' }}>
            <span>Give change</span><span className="huge" style={{ fontSize: '2rem' }}>{money(sale.change)}</span>
          </div>
        )}
        <div className="receipt">
          <div className="center stack tight">
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{settings.shopName}</strong>
            <span className="tiny muted">{settings.phone ? `${settings.phone} · ` : ''}{time}</span>
          </div>
          <div className="rule" />
          <div className="stack tight">
            {sale.lines.map((l, i) => (
              <div key={i} className="rline"><span>{l.qty} × {l.name}</span><span>{money(l.qty * l.price)}</span></div>
            ))}
          </div>
          <div className="rule" />
          <div className="rline"><strong>Total</strong><strong className="money">{money(sale.total)}</strong></div>
          <div className="rline muted"><span>incl. VAT</span><span>{money(sale.vat)}</span></div>
          {sale.method === 'credit' && <div className="rline warn"><span>On credit</span><span>{customer?.name}</span></div>}
          {sale.cashPaid > 0 && <div className="rline muted"><span>Cash</span><span>{money(sale.cashPaid)}</span></div>}
          {sale.usdPaid > 0 && <div className="rline muted"><span>US$</span><span>{money(sale.usdPaid)}</span></div>}
        </div>
        <a className="btn soft block" href={`https://wa.me/${to}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={18} />Send receipt on WhatsApp</a>
        <button className="btn primary lg block" autoFocus onClick={onClose}>Next customer</button>
      </div>
    </Sheet>
  )
}
