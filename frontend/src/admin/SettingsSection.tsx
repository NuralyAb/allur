import { useEffect, useState } from 'react'
import { Icon } from '../shared/ui/Icon'
import type { Notify } from './AdminApp'
import { api, type Settings, type SettingsPayload } from './api'

type Field = { key: string; label: string; hint: string; step?: number; min?: number; max?: number; kind?: 'number' | 'bool' | 'select'; options?: [string, string][] }
const FIELDS: Record<keyof Settings, { title: string; text: string; fields: Field[] }> = {
  targets: {
    title: 'Цели производства',
    text: 'Пороги, с которыми сравниваются показатели в двойнике: цвет KPI, отклонения, разрыв с планом.',
    fields: [
      { key: 'oee', label: 'OEE, не менее, %', hint: 'цель кейса — 85', step: 1, min: 1, max: 100 },
      { key: 'defect', label: 'Брак, не более, %', hint: 'норма кейса — 2', step: 0.1, min: 0, max: 100 },
      { key: 'downtime_critical', label: 'Простой критического оборудования, мин/сутки', hint: 'лимит кейса — 60', step: 5, min: 1, max: 1440 },
      { key: 'monthly_output', label: 'Выпуск, авто/месяц, не менее', hint: 'цель кейса — 5 500', step: 100, min: 1, max: 100000 },
      { key: 'shifts', label: 'Смен в сутки', hint: 'по условию — 2', step: 1, min: 1, max: 3 },
    ],
  },
  calc: {
    title: 'Допущения расчётов',
    text: 'Параметры модели центра решений. Меняют прогноз месяца и эффект мероприятий.',
    fields: [
      { key: 'workDays', label: 'Рабочих дней в месяце', hint: 'по умолчанию 21: будни октября 2026 без 26.10', step: 1, min: 1, max: 31 },
      { key: 'predictiveCut', label: 'Доля предотвращённых внеплановых простоев', hint: 'эффект предиктивного обслуживания, 0–1', step: 0.05, min: 0, max: 1 },
      { key: 'windowDays', label: 'Окно темпа участков, дней', hint: 'сколько последних дней данных задают темп', step: 1, min: 1, max: 90 },
      { key: 'marginKzt', label: 'Маржинальный доход на автомобиль, ₸', hint: '0 — не задан; нужен для перевода эффекта в тенге', step: 10000, min: 0, max: 100000000 },
    ],
  },
  scene: {
    title: '3D-сцена по умолчанию',
    text: 'С чего начинается двойник у нового пользователя. Сам пользователь может переключить всё это в сцене.',
    fields: [
      { key: 'mood', label: 'Освещение', hint: '', kind: 'select', options: [['day', 'День'], ['sunset', 'Золотой час']] },
      { key: 'detailed', label: 'Высокое качество', hint: 'затенение контактов и детальные тени', kind: 'bool' },
      { key: 'labels', label: 'Подписи участков', hint: '', kind: 'bool' },
      { key: 'roof', label: 'Кровля закрыта', hint: 'иначе сразу показаны цеха', kind: 'bool' },
    ],
  },
}

export function SettingsSection({ notify }: { notify: Notify }) {
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.settings().then((d) => { setData(d); setDraft({ targets: d.targets, calc: d.calc, scene: d.scene }) }, (e: Error) => notify({ kind: 'bad', text: e.message }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !draft) return <p className="muted">Загрузка…</p>

  const save = async (section: keyof Settings) => {
    setBusy(true)
    try {
      const d = await api.saveSettings({ [section]: draft[section] })
      setData(d)
      setDraft({ targets: d.targets, calc: d.calc, scene: d.scene })
      notify({ kind: 'ok', text: `«${FIELDS[section].title}» сохранено — двойник пересчитает показатели` })
    } catch (e) { notify({ kind: 'bad', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const reset = async (section: keyof Settings) => {
    setBusy(true)
    try {
      const d = await api.resetSettings(section)
      setData(d)
      setDraft({ targets: d.targets, calc: d.calc, scene: d.scene })
      notify({ kind: 'ok', text: `«${FIELDS[section].title}» возвращено к значениям по умолчанию` })
    } catch (e) { notify({ kind: 'bad', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const set = (section: keyof Settings, key: string, value: unknown) => setDraft({ ...draft, [section]: { ...draft[section], [key]: value } })

  return (
    <div className="settings">
      {(Object.keys(FIELDS) as (keyof Settings)[]).map((section) => {
        const spec = FIELDS[section]
        const dirty = JSON.stringify(draft[section]) !== JSON.stringify(data[section])
        const isDefault = JSON.stringify(data[section]) === JSON.stringify(data.defaults[section])
        return (
          <section className="panel" key={section}>
            <div className="panel-head"><div><h2>{spec.title}</h2><p className="muted">{spec.text}</p></div><span className={`badge ${isDefault ? '' : 'badge-warn'}`}>{isDefault ? 'по умолчанию' : 'изменено'}</span></div>
            <div className="fields">
              {spec.fields.map((f) => {
                const value = (draft[section] as unknown as Record<string, unknown>)[f.key]
                const def = (data.defaults[section] as unknown as Record<string, unknown>)[f.key]
                return (
                  <label key={f.key} className="field">
                    <span>{f.label}</span>
                    {f.kind === 'bool' ? (
                      <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(section, f.key, e.target.checked)} />
                    ) : f.kind === 'select' ? (
                      <select value={String(value)} onChange={(e) => set(section, f.key, e.target.value)}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    ) : (
                      <input type="number" value={Number(value)} step={f.step} min={f.min} max={f.max} onChange={(e) => set(section, f.key, e.target.value === '' ? value : Number(e.target.value))} />
                    )}
                    <small>{f.hint}{f.kind !== 'bool' && f.kind !== 'select' && String(value) !== String(def) ? ` · по умолчанию ${def}` : ''}</small>
                  </label>
                )
              })}
            </div>
            <div className="row">
              <button className="button-primary" disabled={!dirty || busy} onClick={() => save(section)}><Icon name="check" size={15} />Сохранить</button>
              <button className="button-secondary" disabled={!dirty || busy} onClick={() => setDraft({ ...draft, [section]: data[section] })}>Отменить</button>
              <button className="text-button" disabled={isDefault || busy} onClick={() => reset(section)}><Icon name="rotate" size={14} />По умолчанию</button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
