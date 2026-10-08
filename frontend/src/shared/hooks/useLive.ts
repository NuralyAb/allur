import { useEffect, useState } from 'react'
import type { LiveState } from '../types'

/** Подписка на поток /api/stream: ход смены и версия хранилища. */
export function useLive() {
  const [live, setLiveState] = useState<LiveState | null>(null)
  useEffect(() => {
    const es = new EventSource('/api/stream')
    let last = ''
    // без симуляции сервер шлёт одно и то же раз в секунду — не перерисовываем
    es.onmessage = (e) => { if (e.data !== last) { last = e.data; setLiveState(JSON.parse(e.data) as LiveState) } }
    return () => es.close()
  }, [])
  return live
}
