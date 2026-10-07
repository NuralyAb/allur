import { useEffect, useRef, useState } from 'react'
import { TEMPLATE_URL, importFile, resetData, setLive } from '../api'
import type { DataSource } from '../types'
import { Icon } from './Icon'
import { fmtDate } from './TopBar'

const COUNTS: [keyof DataSource['counts'], string][] = [['lines', 'Работа линий'], ['quality', 'Качество'], ['downtime', 'Простои'], ['monthPlan', 'План месяца']]

const PATH = [
  { title: 'Файл кейса', text: 'Тестовые данные организаторов (DOCX) — загружаются при первом запуске.' },
  { title: 'Выгрузка MES / 1С', text: 'Пилот без интеграции: раз в смену XLSX по шаблону. Даты из файла заменяют такие же даты.' },
  { title: 'Симулятор линии', text: 'Смена 480 мин проходит за ~24 с: счётчики, простои, пересчёт прогноза.' },
  { title: 'OPC UA / MQTT', text: 'Промышленный режим: счётчики кузовов на выходе участков, сигналы останова с кодом причины, брак с постов ОТК.' },
]

export function SourcePanel({ source, onClose, onChanged }: { source: DataSource; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null!)
  const fileRef = useRef<HTMLInputElement>(null!)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setErrors([])
    setMessage(null)
    try {
      await action()
      setMessage(done)
      onChanged()
    } catch (e) {
      setErrors((e as { errors?: string[] }).errors ?? [(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  const upload = (file?: File) => {
    if (!file) return
    run(() => importFile(file, mode), `Файл «${file.name}» загружен`)
    fileRef.current.value = ''
  }

  return (
    <dialog ref={ref} className="analytics-dialog source-dialog" aria-labelledby="source-title" onCancel={onClose}>
      <div className="analytics-heading">
        <div className="panel-title-row">
          <span className="panel-heading-icon"><Icon name="grid" /></span>
          <div><div className="panel-eyebrow">ДАННЫЕ ДВОЙНИКА</div><h2 id="source-title">Источник данных</h2><p>Все показатели, прогноз и решения считаются по одному хранилищу. Писать в него может любой источник ниже.</p></div>
        </div>
        <button className="analytics-close" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
      </div>
      <div className="analytics-body">
        <div className="source-current">
          <div>
            <span className={`source-dot${source.live ? ' live' : ''}`} />
            <div>
              <strong>{source.source}</strong>
              <span>{source.dates ? `Период ${fmtDate(source.dates[0])} — ${fmtDate(source.dates[1])}` : 'Данных нет'}{source.updatedAt && ` · обновлено ${new Date(source.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}</span>
            </div>
          </div>
          <dl>{COUNTS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{source.counts[k]}</dd></div>)}</dl>
        </div>

        <section>
          <h3>Живой поток</h3>
          <div className="source-row">
            <p className="analytics-note">Симулятор заменяет линию, пока нет доступа к системам завода: разыгрывает смену по профилю оборудования из кейса и пишет её в хранилище тем же форматом, что и импорт.</p>
            <button className={source.live ? 'button-secondary' : 'button-primary'} disabled={busy} onClick={() => run(() => setLive(!source.live), source.live ? 'Симулятор остановлен' : 'Симулятор запущен')}>
              <Icon name={source.live ? 'pause' : 'play'} size={15} />{source.live ? 'Остановить' : 'Запустить live'}
            </button>
          </div>
        </section>

        <section>
          <h3>Загрузить выгрузку</h3>
          <div className="source-row">
            <p className="analytics-note">XLSX или DOCX с таблицами кейса: работа линий, качество, простои, план месяца. Таблицы узнаются по заголовкам. Шаблон — текущие данные, его можно править и загружать обратно.</p>
            <div className="source-actions">
              <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')} aria-label="Режим загрузки">
                <option value="merge">Дополнить</option>
                <option value="replace">Заменить всё</option>
              </select>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.docx" hidden onChange={(e) => upload(e.target.files?.[0])} />
              <button className="button-primary" disabled={busy} onClick={() => fileRef.current.click()}><Icon name="arrow-right" size={15} />Выбрать файл</button>
              <a className="button-secondary" href={TEMPLATE_URL} download>Шаблон XLSX</a>
            </div>
          </div>
        </section>

        <div aria-live="polite">
          {message && <p className="source-message ok"><Icon name="check" size={14} />{message}</p>}
          {errors.length > 0 && <div className="source-message bad"><Icon name="alert" size={14} /><div><strong>Файл не загружен</strong><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></div></div>}
        </div>

        <section>
          <h3>Путь к данным завода</h3>
          <ol className="source-path">
            {PATH.map((p, i) => <li key={p.title}><span>{i + 1}</span><div><strong>{p.title}</strong><p>{p.text}</p></div></li>)}
          </ol>
          <button className="text-button" disabled={busy} onClick={() => run(resetData, 'Возвращены данные кейса')}><Icon name="rotate" size={14} />Вернуть данные кейса</button>
        </section>
      </div>
    </dialog>
  )
}
