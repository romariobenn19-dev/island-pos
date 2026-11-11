import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HandCoins, MessageCircle, NotebookPen, Pencil, Phone, Search, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { db, type Customer } from '../lib/db'
import { recordPayment, whatsappReminder } from '../lib/ops'
import { search } from '../lib/search'
import { ConfirmButton, initials, money, MoneyInput, Sheet, timeAgo, useSettings, useToast } from '../ui'

export function Credit() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const owed = customers.reduce((s, c) => s + Math.max(c.balance, 0), 0)
  const owing = customers.filter((c) => c.balance > 0)
  const over = customers.filter((c) => c.creditLimit > 0 && c.balance > c.creditLimit)
  const list = q
    ? search(customers.map((c) => ({ ...c, aliases: [c.nickname, c.phone] })), q, 50)
    : [...customers].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))

  return (
    <main className="page">
      <div className="section-head">
        <h1>Credit book</h1>
        <button className="btn primary" onClick={() => setAdding(true)}><UserPlus size={18} />New customer</button>
      </div>
      <div className="kpis">
        <div className="kpi" style={{ gridColumn: 'span 2' }}>
          <div className="top"><span className="label">People owe you</span><HandCoins size={18} className="warn" /></div>
          <div className="value warn" style={{ fontSize: '2rem' }}>{money(owed)}</div>
        </div>
        <div className="kpi"><div className="top"><span className="label">Owing</span><Users size={18} className="muted" /></div><div className="value">{owing.length}</div></div>
        <div className="kpi"><div className="top"><span className="label">Over limit</span><TriangleAlert size={18} className="bad" /></div><div className={'value' + (over.length ? ' bad' : '')}>{over.length}</div></div>
      </div>
      <label className="search"><Search size={20} /><input className="input" placeholder="Find a customer by name, nickname or phone" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="item" onClick={() => setOpen(c.id!)}>
            <span className="avatar">{initials(c.name)}</span>
            <div className="grow">
              <div className="ellipsis" style={{ fontWeight: 650 }}>{c.name}{c.nickname ? <span className="muted"> · {c.nickname}</span> : ''}</div>
              <div className="meta">{c.lastPaidAt ? `Last paid ${timeAgo(c.lastPaidAt)}` : 'No payments yet'}</div>
            </div>
            <div className="right stack tight" style={{ alignItems: 'flex-end' }}>
              <span className={'money ' + (c.balance > 0 ? 'warn' : 'muted')} style={{ fontWeight: 800, fontSize: '1.05rem' }}>{money(c.balance)}</span>
              {c.creditLimit > 0 && c.balance > c.creditLimit && <span className="pill bad">Over limit</span>}
            </div>
          </button>
        ))}
        {!list.length && <div className="empty"><NotebookPen size={28} />No customers yet. Add one here, or choose "Credit" when taking payment.</div>}
      </div>
      {open != null && <CustomerSheet id={open} onClose={() => setOpen(null)} />}
      {adding && <CustomerEditor onClose={() => setAdding(false)} />}
    </main>
  )
}

function CustomerSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const s = useSettings()
  const toast = useToast()
  const c = useLiveQuery(() => db.customers.get(id), [id])
  const history = useLiveQuery(() => db.credit.where('customerId').equals(id).reverse().sortBy('at'), [id]) ?? []
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState(0)
  const [editing, setEditing] = useState(false)
  if (!c) return null
  if (editing) return <CustomerEditor customer={c} onClose={() => setEditing(false)} />

  const pay = async () => {
    try {
      await recordPayment(id, amount)
      toast(`${c.name} paid ${money(amount)}`)
      setPaying(false); setAmount(0)
    } catch (e) { toast((e as Error).message) }
  }
  const used = c.creditLimit > 0 ? Math.min(100, Math.round((c.balance / c.creditLimit) * 100)) : null

  return (
    <Sheet title={c.name} onClose={onClose}>
      <div className="stack">
        <div className="card flat stack">
          <div className="row">
            <span className="avatar" style={{ width: 52, height: 52, fontSize: '1.1rem' }}>{initials(c.name)}</span>
            <div className="grow">
              <span className="label">Owes</span>
              <div className={'huge ' + (c.balance > 0 ? 'warn' : 'good')} style={{ fontSize: '2.2rem' }}>{money(c.balance)}</div>
            </div>
          </div>
          {used != null && (
            <div className="stack tight">
              <div className="row spread tiny muted"><span>Credit limit {money(c.creditLimit)}</span><span>{used}% used</span></div>
              <div className="meter"><div style={{ width: `${used}%`, background: used >= 100 ? 'var(--bad)' : used >= 80 ? 'var(--warn)' : undefined }} /></div>
            </div>
          )}
        </div>
        {paying ? (
          <form className="card flat stack" onSubmit={(e) => { e.preventDefault(); pay() }}>
            <MoneyInput label="Amount paid" value={amount} onChange={setAmount} autoFocus large />
            <div className="row wrap">
              {c.balance > 0 && <button type="button" className="btn soft" onClick={() => setAmount(c.balance)}>All ({money(c.balance)})</button>}
              {[2000, 5000, 10000].filter((v) => v < c.balance).map((v) => <button type="button" key={v} className="btn" onClick={() => setAmount(v)}>{money(v)}</button>)}
            </div>
            <button className="btn pay lg block" disabled={amount <= 0}>Save payment</button>
          </form>
        ) : (
          <button className="btn pay lg block" onClick={() => setPaying(true)}><HandCoins size={20} />Took a payment</button>
        )}
        <div className="row">
          {c.phone && c.balance > 0 && (
            <a className="btn soft grow" target="_blank" rel="noreferrer" href={whatsappReminder(c, s.shopName, s.countryCode, money(c.balance))}><MessageCircle size={18} />Remind</a>
          )}
          {c.phone && <a className="btn grow" href={`tel:${c.phone}`}><Phone size={18} />Call</a>}
          <button className="btn grow" onClick={() => setEditing(true)}><Pencil size={18} />Edit</button>
        </div>
        <h3>History</h3>
        <div className="list">
          {history.map((h) => (
            <div key={h.id} className="item">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{h.type === 'payment' ? 'Paid' : h.type === 'charge' ? 'Took on credit' : 'Adjustment'}</div>
                <div className="meta ellipsis">{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{h.note ? ` · ${h.note}` : ''}</div>
              </div>
              <strong className={'money ' + (h.type === 'payment' ? 'good' : h.type === 'charge' ? 'warn' : 'muted')}>
                {h.type === 'payment' ? '−' : '+'}{money(Math.abs(h.amount))}
              </strong>
            </div>
          ))}
          {!history.length && <div className="empty">Nothing yet.</div>}
        </div>
      </div>
    </Sheet>
  )
}

function CustomerEditor({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const toast = useToast()
  const [c, setC] = useState<Customer>(customer ?? { name: '', nickname: '', phone: '', creditLimit: 0, balance: 0, note: '', createdAt: Date.now() })
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setC((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!c.name.trim()) return
    await db.customers.put({ ...c, name: c.name.trim() })
    onClose()
  }
  const remove = async () => {
    if (!c.id) return
    if (c.balance !== 0) { toast(`${c.name} still owes ${money(c.balance)}. Clear it first.`); return }
    await db.customers.delete(c.id)
    onClose()
  }
  return (
    <Sheet title={customer ? 'Edit customer' : 'New customer'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="field">Name<input className="input" autoFocus value={c.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field">Nickname <span className="hint">What you call them, e.g. "Junior", "Miss P"</span>
          <input className="input" value={c.nickname} onChange={(e) => set('nickname', e.target.value)} /></label>
        <label className="field">Phone <span className="hint">For WhatsApp reminders</span>
          <input className="input" inputMode="tel" value={c.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <MoneyInput label="Credit limit" hint="Leave empty for no limit" value={c.creditLimit} onChange={(v) => set('creditLimit', v)} />
        <label className="field">Note<input className="input" value={c.note} onChange={(e) => set('note', e.target.value)} /></label>
        <button className="btn primary lg block">Save customer</button>
        {customer && <ConfirmButton label="Delete customer" confirmLabel={`Tap again to delete ${c.name}`} onConfirm={remove} />}
      </form>
    </Sheet>
  )
}
