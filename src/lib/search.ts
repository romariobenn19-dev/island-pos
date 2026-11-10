// Forgiving product search: handles everyday names, Bajan/Caribbean slang and typos.
// The voice assistant will use the same matcher.

/** Whole-phrase replacements applied to both the query and product names. */
const PHRASES: [RegExp, string][] = [
  [/\bsof(t)? ?drink(s)?\b/g, 'soft drink'],
  [/\bsweet ?drink(s)?\b/g, 'soft drink'],
  [/\bcorn(ed)? ?beef\b/g, 'corned beef'],
  [/\bbully ?beef\b/g, 'corned beef'],
  [/\bsalt ?fish\b/g, 'saltfish'],
  [/\btin ?fish\b/g, 'sardines'],
  [/\btop ?up\b/g, 'topup'],
  [/\bphone ?card\b/g, 'topup'],
  [/\bfish ?cake(s)?\b/g, 'fishcakes'],
]

/** Single-word fixes: plurals, dialect spellings, common shorthand. */
const WORDS: Record<string, string> = {
  di: '', de: '', da: '', a: '', an: '', the: '', some: '', one: '', two: '', me: '', mi: '', gimme: '', give: '',
  biscuits: 'biscuit', crackers: 'cracker', eggs: 'egg', sweets: 'sweeties', sweetie: 'sweeties', candy: 'sweeties',
  cigarettes: 'cigarette', cigs: 'cigarette', smokes: 'cigarette', ciggy: 'cigarette',
  beers: 'beer', sardine: 'sardines', chips: 'chips', yoghurt: 'yogurt', loaf: 'bread',
  aluminum: 'aluminium', bun: 'bread', buns: 'bread',
}

export function normalize(text: string): string {
  let t = ` ${text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9.\s]/g, ' ')} `
  for (const [re, rep] of PHRASES) t = t.replace(re, rep)
  return t
    .split(/\s+/)
    .map((w) => (w in WORDS ? WORDS[w] : w))
    .filter(Boolean)
    .join(' ')
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Consonant skeleton: "sardeens" and "sardines" both become "srdns". */
function skeleton(w: string): string {
  return w.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1')
}

export interface Searchable {
  name: string
  category?: string
  aliases?: string[]
  barcode?: string
}

/** 0 = no match. Higher is better. */
export function score(item: Searchable, query: string): number {
  const q = normalize(query)
  if (!q) return 0
  if (item.barcode && query.trim() === item.barcode) return 1000
  const name = normalize(item.name)
  const extra = [...(item.aliases ?? []), item.category ?? ''].map(normalize)
  const words = (name + ' ' + extra.join(' ')).split(' ').filter(Boolean)
  if (name === q) return 500
  if (name.startsWith(q + ' ')) return 450
  if (extra.includes(q)) return 400
  let total = 0
  for (const t of q.split(' ')) {
    if (name.split(' ').some((w) => w.startsWith(t))) total += 30
    else if (words.some((w) => w.startsWith(t))) total += 20
    else if (t.length >= 4 && words.some((w) => editDistanceAtMost1(w, t))) total += 12
    else if (t.length >= 5 && words.some((w) => w.length >= 5 && skeleton(w) === skeleton(t))) total += 10
    else if (name.includes(t)) total += 10
    else return 0 // every word must match something
  }
  if (name.startsWith(q)) total += 25
  return total
}

export function search<T extends Searchable>(items: T[], query: string, limit = 30): T[] {
  return items
    .map((it) => ({ it, s: score(it, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name))
    .slice(0, limit)
    .map((x) => x.it)
}
