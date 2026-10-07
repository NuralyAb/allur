import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadAll } from './api'
import { Scene, outdoorShot, zoneShot, type Shot } from './scene/Scene'
import { hallToWorld } from './scene/geo'
import { buildTour } from './scene/tour'
import type { Kpi, OutdoorZone, Plant, Selection, Site, Zone } from './types'
import { TopBar } from './ui/TopBar'
import { TourBar } from './ui/TourBar'
import { ZoneList } from './ui/ZoneList'
import { ZonePanel } from './ui/ZonePanel'

const STEP_MS = 9000

export default function App() {
  const [data, setData] = useState<{ plant: Plant; site: Site; kpi: Kpi } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAll().then(setData, (e: Error) => setError(e.message))
  }, [])

  if (error)
    return (
      <div className="splash">
        <div className="brand-logo">allur</div>
        <p>Не удалось получить данные от API: {error}</p>
        <p className="muted">Запустите бэкенд: uvicorn app.main:app --port 8000 (из папки backend)</p>
      </div>
    )
  if (!data)
    return (
      <div className="splash">
        <div className="brand-logo">allur</div>
        <p className="muted">Загрузка цифрового двойника…</p>
      </div>
    )
  return <Twin {...data} />
}

function Twin({ plant, site, kpi }: { plant: Plant; site: Site; kpi: Kpi }) {
  const tour = useMemo(() => buildTour(plant.hall), [plant])
  const [selection, setSelection] = useState<Selection>(null)
  const [roof, setRoof] = useState(true)
  const [labels, setLabels] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)

  const findSelection = useCallback(
    (id?: string): Selection => {
      if (!id) return null
      const z = plant.zones.find((x) => x.id === id)
      if (z) return { kind: 'zone', zone: z }
      const o = plant.outdoor.find((x) => x.id === id)
      return o ? { kind: 'outdoor', zone: o } : null
    },
    [plant],
  )

  const goTo = useCallback(
    (i: number) => {
      const s = tour[i]
      setStep(i)
      setRoof(s.roof)
      setSelection(findSelection(s.zone))
      setShot({ camera: s.camera, target: s.target })
    },
    [tour, findSelection],
  )

  // прямая ссылка на шаг экскурсии: ?step=5; произвольный ракурс в координатах корпуса:
  // ?cam=u,v,h,u2,v2,h2 (камера → цель), &roof=1 — с кровлей
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const n = Number(q.get('step'))
    if (n >= 1 && n <= tour.length) goTo(n - 1)
    const cam = q.get('cam')?.split(',').map(Number)
    if (cam?.length === 6 && cam.every(Number.isFinite)) {
      setRoof(q.get('roof') === '1')
      setShot({ camera: hallToWorld(plant.hall, cam[0], cam[1], cam[2]), target: hallToWorld(plant.hall, cam[3], cam[4], cam[5]) })
    }
  }, [tour, goTo, plant])

  // автопереход шагов экскурсии
  useEffect(() => {
    if (!playing || step === null) return
    if (step >= tour.length - 1) {
      const t = setTimeout(() => setPlaying(false), STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => goTo(step + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [playing, step, tour.length, goTo])

  const selectZone = (z: Zone) => {
    setPlaying(false)
    setRoof(false)
    setSelection({ kind: 'zone', zone: z })
    setShot(zoneShot(plant, z))
  }
  const selectOutdoor = (z: OutdoorZone) => {
    setPlaying(false)
    setSelection({ kind: 'outdoor', zone: z })
    setShot(outdoorShot(z))
  }

  return (
    <div className="app">
      <Scene
        plant={plant}
        site={site}
        roof={roof}
        labels={labels}
        selection={selection}
        shot={shot}
        mood="sunset"
        detailed={true}
        onSelectZone={selectZone}
        onSelectOutdoor={selectOutdoor}
        onUserMove={() => setPlaying(false)}
      />
      <TopBar plant={plant} kpi={kpi} />
      <ZoneList plant={plant} selection={selection} onZone={selectZone} onOutdoor={selectOutdoor} />
      <ZonePanel plant={plant} kpi={kpi} selection={selection} onClose={() => setSelection(null)} />
      <TourBar
        stops={tour}
        index={step}
        playing={playing}
        roof={roof}
        labels={labels}
        onPlay={() => {
          setPlaying(true)
          goTo(step === null || step >= tour.length - 1 ? 0 : step)
        }}
        onStop={() => setPlaying(false)}
        onStep={(i) => goTo(i)}
        onRoof={() => setRoof((r) => !r)}
        onLabels={() => setLabels((l) => !l)}
      />
      <footer className="attrib">
        Контуры зданий © OpenStreetMap contributors · Спутник: Esri World Imagery · Расстановка цехов — по карте-схеме проекта НДВ ТОО «СарыаркаАвтоПром» (2022)
      </footer>
    </div>
  )
}
