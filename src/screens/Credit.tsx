import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../lib/db'
import { recordPayment, whatsappReminder } from '../lib/ops'
import { search } from '../lib/search'
import { ConfirmButton, money, MoneyInput, Sheet, timeAgo, useSettings, useToast } from '../ui'

export function Credit() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const owed = customers.reduce((s, c) => s + Math.max(c.balance, 0), 0)
  const owing = customers.filter((c) => c.balance > 0)
  const list = q
    ? search(customers.map((c) => ({ ...c, aliases: [c.nickname, c.phone] })), q, 50)
    : [...customers].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))

  return (
    <main className="screen stack">
      <div className="stats">
        <div className="stat"><div className="label">People owe you</div><div className="value warn">{money(owed)}</div></div>
        <div className="stat"><div className="label">Customers owing</div><div className="value">{owing.length}</div></div>
      </div>
      <div className="row">
        <input className="input grow" placeholder="Find customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setAdding(true)}>+ New</button>
      </div>
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="item" onClick={() => setOpen(c.id!)}>
            <div className="grow">
              <div className="ellipsis"><strong>{c.name}</strong>{c.nickname ? ` (${c.nickname})` : ''}</div>
              <div className="small muted">{c.lastPaidAt ? `last paid ${timeAgo(c.lastPaidAt)}` : 'no payments yet'}</div>
            </div>
            <div className="right">
              <div className={c.balance > 0 ? 'warn' : 'muted'}><strong>{money(c.balance)}</strong></div>
              {c.creditLimit > 0 && c.balance > c.creditLimit && <span className="pill bad">over limit</span>}
            </div>
          </button>
        ))}
        {!list.length && <div className="item muted">No customers yet. Add one, or pick "Credit" when taking payment.</div>}
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

  return (
    <Sheet title={c.name} onClose={onClose}>
      <div className="stack">
        <div className="card center">
          <div className="muted">Owes</div>
          <div className={'huge ' + (c.balance > 0 ? 'warn' : 'good')}>{money(c.balance)}</div>
          {c.creditLimit > 0 && <div className="small muted">Limit {money(c.creditLimit)}</div>}
        </div>
        {paying ? (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); pay() }}>
            <MoneyInput label="Amount paid" value={amount} onChange={setAmount} autoFocus large />
            <div className="row wrap">
              {c.balance > 0 && <button type="button" className="btn soft" onClick={() => setAmount(c.balance)}>All ({money(c.balance)})</button>}
              {[2000, 5000, 10000].filter((v) => v < c.balance).map((v) => <button type="button" key={v} className="btn" onClick={() => setAmount(v)}>{money(v)}</button>)}
            </div>
            <button className="btn good lg block" disabled={amount <= 0}>Save payment</button>
          </form>
        ) : (
          <button className="btn good lg block" onClick={() => setPaying(true)}>Took a payment</button>
        )}
        <div className="row">
          {c.phone && c.balance > 0 && (
            <a className="btn soft grow" target="_blank" rel="noreferrer" href={whatsappReminder(c, s.shopName, s.countryCode, money(c.balance))}>WhatsApp reminder</a>
          )}
          {c.phone && <a className="btn grow" href={`tel:${c.phone}`}>Call</a>}
          <button className="btn grow" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <h3>History</h3>
        <div className="list">
          {history.map((h) => (
            <div key={h.id} className="item">
              <div className="grow">
                <div>{h.type === 'payment' ? 'Paid' : h.type === 'charge' ? 'Took on credit' : 'Adjustment'}</div>
                <div className="small muted ellipsis">{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{h.note ? ` · ${h.note}` : ''}</div>
              </div>
              <strong className={h.type === 'payment' ? 'good' : h.type === 'charge' ? 'warn' : 'muted'}>
                {h.type === 'payment' ? '−' : '+'}{money(Math.abs(h.amount))}
              </strong>
            </div>
          ))}
          {!history.length && <div className="item muted">Nothing yet.</div>}
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
        <button className="btn primary lg block">Save</button>
        {customer && <ConfirmButton label="Delete customer" confirmLabel={`Tap again to delete ${c.name}`} onConfirm={remove} />}
      </form>
    </Sheet>
  )
}
