import { useEffect, useRef, useState } from 'react'
import type { DataSource } from '../shared/types'
import { Icon } from '../shared/ui/Icon'
import type { Notify } from './AdminApp'
import { ApiError, api, fmtDate, fmtTs, type AuditRow } from './api'

export function DataSection({ notify }: { notify: Notify }) {
  const [source, setSource] = useState<DataSource | null>(null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null!)

  const load = () => {
    api.source().then(setSource, (e: Error) => notify({ kind: 'bad', text: e.message }))
    api.audit(50).then((rows) => setAudit(rows.filter((r) => /^(data|live)\./.test(r.action))), () => setAudit([]))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await action()
      notify({ kind: 'ok', text: done })
      load()
    } catch (e) {
      notify({ kind: 'bad', text: e instanceof ApiError && e.errors ? e.errors.join('; ') : (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!source) return <p className="muted">Загрузка…</p>
  return (
    <>
      <section className="panel">
        <div className="source-head">
          <span className={`dot ${source.live ? 'live' : ''}`} aria-hidden="true" />
          <div><strong>{source.source}</strong><small>{source.dates ? `Период ${fmtDate(source.dates[0])} — ${fmtDate(source.dates[1])}` : 'Данных нет'}{source.updatedAt && ` · обновлено ${fmtTs(source.updatedAt)}`} · версия {source.version}</small></div>
          <dl>
            {([['lines', 'Работа линий'], ['quality', 'Качество'], ['downtime', 'Простои'], ['monthPlan', 'План месяца']] as const).map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{source.counts[k]}</dd></div>)}
          </dl>
        </div>
      </section>
      <div className="two">
        <section className="panel">
          <h2>Живой поток</h2>
          <p className="muted">Симулятор линии заменяет MES, пока нет подключения к заводу: смена из 480 минут проходит за ~24 с и записывается в хранилище. После каждой смены показатели и решения пересчитываются.</p>
          <button className={source.live ? 'button-secondary' : 'button-primary'} disabled={busy} onClick={() => run(() => api.setLive(!source.live), source.live ? 'Симулятор остановлен' : 'Симулятор запущен')}>
            <Icon name={source.live ? 'pause' : 'play'} size={15} />{source.live ? 'Остановить симулятор' : 'Запустить симулятор'}
          </button>
        </section>
        <section className="panel">
          <h2>Выгрузка MES / 1С</h2>
          <p className="muted">XLSX или DOCX с таблицами кейса: работа линий, качество, простои, план месяца. Таблицы узнаются по заголовкам; шаблон — текущие данные.</p>
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')} aria-label="Режим загрузки">
              <option value="merge">Дополнить: даты из файла заменяют такие же</option>
              <option value="replace">Заменить всё</option>
            </select>
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.docx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => api.importFile(f, mode), `Файл «${f.name}» загружен`); e.target.value = '' }} />
            <button className="button-primary" disabled={busy} onClick={() => fileRef.current.click()}><Icon name="arrow-right" size={15} />Выбрать файл</button>
            <a className="button-secondary" href="/api/data/template" download>Шаблон XLSX</a>
          </div>
          <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm('Заменить все данные тестовыми данными кейса?')) run(api.resetData, 'Возвращены данные кейса') }}><Icon name="rotate" size={14} />Вернуть данные кейса</button>
        </section>
      </div>
      <section className="panel">
        <h2>Последние действия с данными</h2>
        {audit.length === 0 ? <p className="muted">Пока нет записей.</p> : (
          <table className="table">
            <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Подробности</th></tr></thead>
            <tbody>{audit.map((r) => <tr key={r.id}><td>{fmtTs(r.ts)}</td><td>{r.user}</td><td>{r.action}</td><td className="small mono">{JSON.stringify(r.details)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  )
}
