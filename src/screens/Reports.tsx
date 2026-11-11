import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, CircleAlert, CreditCard, HandCoins, NotebookPen, Percent, Receipt, TrendingUp, Users } from 'lucide-react'
import { db, isLow, type Sale } from '../lib/db'
import { voidSale } from '../lib/ops'
import { CatBadge, ConfirmButton, money, Sheet, useToast } from '../ui'

const DAY = 86400000
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
const short = (c: number) => (c >= 100000 ? `$${(c / 100000).toFixed(1)}k` : `$${Math.round(c / 100)}`)

export function Reports() {
  const toast = useToast()
  const since = startOfDay(Date.now()) - 29 * DAY
  const sales = useLiveQuery(() => db.sales.where('at').aboveOrEqual(since).toArray(), [since]) ?? []
  const credit = useLiveQuery(() => db.credit.where('at').aboveOrEqual(startOfDay(Date.now())).toArray(), []) ?? []
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? []
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? []
  const [range, setRange] = useState<1 | 7 | 30>(1)
  const [viewing, setViewing] = useState<Sale | null>(null)

  const from = startOfDay(Date.now()) - (range - 1) * DAY
  const inRange = sales.filter((s) => !s.voided && s.at >= from)
  const sum = (f: (s: Sale) => number, list = inRange) => list.reduce((a, s) => a + f(s), 0)
  const byMethod = (m: Sale['method'][]) => sum((s) => (m.includes(s.method) ? s.total : 0))
  const paymentsToday = credit.filter((c) => c.type === 'payment').reduce((a, c) => a + c.amount, 0)
  const owed = customers.reduce((a, c) => a + Math.max(c.balance, 0), 0)
  const total = sum((s) => s.total)

  const days = useMemo(() => {
    const out: { label: string; total: number; today: boolean }[] = []
    for (let i = 6; i >= 0; i--) {
      const d0 = startOfDay(Date.now()) - i * DAY
      const t = sales.filter((s) => !s.voided && s.at >= d0 && s.at < d0 + DAY).reduce((a, s) => a + s.total, 0)
      out.push({ label: new Date(d0).toLocaleDateString('en-GB', { weekday: 'short' }), total: t, today: i === 0 })
    }
    return out
  }, [sales])
  const maxDay = Math.max(1, ...days.map((d) => d.total))

  const best = useMemo(() => {
    const m = new Map<string, { qty: number; total: number; productId: number }>()
    for (const s of inRange) for (const l of s.lines) {
      const cur = m.get(l.name) ?? { qty: 0, total: 0, productId: l.productId }
      m.set(l.name, { qty: cur.qty + l.qty, total: cur.total + l.qty * l.price, productId: l.productId })
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)
  }, [inRange])
  const bestMax = Math.max(1, ...best.map(([, v]) => v.total))
  const catOf = new Map(products.map((p) => [p.id, p.category]))

  const low = products.filter(isLow).sort((a, b) => a.stock - b.stock)
  const stockValue = products.reduce((a, p) => a + Math.max(p.stock, 0) * p.cost, 0)
  const label = range === 1 ? 'Today' : `Last ${range} days`
  const noCostSales = inRange.reduce((a, s) => a + s.lines.filter((l) => !l.cost).reduce((b, l) => b + l.qty * l.price, 0), 0)

  const methods = [
    { label: 'Cash (incl. US$)', Icon: Banknote, value: byMethod(['cash', 'usd', 'mixed']), cls: '' },
    { label: 'Card', Icon: CreditCard, value: byMethod(['card']), cls: '' },
    { label: 'On credit', Icon: NotebookPen, value: byMethod(['credit']), cls: 'warn' },
  ]

  return (
    <main className="page">
      <div className="section-head">
        <h1>Reports</h1>
        <div className="chips">
          {([1, 7, 30] as const).map((r) => <button key={r} className={'chip' + (r === range ? ' on' : '')} onClick={() => setRange(r)}>{r === 1 ? 'Today' : `${r} days`}</button>)}
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="top"><span className="label">{label}: sales</span><TrendingUp size={18} className="muted" /></div><div className="value">{money(total)}</div></div>
        <div className="kpi"><div className="top"><span className="label">Profit</span><HandCoins size={18} className="good" /></div><div className="value good">{money(sum((s) => s.profit))}</div></div>
        <div className="kpi"><div className="top"><span className="label">Customers served</span><Users size={18} className="muted" /></div><div className="value">{inRange.length}</div></div>
        <div className="kpi"><div className="top"><span className="label">VAT collected</span><Percent size={18} className="muted" /></div><div className="value">{money(sum((s) => s.vat))}</div></div>
      </div>
      {noCostSales > 0 && (
        <div className="banner warn"><CircleAlert size={18} />Profit leaves out {money(noCostSales)} of sales on items with no cost price yet. Use "Stock in" in Items to add cost prices.</div>
      )}

      <div className="two-col">
        <div className="card stack">
          <div className="section-head"><h2>Last 7 days</h2><span className="small muted">{money(days.reduce((a, d) => a + d.total, 0))}</span></div>
          <div className="bars" role="img" aria-label="Sales for each of the last 7 days">
            {days.map((d) => (
              <div className={'bar' + (d.today ? ' today' : '')} key={d.label} title={money(d.total)}>
                <span className="v">{d.total ? short(d.total) : ''}</span>
                <div className="fill" style={{ height: `${(d.total / maxDay) * 100}%` }} />
                <span className="d">{d.today ? 'Today' : d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card stack">
          <h2>How people paid</h2>
          {methods.map(({ label: l, Icon, value, cls }) => (
            <div key={l} className="stack tight">
              <div className="row spread"><span className="row small"><Icon size={16} className="muted" />{l}</span><strong className={'money ' + cls}>{money(value)}</strong></div>
              <div className="meter"><div style={{ width: `${total ? (value / total) * 100 : 0}%`, background: cls ? 'var(--warn)' : undefined }} /></div>
            </div>
          ))}
          <div className="row spread small" style={{ marginTop: 6 }}><span className="muted">Credit paid back today</span><strong className="money good">{money(paymentsToday)}</strong></div>
          <div className="row spread small"><span className="muted">Total people owe you</span><strong className="money warn">{money(owed)}</strong></div>
        </div>
      </div>

      <div className="two-col">
        <div className="card stack">
          <h2>Best sellers <span className="small muted" style={{ fontWeight: 500 }}>· {label.toLowerCase()}</span></h2>
          {best.length ? best.map(([name, v]) => (
            <div key={name} className="row">
              <CatBadge category={catOf.get(v.productId) ?? ''} small />
              <div className="grow stack tight">
                <div className="row spread small"><span className="ellipsis">{name}</span><strong className="money">{money(v.total)}</strong></div>
                <div className="row" style={{ gap: 8 }}><div className="meter grow"><div style={{ width: `${(v.total / bestMax) * 100}%` }} /></div><span className="tiny muted num">{v.qty} sold</span></div>
              </div>
            </div>
          )) : <p className="muted">No sales yet.</p>}
        </div>
        <div className="card stack">
          <div className="section-head"><h2>Running low</h2><span className="small muted">Stock worth {money(stockValue)}</span></div>
          {low.length ? low.slice(0, 10).map((p) => (
            <div key={p.id} className="row"><CatBadge category={p.category} small /><span className="ellipsis grow small">{p.name}</span><span className={p.stock <= 0 ? 'pill bad' : 'pill warn'}>{p.stock} left</span></div>
          )) : <p className="muted">Nothing running low.</p>}
        </div>
      </div>

      <div className="card stack">
        <h2>Recent sales</h2>
        <div className="list" style={{ boxShadow: 'none' }}>
          {[...sales].sort((a, b) => b.at - a.at).slice(0, 15).map((s) => (
            <button key={s.id} className="item" onClick={() => setViewing(s)}>
              <span className="badge sm" style={{ ['--hue' as string]: s.method === 'credit' ? '#a8620c' : '#0e7c74' }}>{s.method === 'credit' ? <NotebookPen size={16} /> : s.method === 'card' ? <CreditCard size={16} /> : <Receipt size={16} />}</span>
              <span className="small muted num">{new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="grow ellipsis small">{s.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</span>
              <strong className={'money' + (s.voided ? ' muted' : '')} style={s.voided ? { textDecoration: 'line-through' } : undefined}>{money(s.total)}</strong>
            </button>
          ))}
          {!sales.length && <div className="empty"><Receipt size={28} />No sales yet.</div>}
        </div>
      </div>
      {viewing && (
        <Sheet title="Sale" onClose={() => setViewing(null)}>
          <div className="stack">
            <p className="muted">{new Date(viewing.at).toLocaleString('en-GB')} · paid by {viewing.method}</p>
            <div className="receipt">
              {viewing.lines.map((l, i) => <div key={i} className="rline"><span>{l.qty} × {l.name}</span><span>{money(l.qty * l.price)}</span></div>)}
              <div className="rule" />
              <div className="rline"><strong>Total</strong><strong className="money">{money(viewing.total)}</strong></div>
            </div>
            {viewing.voided ? <div className="banner warn">This sale was cancelled.</div> : (
              <ConfirmButton label="Cancel this sale"
                confirmLabel={'Tap again: stock goes back' + (viewing.method === 'credit' ? ' and it comes off their credit' : '')}
                onConfirm={async () => { await voidSale(viewing.id!); toast('Sale cancelled'); setViewing(null) }} />
            )}
          </div>
        </Sheet>
      )}
    </main>
  )
}
