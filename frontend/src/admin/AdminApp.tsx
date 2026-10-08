import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Icon, type IconName } from '../shared/ui/Icon'
import { ApiError, api, type Me } from './api'
import { DataSection } from './DataSection'
import { Overview, Production } from './Overview'
import { PlantEditor } from './PlantEditor'
import { SettingsSection } from './SettingsSection'
import { AuditSection, UsersSection } from './UsersSection'

type Section = 'overview' | 'production' | 'data' | 'plant' | 'settings' | 'users' | 'audit'
const SECTIONS: { id: Section; title: string; hint: string; icon: IconName }[] = [
  { id: 'overview', title: 'Обзор', hint: 'Статистика производства', icon: 'chart' },
  { id: 'production', title: 'Производство', hint: 'Отклонения, решения, SCADA', icon: 'factory' },
  { id: 'data', title: 'Данные', hint: 'Источник, импорт, симулятор', icon: 'grid' },
  { id: 'plant', title: '3D-модель', hint: 'Паспорт завода и участки', icon: 'box' },
  { id: 'settings', title: 'Настройки', hint: 'Цели и допущения расчётов', icon: 'settings' },
  { id: 'users', title: 'Пользователи', hint: 'Роли и доступ', icon: 'tag' },
  { id: 'audit', title: 'Аудит', hint: 'Журнал действий', icon: 'clock' },
]

export type Notice = { kind: 'ok' | 'bad'; text: string }
export type Notify = (notice: Notice) => void

function sectionFromHash(): Section {
  const id = window.location.hash.replace('#', '') as Section
  return SECTIONS.some((s) => s.id === id) ? id : 'overview'
}

export default function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [section, setSection] = useState<Section>(sectionFromHash)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    api.me().then(setMe, () => setMe(null))
    const onHash = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const notify: Notify = useCallback((n) => setNotice(n), [])
  const logout = async () => { await api.logout(); setMe(null) }

  if (me === undefined) return <div className="admin-splash"><a className="admin-logo" href="/">allur<span>ADMIN</span></a><p>Проверяем доступ…</p></div>
  if (!me || !me.admin) return <Login onDone={setMe} />

  const current = SECTIONS.find((s) => s.id === section)!
  return (
    <div className="admin">
      <aside className="admin-side" aria-label="Разделы администрирования">
        <a className="admin-logo" href="/">allur<span>ADMIN</span></a>
        <nav>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={s.id === section ? 'active' : ''} aria-current={s.id === section ? 'page' : undefined}>
              <Icon name={s.icon} size={17} /><span><strong>{s.title}</strong><small>{s.hint}</small></span>
            </a>
          ))}
        </nav>
        <div className="admin-side-foot">
          <a href="/" className="admin-link"><Icon name="box" size={15} />Цифровой двойник</a>
          <a href="/hmi.html" className="admin-link"><Icon name="layers" size={15} />Пульт HMI</a>
          <div className="admin-user"><strong>{me.name}</strong><small>{me.roleName} · {me.login}</small><button className="text-button" onClick={logout}>Выйти</button></div>
        </div>
      </aside>
      <main className="admin-main" id="main">
        <header className="admin-head"><div><span className="eyebrow">Администрирование</span><h1>{current.title}</h1><p>{current.hint}</p></div></header>
        {section === 'overview' && <Overview notify={notify} />}
        {section === 'production' && <Production notify={notify} />}
        {section === 'data' && <DataSection notify={notify} />}
        {section === 'plant' && <PlantEditor notify={notify} />}
        {section === 'settings' && <SettingsSection notify={notify} />}
        {section === 'users' && <UsersSection notify={notify} me={me} />}
        {section === 'audit' && <AuditSection notify={notify} />}
      </main>
      {notice && <div className={`admin-toast ${notice.kind}`} role="status"><Icon name={notice.kind === 'ok' ? 'check' : 'alert'} size={15} />{notice.text}</div>}
    </div>
  )
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [login, setLogin] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const enter = async (user: string, pass: string) => {
    setBusy(true)
    setError(null)
    try {
      const me = await api.login(user.trim(), pass)
      onDone({ ...me, guest: false, admin: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Сервер недоступен')
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void enter(login, password)
  }
  return (
    <div className="admin-splash">
      <a className="admin-logo" href="/">allur<span>ADMIN</span></a>
      <form className="admin-login" onSubmit={submit} aria-labelledby="login-title">
        <h1 id="login-title">Вход администратора</h1>
        <p>Статистика, управление данными, настройки расчётов, паспорт завода, пользователи и аудит.</p>
        <label>Логин<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></label>
        <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="form-error" role="alert"><Icon name="alert" size={14} />{error}</div>}
        <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Проверяем…' : 'Войти'}</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => { setLogin('admin'); setPassword('admin'); void enter('admin', 'admin') }}>Войти администратором (демо)</button>
        <small>Демо: <code>admin</code> / <code>admin</code>, вход одним нажатием. Диспетчеры и инженеры входят в пульт HMI, не сюда.</small>
      </form>
    </div>
  )
}
