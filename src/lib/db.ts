import Dexie, { type EntityTable } from 'dexie'
import type { Cents, MoneySettings } from './money'

export interface Settings extends MoneySettings {
  id: 'shop'
  shopName: string
  phone: string
  countryCode: string // phone country code for WhatsApp links, Barbados = "1246"
  onboarded: boolean
  lastBackupAt?: number
}

export interface Product {
  id?: number
  name: string
  category: string
  aliases: string[] // other names people use ("sweet drink", "corn beef")
  barcode?: string
  price: Cents // selling price per unit (0 = not set yet)
  cost: Cents // average cost per unit
  stock: number
  reorderAt: number // warn when stock falls to this
  packSize: number // units in a case/pack when buying
  packName: string // "case", "pack", "dozen"
  unit: string // "each", "lb"
  zeroRated: boolean // no VAT on this item
  active: boolean
  createdAt: number
}

export interface Customer {
  id?: number
  name: string
  phone: string
  nickname: string
  creditLimit: Cents // 0 = no limit
  balance: Cents // what they owe you
  note: string
  createdAt: number
  lastPaidAt?: number
}

export type PayMethod = 'cash' | 'usd' | 'card' | 'credit' | 'mixed'

export interface SaleLine {
  productId: number
  name: string
  qty: number
  price: Cents
  cost: Cents
  zeroRated: boolean
}

export interface Sale {
  id?: number
  at: number
  lines: SaleLine[]
  subtotal: Cents
  vat: Cents
  total: Cents // after cash rounding
  profit: Cents
  method: PayMethod
  cashPaid: Cents
  usdPaid: Cents // in US cents
  change: Cents
  customerId?: number
  voided?: boolean
}

export interface CreditEntry {
  id?: number
  customerId: number
  at: number
  type: 'charge' | 'payment' | 'adjust'
  amount: Cents // always positive; type says which way
  saleId?: number
  note: string
}

export interface StockMove {
  id?: number
  productId: number
  at: number
  qty: number // + received, - sold
  reason: 'sale' | 'receive' | 'adjust' | 'void'
  unitCost?: Cents
  note?: string
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'shop',
  shopName: '',
  phone: '',
  countryCode: '1246',
  currency: 'BBD',
  vatRate: 0.175,
  pricesIncludeVat: true,
  cashRounding: 5, // Barbados stopped using 1-cent coins
  usdRate: 2,
  defaultMarkup: 0.3,
  onboarded: false,
}

export class PosDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>
  products!: EntityTable<Product, 'id'>
  customers!: EntityTable<Customer, 'id'>
  sales!: EntityTable<Sale, 'id'>
  credit!: EntityTable<CreditEntry, 'id'>
  moves!: EntityTable<StockMove, 'id'>

  constructor(name = 'island-pos') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      products: '++id, name, category, barcode, active',
      customers: '++id, name, balance',
      sales: '++id, at, customerId',
      credit: '++id, customerId, at',
      moves: '++id, productId, at',
    })
  }
}

export const db = new PosDB()

/** Stock warnings only make sense once an item's stock has been recorded. */
export function stockTracked(p: Product): boolean {
  return p.cost > 0 || p.stock !== 0
}

export function isLow(p: Product): boolean {
  return stockTracked(p) && p.stock <= p.reorderAt
}

export async function getSettings(d: PosDB = db): Promise<Settings> {
  return (await d.settings.get('shop')) ?? DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>, d: PosDB = db): Promise<void> {
  const cur = await getSettings(d)
  await d.settings.put({ ...cur, ...patch, id: 'shop' })
}
