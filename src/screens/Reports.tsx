import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../lib/db'
import { voidSale } from '../lib/ops'
import { ConfirmButton, money, Sheet, useToast } from '../ui'

const DAY = 86400000
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

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

  const days = useMemo(() => {
    const out: { label: string; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d0 = startOfDay(Date.now()) - i * DAY
      const total = sales.filter((s) => !s.voided && s.at >= d0 && s.at < d0 + DAY).reduce((a, s) => a + s.total, 0)
      out.push({ label: new Date(d0).toLocaleDateString('en-GB', { weekday: 'short' }), total })
    }
    return out
  }, [sales])
  const maxDay = Math.max(1, ...days.map((d) => d.total))

  const best = useMemo(() => {
    const m = new Map<string, { qty: number; total: number }>()
    for (const s of inRange) for (const l of s.lines) {
      const cur = m.get(l.name) ?? { qty: 0, total: 0 }
      m.set(l.name, { qty: cur.qty + l.qty, total: cur.total + l.qty * l.price })
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)
  }, [inRange])

  const low = products.filter((p) => p.stock <= p.reorderAt).sort((a, b) => a.stock - b.stock)
  const stockValue = products.reduce((a, p) => a + Math.max(p.stock, 0) * p.cost, 0)
  const label = range === 1 ? 'Today' : `Last ${range} days`
  const noCostSales = inRange.reduce((a, s) => a + s.lines.filter((l) => !l.cost).reduce((b, l) => b + l.qty * l.price, 0), 0)

  return (
    <main className="screen stack">
      <div className="chips">
        {([1, 7, 30] as const).map((r) => <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r === 1 ? 'Today' : `${r} days`}</button>)}
      </div>
      <div className="stats">
        <div className="stat"><div className="label">{label}: sales</div><div className="value">{money(sum((s) => s.total))}</div></div>
        <div className="stat"><div className="label">Profit</div><div className="value good">{money(sum((s) => s.profit))}</div></div>
        <div className="stat"><div className="label">Customers served</div><div className="value">{inRange.length}</div></div>
        <div className="stat"><div className="label">VAT collected</div><div className="value">{money(sum((s) => s.vat))}</div></div>
      </div>
      {noCostSales > 0 && (
        <p className="small muted">Profit leaves out {money(noCostSales)} of sales on items with no cost price yet. Add cost prices in Items (or use "+ Stock") to see full profit.</p>
      )}
      <div className="card stack">
        <h3>How people paid</h3>
        <div className="row spread"><span>Cash (incl. US$)</span><strong>{money(byMethod(['cash', 'usd', 'mixed']))}</strong></div>
        <div className="row spread"><span>Card</span><strong>{money(byMethod(['card']))}</strong></div>
        <div className="row spread"><span>On credit</span><strong className="warn">{money(byMethod(['credit']))}</strong></div>
        <div className="row spread"><span>Credit paid back today</span><strong className="good">{money(paymentsToday)}</strong></div>
        <div className="row spread"><span>Total people owe you</span><strong className="warn">{money(owed)}</strong></div>
      </div>
      <div className="card stack">
        <h3>Last 7 days</h3>
        <div className="bars">
          {days.map((d) => (
            <div className="bar" key={d.label} title={money(d.total)}>
              <div style={{ height: `${(d.total / maxDay) * 100}%` }} />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      {best.length > 0 && (
        <div className="card stack">
          <h3>Best sellers ({label.toLowerCase()})</h3>
          {best.map(([name, v]) => (
            <div key={name} className="row spread"><span className="ellipsis grow">{v.qty}× {name}</span><strong>{money(v.total)}</strong></div>
          ))}
        </div>
      )}
      <div className="card stack">
        <div className="row spread"><h3>Running low</h3><span className="small muted">Stock worth {money(stockValue)} at cost</span></div>
        {low.length ? low.slice(0, 15).map((p) => (
          <div key={p.id} className="row spread"><span className="ellipsis grow">{p.name}</span><span className={p.stock <= 0 ? 'pill bad' : 'pill warn'}>{p.stock} left</span></div>
        )) : <p className="muted">Nothing running low.</p>}
      </div>
      <div className="card stack">
        <h3>Recent sales</h3>
        {[...sales].sort((a, b) => b.at - a.at).slice(0, 15).map((s) => (
          <button key={s.id} className="item" style={{ padding: '8px 0' }} onClick={() => setViewing(s)}>
            <span className="small muted">{new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="grow ellipsis">{s.lines.map((l) => l.name).join(', ')}</span>
            <strong className={s.voided ? 'muted' : ''} style={s.voided ? { textDecoration: 'line-through' } : undefined}>{money(s.total)}</strong>
          </button>
        ))}
        {!sales.length && <p className="muted">No sales yet.</p>}
      </div>
      {viewing && (
        <Sheet title="Sale" onClose={() => setViewing(null)}>
          <div className="stack">
            <p className="muted">{new Date(viewing.at).toLocaleString('en-GB')} · {viewing.method}</p>
            <div className="card stack">
              {viewing.lines.map((l, i) => <div key={i} className="row spread"><span>{l.qty}× {l.name}</span><span>{money(l.qty * l.price)}</span></div>)}
              <div className="row spread"><strong>Total</strong><strong>{money(viewing.total)}</strong></div>
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
