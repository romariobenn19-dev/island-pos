import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChartColumn, NotebookPen, Package, Settings as Gear, ShoppingCart, Store, TriangleAlert } from 'lucide-react'
import { db } from './lib/db'
import { Credit } from './screens/Credit'
import { Items } from './screens/Items'
import { Reports } from './screens/Reports'
import { Sell } from './screens/Sell'
import { SettingsSheet } from './screens/Settings'
import { Setup } from './screens/Setup'
import { ToastProvider, useOnline } from './ui'

type Tab = 'sell' | 'items' | 'credit' | 'reports'
const TABS = [
  { id: 'sell', label: 'Sell', Icon: ShoppingCart },
  { id: 'items', label: 'Items', Icon: Package },
  { id: 'credit', label: 'Credit', Icon: NotebookPen },
  { id: 'reports', label: 'Reports', Icon: ChartColumn },
] as const
const WEEK = 7 * 86400000

function Shell() {
  const settings = useLiveQuery(() => db.settings.get('shop').then((s) => s ?? null), [])
  const salesCount = useLiveQuery(() => db.sales.count(), []) ?? 0
  const online = useOnline()
  const [tab, setTab] = useState<Tab>('sell')
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (settings === undefined) return null // still loading
  if (!settings?.onboarded) return <Setup />
  const needsBackup = salesCount > 20 && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > WEEK)
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brandmark"><Store size={22} /></div>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={id === tab ? 'on' : ''} onClick={() => setTab(id)} aria-current={id === tab}>
            <Icon size={22} />{label}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={() => setSettingsOpen(true)}><Gear size={22} />Settings</button>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="title">
            <strong>{settings.shopName}</strong>
            <span>{today}</span>
          </div>
          <span className={'status-pill' + (online ? '' : ' off')}><span className="dot" />{online ? 'Online' : 'Offline, still working'}</span>
          <button className="iconbtn settings-mobile" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Gear size={22} /></button>
        </header>
        {needsBackup && (
          <button className="banner warn" style={{ border: 0, borderRadius: 0, textAlign: 'left' }} onClick={() => setSettingsOpen(true)}>
            <TriangleAlert size={18} /> No backup this week. Tap to save one.
          </button>
        )}
        <div className="content">
          {tab === 'sell' && <Sell />}
          {tab === 'items' && <Items />}
          {tab === 'credit' && <Credit />}
          {tab === 'reports' && <Reports />}
        </div>
        <nav className="tabs" aria-label="Main">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={id === tab ? 'on' : ''} onClick={() => setTab(id)} aria-current={id === tab}>
              <Icon size={22} />{label}
            </button>
          ))}
        </nav>
      </div>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>
}
