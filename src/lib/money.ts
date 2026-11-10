// All money is stored as integer cents to avoid rounding errors.

export type Cents = number

export interface MoneySettings {
  currency: string // e.g. "BBD"
  vatRate: number // 0.175 = 17.5%
  pricesIncludeVat: boolean // shelf prices already include VAT
  cashRounding: number // round cash totals to this many cents (5 in Barbados, 1 = off)
  usdRate: number // local dollars per 1 USD (Barbados: 2)
  defaultMarkup: number // 0.3 = 30% on top of cost
}

export function toCents(dollars: number | string): Cents {
  const n = typeof dollars === 'string' ? parseFloat(dollars.replace(/[^0-9.-]/g, '')) : dollars
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export function fmt(c: Cents, symbol = '$'): string {
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(Math.round(c))
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}${symbol}${dollars}.${String(abs % 100).padStart(2, '0')}`
}

/** Round a cash amount to the nearest coin (e.g. 5 cents). */
export function roundCash(c: Cents, step: number): Cents {
  if (step <= 1) return Math.round(c)
  return Math.round(c / step) * step
}

/** Round up to the next coin, used for suggested selling prices. */
export function roundUpTo(c: Cents, step: number): Cents {
  if (step <= 1) return Math.ceil(c)
  return Math.ceil(c / step) * step
}

export interface LineForTax {
  price: Cents // unit selling price as entered (incl. VAT if pricesIncludeVat)
  qty: number
  zeroRated?: boolean // VAT-free item
}

export interface Totals {
  subtotal: Cents // before VAT
  vat: Cents
  total: Cents // what the customer pays before cash rounding
}

export function cartTotals(lines: LineForTax[], s: Pick<MoneySettings, 'vatRate' | 'pricesIncludeVat'>): Totals {
  let gross = 0
  let vat = 0
  for (const l of lines) {
    const amount = l.price * l.qty
    const rate = l.zeroRated ? 0 : s.vatRate
    if (s.pricesIncludeVat) {
      gross += amount
      vat += amount - amount / (1 + rate)
    } else {
      gross += amount * (1 + rate)
      vat += amount * rate
    }
  }
  const total = Math.round(gross)
  const v = Math.round(vat)
  return { subtotal: total - v, vat: v, total }
}

/** Cost of one unit when buying a pack (e.g. a case of 24 for $60 -> $2.50 each). */
export function unitCost(packCost: Cents, unitsPerPack: number): Cents {
  if (!(unitsPerPack > 0)) return packCost
  return Math.round(packCost / unitsPerPack)
}

/** Selling price suggestion: cost + markup (+ VAT when shelf prices include it), rounded up to a coin. */
export function suggestPrice(cost: Cents, s: MoneySettings, zeroRated = false, markup = s.defaultMarkup): Cents {
  let p = cost * (1 + markup)
  if (s.pricesIncludeVat && !zeroRated) p *= 1 + s.vatRate
  return roundUpTo(p, Math.max(s.cashRounding, 5))
}

/** Profit on one unit sold at `price`, after taking out VAT. */
export function unitProfit(price: Cents, cost: Cents, s: Pick<MoneySettings, 'vatRate' | 'pricesIncludeVat'>, zeroRated = false): Cents {
  const rate = zeroRated ? 0 : s.vatRate
  const net = s.pricesIncludeVat ? price / (1 + rate) : price
  return Math.round(net - cost)
}

/** New average cost after receiving more stock. */
export function averageCost(oldQty: number, oldCost: Cents, addQty: number, addCost: Cents): Cents {
  const base = Math.max(oldQty, 0)
  if (base + addQty <= 0) return addCost
  return Math.round((base * oldCost + addQty * addCost) / (base + addQty))
}

/** Change owed in local currency when the customer pays in USD and/or local cash. */
export function changeDue(total: Cents, localPaid: Cents, usdPaid: Cents, s: Pick<MoneySettings, 'usdRate' | 'cashRounding'>): Cents {
  const paid = localPaid + Math.round(usdPaid * s.usdRate)
  return roundCash(paid - roundCash(total, s.cashRounding), s.cashRounding)
}
