import { db as defaultDb, getSettings, type Customer, type PayMethod, type PosDB, type Product, type Sale, type SaleLine } from './db'
import { averageCost, cartTotals, changeDue, roundCash, unitCost, unitProfit, type Cents } from './money'

export interface CartLine {
  product: Product
  qty: number
  price: Cents // can differ from product.price if changed at the till
}

export interface Payment {
  method: PayMethod
  cashPaid?: Cents // local cash handed over
  usdPaid?: Cents // US cash handed over, in US cents
  customerId?: number // required for credit
}

export class PosError extends Error {}

/** Would this credit sale push the customer over their limit? */
export function creditCheck(c: Customer, amount: Cents): { ok: boolean; newBalance: Cents; over: Cents } {
  const newBalance = c.balance + amount
  if (!c.creditLimit) return { ok: true, newBalance, over: 0 }
  const over = newBalance - c.creditLimit
  return { ok: over <= 0, newBalance, over: Math.max(over, 0) }
}

export async function completeSale(cart: CartLine[], pay: Payment, opts: { allowOverLimit?: boolean } = {}, d: PosDB = defaultDb): Promise<Sale> {
  if (!cart.length) throw new PosError('The cart is empty.')
  const s = await getSettings(d)
  const lines: SaleLine[] = cart.map((l) => ({
    productId: l.product.id!,
    name: l.product.name,
    qty: l.qty,
    price: l.price,
    cost: l.product.cost,
    zeroRated: l.product.zeroRated,
  }))
  const t = cartTotals(lines, s)
  const isCash = pay.method === 'cash' || pay.method === 'usd' || pay.method === 'mixed'
  const total = isCash ? roundCash(t.total, s.cashRounding) : t.total
  // items with no cost price yet don't count towards profit (we can't know it)
  const profit = lines.reduce((sum, l) => sum + (l.cost > 0 ? unitProfit(l.price, l.cost, s, l.zeroRated) * l.qty : 0), 0)
  const cashPaid = pay.cashPaid ?? 0
  const usdPaid = pay.usdPaid ?? 0
  let change = 0
  if (isCash) {
    change = changeDue(total, cashPaid, usdPaid, s)
    if (change < 0) throw new PosError('Not enough money handed over.')
  }

  return d.transaction('rw', [d.sales, d.products, d.moves, d.customers, d.credit], async () => {
    let customer: Customer | undefined
    if (pay.method === 'credit') {
      if (!pay.customerId) throw new PosError('Pick who is taking it on credit.')
      customer = await d.customers.get(pay.customerId)
      if (!customer) throw new PosError('Customer not found.')
      const chk = creditCheck(customer, total)
      if (!chk.ok && !opts.allowOverLimit) throw new PosError(`This puts ${customer.name} over their limit.`)
    }
    const now = Date.now()
    const sale: Sale = {
      at: now, lines, subtotal: t.subtotal, vat: t.vat, total, profit,
      method: pay.method, cashPaid, usdPaid, change, customerId: pay.customerId,
    }
    sale.id = await d.sales.add(sale)
    for (const l of lines) {
      const p = await d.products.get(l.productId)
      if (p) await d.products.update(l.productId, { stock: p.stock - l.qty })
      await d.moves.add({ productId: l.productId, at: now, qty: -l.qty, reason: 'sale' })
    }
    if (customer) {
      await d.customers.update(customer.id!, { balance: customer.balance + total })
      await d.credit.add({ customerId: customer.id!, at: now, type: 'charge', amount: total, saleId: sale.id, note: summarize(lines) })
    }
    return sale
  })
}

export async function voidSale(saleId: number, d: PosDB = defaultDb): Promise<void> {
  await d.transaction('rw', [d.sales, d.products, d.moves, d.customers, d.credit], async () => {
    const sale = await d.sales.get(saleId)
    if (!sale || sale.voided) return
    const now = Date.now()
    for (const l of sale.lines) {
      const p = await d.products.get(l.productId)
      if (p) await d.products.update(l.productId, { stock: p.stock + l.qty })
      await d.moves.add({ productId: l.productId, at: now, qty: l.qty, reason: 'void' })
    }
    if (sale.method === 'credit' && sale.customerId) {
      const c = await d.customers.get(sale.customerId)
      if (c) await d.customers.update(c.id!, { balance: c.balance - sale.total })
      await d.credit.add({ customerId: sale.customerId, at: now, type: 'adjust', amount: -sale.total, saleId, note: 'Sale cancelled' })
    }
    await d.sales.update(saleId, { voided: true })
  })
}

export interface Receipt {
  packs?: number // number of cases/packs
  units?: number // loose units
  packCost?: Cents // cost of one case/pack
  unitCostEach?: Cents // or cost of one unit
  note?: string
}

/** Add stock. Cost can be given per case or per unit; the average cost is updated. */
export async function receiveStock(productId: number, r: Receipt, d: PosDB = defaultDb): Promise<Product> {
  return d.transaction('rw', [d.products, d.moves], async () => {
    const p = await d.products.get(productId)
    if (!p) throw new PosError('Item not found.')
    const qty = (r.packs ?? 0) * p.packSize + (r.units ?? 0)
    if (qty <= 0) throw new PosError('Enter how many came in.')
    const each = r.unitCostEach ?? (r.packCost != null ? unitCost(r.packCost, p.packSize) : p.cost)
    const cost = averageCost(p.stock, p.cost, qty, each)
    await d.products.update(productId, { stock: p.stock + qty, cost })
    await d.moves.add({ productId, at: Date.now(), qty, reason: 'receive', unitCost: each, note: r.note })
    return { ...p, stock: p.stock + qty, cost }
  })
}

export async function adjustStock(productId: number, newCount: number, note = 'Stock count', d: PosDB = defaultDb): Promise<void> {
  await d.transaction('rw', [d.products, d.moves], async () => {
    const p = await d.products.get(productId)
    if (!p) return
    await d.products.update(productId, { stock: newCount })
    await d.moves.add({ productId, at: Date.now(), qty: newCount - p.stock, reason: 'adjust', note })
  })
}

export async function recordPayment(customerId: number, amount: Cents, note = '', d: PosDB = defaultDb): Promise<Customer> {
  if (!(amount > 0)) throw new PosError('Enter how much they paid.')
  return d.transaction('rw', [d.customers, d.credit], async () => {
    const c = await d.customers.get(customerId)
    if (!c) throw new PosError('Customer not found.')
    const now = Date.now()
    const balance = c.balance - amount
    await d.customers.update(customerId, { balance, lastPaidAt: now })
    await d.credit.add({ customerId, at: now, type: 'payment', amount, note })
    return { ...c, balance, lastPaidAt: now }
  })
}

export function summarize(lines: SaleLine[]): string {
  return lines.map((l) => `${l.qty}× ${l.name}`).join(', ')
}

/** Ready-made WhatsApp link with a friendly reminder. */
export function whatsappReminder(c: Customer, shopName: string, countryCode: string, balanceText: string): string {
  const digits = c.phone.replace(/\D/g, '')
  const number = digits.length === 7 ? countryCode + digits : digits
  const msg = `Good day ${c.nickname || c.name}, this is ${shopName || 'the shop'}. Just a friendly reminder your balance is ${balanceText}. Thank you!`
  return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`
}
