import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './lib/db'
import { Credit } from './screens/Credit'
import { Items } from './screens/Items'
import { Reports } from './screens/Reports'
import { Sell } from './screens/Sell'
import { SettingsSheet } from './screens/Settings'
import { Setup } from './screens/Setup'
import { ToastProvider } from './ui'

type Tab = 'sell' | 'items' | 'credit' | 'reports'
const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'sell', label: 'Sell', ico: '🛒' },
  { id: 'items', label: 'Items', ico: '📦' },
  { id: 'credit', label: 'Credit', ico: '📒' },
  { id: 'reports', label: 'Reports', ico: '📊' },
]
const WEEK = 7 * 86400000

function Shell() {
  const settings = useLiveQuery(() => db.settings.get('shop').then((s) => s ?? null), [])
  const salesCount = useLiveQuery(() => db.sales.count(), []) ?? 0
  const [tab, setTab] = useState<Tab>('sell')
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (settings === undefined) return null // still loading
  if (!settings?.onboarded) return <Setup />
  const needsBackup = salesCount > 20 && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > WEEK)

  return (
    <div className="app">
      <header className="topbar">
        <h1>{settings.shopName}</h1>
        <button className="iconbtn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙️</button>
      </header>
      {needsBackup && (
        <button className="banner warn" style={{ border: 0, borderRadius: 0, textAlign: 'left' }} onClick={() => setSettingsOpen(true)}>
          No backup this week. Tap to save one.
        </button>
      )}
      {tab === 'sell' && <Sell />}
      {tab === 'items' && <Items />}
      {tab === 'credit' && <Credit />}
      {tab === 'reports' && <Reports />}
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={t.id === tab}>
            <span className="ico" aria-hidden>{t.ico}</span>{t.label}
          </button>
        ))}
      </nav>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>
}
