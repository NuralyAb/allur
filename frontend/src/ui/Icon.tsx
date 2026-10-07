import type { CSSProperties } from 'react'

const paths = {
  close: 'M6 6l12 12M6 18 18 6',
  chart: 'M4 4v16h16M8 15v-4m5 4V7m5 8v-5',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  'arrow-left': 'M20 12H4m6-6-6 6 6 6',
  'chevron-right': 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  alert: 'm12 3 10 18H2L12 3Zm0 5v5m0 3v1',
  info: 'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  factory: 'M3 21V9l6 3V7l6 4V3h4l2 18H3Zm4-5v1m5-1v1m5-1v1',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  box: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9v10M3 8l9 4 9-4M7.5 5.5l9 5',
  search: 'm21 21-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M8 5v14M16 5v14',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  roof: 'm2 10 10-7 10 7M4 9v11h16V9M9 20v-7h6v7',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4 4h.01',
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
  rotate: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  menu: 'M4 6h16M4 12h16M4 18h16',
} as const
export type IconName = keyof typeof paths
export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name]} /></svg>
}
