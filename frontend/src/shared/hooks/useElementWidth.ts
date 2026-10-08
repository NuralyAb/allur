import { useLayoutEffect, useState, type RefObject } from 'react'

/** Ширина элемента в пикселях; обновляется при изменении размера — графики рисуются в реальных пикселях. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 640) {
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
