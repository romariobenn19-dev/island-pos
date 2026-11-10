import { useRef, useState } from 'react'
import { db, saveSettings } from '../lib/db'
import { MoneyInput, NumberInput, Sheet, useSettings, useToast } from '../ui'

const TABLES = ['settings', 'products', 'customers', 'sales', 'credit', 'moves'] as const

export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  return new Blob([JSON.stringify({ app: 'island-pos', version: 1, at: Date.now(), data })], { type: 'application/json' })
}

export async function importBackup(text: string): Promise<void> {
  const parsed = JSON.parse(text)
  if (parsed?.app !== 'island-pos' || !parsed.data) throw new Error('This is not a backup file from this app.')
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(parsed.data[t] ?? [])
    }
  })
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)

  const backup = async () => {
    const url = URL.createObjectURL(await exportBackup())
    const a = document.createElement('a')
    a.href = url
    a.download = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    await saveSettings({ lastBackupAt: Date.now() })
    toast('Backup saved to your Downloads')
  }

  const [pending, setPending] = useState<File | null>(null)
  const restore = async (f: File) => {
    setPending(null)
    try {
      await importBackup(await f.text())
      toast('Backup restored')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="stack">
        <div className="card stack">
          <h3>Shop</h3>
          <label className="field">Shop name<input className="input" value={s.shopName} onChange={(e) => saveSettings({ shopName: e.target.value })} /></label>
          <label className="field">Shop phone<input className="input" inputMode="tel" value={s.phone} onChange={(e) => saveSettings({ phone: e.target.value })} /></label>
        </div>
        <div className="card stack">
          <h3>Money</h3>
          <NumberInput label="VAT %" step={0.5} value={Math.round(s.vatRate * 1000) / 10} onChange={(v) => saveSettings({ vatRate: v / 100 })} />
          <label className="check"><input type="checkbox" checked={s.pricesIncludeVat} onChange={(e) => saveSettings({ pricesIncludeVat: e.target.checked })} /> My prices already include VAT</label>
          <MoneyInput label="Value of US$1 in local money" value={Math.round(s.usdRate * 100)} onChange={(c) => saveSettings({ usdRate: c / 100 })} />
          <NumberInput label="Usual markup %" hint="Used for suggested prices" value={Math.round(s.defaultMarkup * 100)} onChange={(v) => saveSettings({ defaultMarkup: v / 100 })} />
          <label className="check"><input type="checkbox" checked={s.cashRounding === 5} onChange={(e) => saveSettings({ cashRounding: e.target.checked ? 5 : 1 })} /> Round cash to 5¢ (no 1¢ coins)</label>
        </div>
        <div className="card stack">
          <h3>Backup</h3>
          <p className="small muted">Everything is saved on this device only. Make a backup each week and keep a copy (e.g. send it to yourself on WhatsApp or email) in case the phone is lost.</p>
          <button className="btn primary block" onClick={backup}>Save a backup</button>
          <button className="btn block" onClick={() => file.current?.click()}>Restore from backup</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { setPending(e.target.files?.[0] ?? null); e.target.value = '' }} />
          {pending && (
            <div className="banner warn stack">
              <span>Replace everything on this device with "{pending.name}"?</span>
              <div className="row">
                <button className="btn danger grow" onClick={() => restore(pending)}>Yes, replace</button>
                <button className="btn grow" onClick={() => setPending(null)}>No</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
