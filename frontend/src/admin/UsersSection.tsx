import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../shared/ui/Icon'
import type { Notify } from './AdminApp'
import { api, fmtTs, type AdminUser, type AuditRow, type Me } from './api'

export function UsersSection({ notify, me }: { notify: Notify; me: Me }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<{ role: string; label: string }[]>([])
  const [form, setForm] = useState({ login: '', name: '', role: 'operator', password: '' })
  const [passwordFor, setPasswordFor] = useState<{ login: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.users().then((d) => { setUsers(d.users); setRoles(d.roles) }, (e: Error) => notify({ kind: 'bad', text: e.message }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await action(); notify({ kind: 'ok', text: done }); await load() } catch (e) { notify({ kind: 'bad', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const create = (e: FormEvent) => {
    e.preventDefault()
    run(async () => { await api.createUser(form); setForm({ login: '', name: '', role: 'operator', password: '' }) }, `Пользователь ${form.login.toLowerCase()} создан`)
  }

  return (
    <>
      <section className="panel">
        <h2>Учётные записи <small className="muted">{users.length}</small></h2>
        <p className="muted">Роли общие для пульта HMI и админки: наблюдатель — только чтение, оператор — пуск, стоп, сброс и квитирование тревог, инженер АСУ ТП — также уставки и режимы, администратор — всё это и этот раздел. Блокировка и смена пароля завершают текущие сессии пользователя.</p>
        <table className="table">
          <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.login === me.login
              return (
                <tr key={u.login} className={u.blocked ? 'blocked' : ''}>
                  <td><b>{u.login}</b>{self && <small className="muted"> · это вы</small>}</td>
                  <td>{u.name}</td>
                  <td><select value={u.role} disabled={self || busy} aria-label={`Роль: ${u.login}`} onChange={(e) => run(() => api.patchUser(u.login, { role: e.target.value }), `Роль ${u.login}: ${e.target.selectedOptions[0].text}`)}>{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></td>
                  <td>{u.blocked ? <span className="badge badge-bad">заблокирован</span> : <span className="badge badge-ok">активен</span>}</td>
                  <td className="actions">
                    <button className="text-button" disabled={self || busy} onClick={() => run(() => api.patchUser(u.login, { blocked: !u.blocked }), u.blocked ? `${u.login} разблокирован` : `${u.login} заблокирован`)}>{u.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
                    <button className="text-button" disabled={busy} onClick={() => setPasswordFor(passwordFor?.login === u.login ? null : { login: u.login, value: '' })}>Пароль</button>
                    <button className="text-button danger" disabled={self || busy} onClick={() => { if (window.confirm(`Удалить пользователя ${u.login}?`)) run(() => api.deleteUser(u.login), `${u.login} удалён`) }}>Удалить</button>
                    {passwordFor?.login === u.login && (
                      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => api.resetPassword(u.login, passwordFor.value), `Пароль ${u.login} изменён`).then(() => setPasswordFor(null)) }}>
                        <input type="password" placeholder="Новый пароль, от 6 символов" value={passwordFor.value} onChange={(e) => setPasswordFor({ ...passwordFor, value: e.target.value })} minLength={6} autoComplete="new-password" required />
                        <button className="button-secondary" type="submit" disabled={busy}>Сменить</button>
                      </form>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Новый пользователь</h2>
        <form className="fields" onSubmit={create}>
          <label className="field"><span>Логин</span><input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} pattern="[A-Za-z0-9._-]{1,64}" title="Латиница, цифры, точка, дефис, подчёркивание" required /><small>латиница и цифры</small></label>
          <label className="field"><span>Имя</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required /><small>как показывать в журналах</small></label>
          <label className="field"><span>Роль</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select><small> </small></label>
          <label className="field"><span>Пароль</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} maxLength={128} autoComplete="new-password" required /><small>от 6 символов</small></label>
          <div className="row"><button className="button-primary" type="submit" disabled={busy}><Icon name="check" size={15} />Создать</button></div>
        </form>
      </section>
    </>
  )
}

export function AuditSection({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { api.audit(500).then(setRows, (e: Error) => notify({ kind: 'bad', text: e.message })) }, [notify])
  if (!rows) return <p className="muted">Загрузка…</p>
  const q = filter.trim().toLowerCase()
  const shown = rows.filter((r) => !q || `${r.user} ${r.action} ${JSON.stringify(r.details)}`.toLowerCase().includes(q))
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Журнал действий <small className="muted">{shown.length}</small></h2><p className="muted">Вход, настройки, паспорт завода, пользователи, импорт и сброс данных, симулятор. Журнал команд оборудованию с цепочкой хешей — в пульте HMI, вкладка «Журнал аудита».</p></div><input className="search" placeholder="Фильтр: пользователь, действие, детали" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Фильтр журнала" /></div>
      {shown.length === 0 ? <p className="muted">Записей нет.</p> : (
        <table className="table">
          <thead><tr><th>Когда</th><th>Кто</th><th>Роль</th><th>Действие</th><th>Подробности</th></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id}><td>{fmtTs(r.ts)}</td><td>{r.user}</td><td className="muted">{r.role}</td><td><code>{r.action}</code></td><td className="small mono">{Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  )
}
