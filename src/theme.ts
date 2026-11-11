import {
  Baby, Beer, Candy, Carrot, Cigarette, Croissant, CupSoda, Cylinder, Fish, Flame, IceCreamCone, Milk,
  Package, PawPrint, PencilLine, Pill, Sandwich, ShoppingBasket, ShowerHead, Smartphone, Snowflake,
  SprayCan, Wine, type LucideIcon,
} from 'lucide-react'

export interface CategoryMeta { Icon: LucideIcon; hue: string }

// One icon and colour per section, so items are recognisable at a glance.
const META: Record<string, CategoryMeta> = {
  'Drinks': { Icon: CupSoda, hue: '#0E86C7' },
  'Beer & Rum': { Icon: Beer, hue: '#C27A0E' },
  'Wine & Spirits': { Icon: Wine, hue: '#9C2F5B' },
  'Bread & Bakery': { Icon: Croissant, hue: '#B5651D' },
  'Groceries': { Icon: ShoppingBasket, hue: '#5B7A1E' },
  'Tin Goods': { Icon: Cylinder, hue: '#7A5AA8' },
  'Dairy & Eggs': { Icon: Milk, hue: '#3C7DD9' },
  'Meat & Fish': { Icon: Fish, hue: '#C24B3A' },
  'Fresh Produce': { Icon: Carrot, hue: '#2E8B3E' },
  'Frozen': { Icon: Snowflake, hue: '#2A9DB0' },
  'Snacks & Sweets': { Icon: Candy, hue: '#D3497F' },
  'Seasoning & Sauces': { Icon: Flame, hue: '#D05A1E' },
  'Household': { Icon: SprayCan, hue: '#4B6B8A' },
  'Personal Care': { Icon: ShowerHead, hue: '#3E8E87' },
  'Pharmacy': { Icon: Pill, hue: '#D04A4A' },
  'Baby': { Icon: Baby, hue: '#C9709A' },
  'Pets': { Icon: PawPrint, hue: '#8A6A3E' },
  'Phone & Bills': { Icon: Smartphone, hue: '#5160C9' },
  'Tobacco': { Icon: Cigarette, hue: '#6E6A62' },
  'School & Stationery': { Icon: PencilLine, hue: '#C9A01E' },
  'Ice': { Icon: IceCreamCone, hue: '#3BA7D4' },
  'Food Made Here': { Icon: Sandwich, hue: '#E0702A' },
  // names used by the first version of the item list
  'Ice & Cooler': { Icon: IceCreamCone, hue: '#3BA7D4' },
  'Food & Snacks Made Here': { Icon: Sandwich, hue: '#E0702A' },
}

export function categoryMeta(category: string): CategoryMeta {
  return META[category] ?? { Icon: Package, hue: '#5F7A76' }
}
