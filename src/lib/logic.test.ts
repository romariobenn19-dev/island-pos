import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { DEFAULT_SETTINGS, PosDB, type Product } from './db'
import { averageCost, cartTotals, changeDue, fmt, roundCash, suggestPrice, toCents, unitCost, unitProfit } from './money'
import { completeSale, creditCheck, receiveStock, recordPayment, voidSale, whatsappReminder } from './ops'
import { normalize, search } from './search'

const S = DEFAULT_SETTINGS

describe('money', () => {
  it('formats and parses', () => {
    expect(toCents('12.50')).toBe(1250)
    expect(toCents('$1,234.5')).toBe(123450)
    expect(fmt(123456)).toBe('$1,234.56')
    expect(fmt(-50)).toBe('-$0.50')
  })

  it('rounds cash to 5 cents (Barbados)', () => {
    expect(roundCash(1232, 5)).toBe(1230)
    expect(roundCash(1233, 5)).toBe(1235)
    expect(roundCash(1233, 1)).toBe(1233)
  })

  it('splits VAT out of VAT-inclusive prices, skipping zero-rated items', () => {
    const t = cartTotals([{ price: 1175, qty: 2 }, { price: 500, qty: 1, zeroRated: true }], S)
    expect(t.total).toBe(2850)
    expect(t.vat).toBe(350) // 2 x $11.75 incl 17.5% -> $3.50 VAT; rice is VAT-free
    expect(t.subtotal).toBe(2500)
  })

  it('adds VAT when prices exclude it', () => {
    const t = cartTotals([{ price: 1000, qty: 1 }], { ...S, pricesIncludeVat: false })
    expect(t).toEqual({ subtotal: 1000, vat: 175, total: 1175 })
  })

  it('works out unit cost from a case and suggests a price', () => {
    expect(unitCost(6000, 24)).toBe(250) // $60 case of 24 -> $2.50 each
    // $2.50 + 30% = $3.25, + 17.5% VAT = $3.82 -> rounded up to $3.85
    expect(suggestPrice(250, S)).toBe(385)
    expect(suggestPrice(250, S, true)).toBe(325) // VAT-free item
  })

  it('profit excludes VAT', () => {
    expect(unitProfit(385, 250, S)).toBe(78) // 3.85/1.175 = 3.28 - 2.50
  })

  it('averages cost when new stock comes in at a different price', () => {
    expect(averageCost(10, 200, 10, 300)).toBe(250)
    expect(averageCost(-3, 200, 10, 300)).toBe(300) // negative stock is ignored
  })

  it('gives change in BBD when paid in USD at 2:1', () => {
    expect(changeDue(1730, 0, 1000, S)).toBe(270) // $17.30 bill, US$10 = $20.00 -> $2.70 change
    expect(changeDue(1732, 2000, 0, S)).toBe(270) // bill rounds to $17.30
  })
})

describe('search understands everyday names and typos', () => {
  const items = CATALOG.map((c) => ({ ...c }))
  const top = (q: string) => search(items, q)[0]?.name

  it.each([
    ['sweet drink', 'Soft Drink'],
    ['corn beef', 'Corned Beef'],
    ['bully beef', 'Corned Beef'],
    ['salt fish', 'Saltfish'],
    ['a banks', 'Banks Beer'],
    ['mount gay', 'Mount Gay'],
    ['cou cou flour', 'Cornmeal'],
    ['sardeens', 'Sardines'],
    ['digicel', 'Digicel Top Up'],
    ['fish cakes', 'Fish Cakes'],
    ['gimme two cutter', 'Cutter'],
  ])('%s -> %s', (q, expected) => {
    expect(top(q)?.startsWith(expected)).toBe(true)
  })

  it('normalizes dialect filler words', () => {
    expect(normalize('Gimme di sof drink')).toBe('soft drink')
  })

  it('returns nothing for nonsense', () => {
    expect(search(items, 'zzzz qqq')).toEqual([])
  })
})

describe('sales, stock and credit', () => {
  let d: PosDB
  let rice: Product
  let beer: Product

  beforeEach(async () => {
    d = new PosDB('test-' + Math.random())
    await d.settings.put({ ...S, shopName: 'Test Shop', onboarded: true })
    const base = { aliases: [], reorderAt: 2, packName: 'case', unit: 'each', active: true, createdAt: 0 }
    rice = { ...base, name: 'Rice 2kg', category: 'Groceries', price: 900, cost: 600, stock: 10, packSize: 10, zeroRated: true }
    beer = { ...base, name: 'Banks Beer', category: 'Beer', price: 400, cost: 250, stock: 24, packSize: 24, zeroRated: false }
    rice.id = await d.products.add(rice)
    beer.id = await d.products.add(beer)
  })

  it('cash sale: rounds, gives change, takes stock off, records profit', async () => {
    const sale = await completeSale([{ product: beer, qty: 3, price: 400 }, { product: rice, qty: 1, price: 900 }],
      { method: 'cash', cashPaid: 2500 }, {}, d)
    expect(sale.total).toBe(2100)
    expect(sale.change).toBe(400)
    expect((await d.products.get(beer.id!))!.stock).toBe(21)
    expect((await d.products.get(rice.id!))!.stock).toBe(9)
    // beer profit: 4.00/1.175 = 3.40 - 2.50 = 0.90 x3 = 2.70 ; rice (VAT-free): 9.00-6.00 = 3.00
    expect(sale.profit).toBe(570)
  })

  it('items with no cost price do not count as profit', async () => {
    const free = { ...beer, id: beer.id, cost: 0 }
    const sale = await completeSale([{ product: free, qty: 2, price: 400 }], { method: 'card' }, {}, d)
    expect(sale.profit).toBe(0)
  })

  it('refuses a cash sale when not enough money is handed over', async () => {
    await expect(completeSale([{ product: beer, qty: 1, price: 400 }], { method: 'cash', cashPaid: 300 }, {}, d))
      .rejects.toThrow('Not enough')
    expect((await d.products.get(beer.id!))!.stock).toBe(24)
  })

  it('credit sale adds to the customer balance, respects the limit, and payment reduces it', async () => {
    const id = (await d.customers.add({ name: 'Miss Pat', nickname: 'Pat', phone: '2345678', creditLimit: 1000, balance: 0, note: '', createdAt: 0 }))!
    await completeSale([{ product: beer, qty: 2, price: 400 }], { method: 'credit', customerId: id }, {}, d)
    let c = (await d.customers.get(id))!
    expect(c.balance).toBe(800)
    expect(creditCheck(c, 400)).toEqual({ ok: false, newBalance: 1200, over: 200 })
    await expect(completeSale([{ product: beer, qty: 1, price: 400 }], { method: 'credit', customerId: id }, {}, d))
      .rejects.toThrow('over their limit')
    await completeSale([{ product: beer, qty: 1, price: 400 }], { method: 'credit', customerId: id }, { allowOverLimit: true }, d)
    c = await recordPayment(id, 500, 'cash', d)
    expect(c.balance).toBe(700)
    expect(await d.credit.where('customerId').equals(id).count()).toBe(3)
  })

  it('voiding a credit sale puts stock back and removes the charge', async () => {
    const id = (await d.customers.add({ name: 'Junior', nickname: '', phone: '', creditLimit: 0, balance: 0, note: '', createdAt: 0 }))!
    const sale = await completeSale([{ product: beer, qty: 2, price: 400 }], { method: 'credit', customerId: id }, {}, d)
    await voidSale(sale.id!, d)
    expect((await d.customers.get(id))!.balance).toBe(0)
    expect((await d.products.get(beer.id!))!.stock).toBe(24)
    expect((await d.sales.get(sale.id!))!.voided).toBe(true)
  })

  it('receiving cases updates stock and average cost', async () => {
    const p = await receiveStock(beer.id!, { packs: 1, packCost: 7200 }, d) // $72 a case -> $3.00 each
    expect(p.stock).toBe(48)
    expect(p.cost).toBe(275) // average of 24 @ 2.50 and 24 @ 3.00
  })

  it('builds a WhatsApp reminder with the Barbados country code', () => {
    const url = whatsappReminder({ name: 'Miss Pat', nickname: 'Pat', phone: '234-5678', creditLimit: 0, balance: 800, note: '', createdAt: 0 },
      'Test Shop', '1246', '$8.00')
    expect(url.startsWith('https://wa.me/12462345678?text=')).toBe(true)
    expect(decodeURIComponent(url)).toContain('Good day Pat')
  })
})

describe('stock warnings', () => {
  it('only warns once stock has been recorded', async () => {
    const { isLow, stockTracked } = await import('./db')
    const base = { name: 'X', category: 'Groceries', aliases: [], price: 100, packSize: 1, packName: 'case', unit: 'each', zeroRated: false, active: true, createdAt: 0, reorderAt: 3 }
    expect(stockTracked({ ...base, cost: 0, stock: 0 })).toBe(false)   // never counted
    expect(isLow({ ...base, cost: 0, stock: 0 })).toBe(false)
    expect(isLow({ ...base, cost: 250, stock: 2 })).toBe(true)          // counted and low
    expect(isLow({ ...base, cost: 0, stock: -1 })).toBe(true)           // sold more than counted
    expect(isLow({ ...base, cost: 250, stock: 10 })).toBe(false)
  })
})
