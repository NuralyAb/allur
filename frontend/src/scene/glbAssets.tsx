import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CarModelId } from './carModels'

export interface GlbAssetSpec {
  /** A self-hosted, self-contained model beneath public/models/. */
  url: string
  /** Intended length along the scene's X axis, in metres after rotation. */
  length: number
  /** Rotation about Y in radians; the front of a car should face +X. */
  rotationY: number
  source: string
  author: string
  license: string
}

export interface GlbAssetsRegistry {
  cars: Record<CarModelId, GlbAssetSpec | null>
  conveyor: GlbAssetSpec | null
}

// Exact vehicle/equipment assets have not been supplied or downloaded yet.
// Null entries retain the existing scene without requesting missing GLB files.
const DEFAULT_ASSETS: GlbAssetsRegistry = {
  cars: { onix: null, cobalt: null, j7: null },
  conveyor: null,
}

const CAR_MODELS: CarModelId[] = ['onix', 'cobalt', 'j7']
const LOCAL_MODEL_URL = /^\/models\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.glb$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
}

function parseAsset(value: unknown, name: string): GlbAssetSpec | null {
  if (value === null) return null
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' || !LOCAL_MODEL_URL.test(value.url) ||
    typeof value.length !== 'number' || !Number.isFinite(value.length) || value.length < 0.1 || value.length > (name === 'conveyor' ? 12.8 : 100) ||
    typeof value.rotationY !== 'number' || !Number.isFinite(value.rotationY) || Math.abs(value.rotationY) > Math.PI * 2 ||
    !hasText(value.source) || !hasText(value.author) || !hasText(value.license)
  ) {
    throw new Error(`Invalid GLB entry "${name}": use a local /models/*.glb URL, length 0.1–${name === 'conveyor' ? 12.8 : 100} m, rotationY in radians (−2π…2π), and source, author and license.`)
  }

  return {
    url: value.url,
    length: value.length,
    rotationY: value.rotationY,
    source: value.source.trim(),
    author: value.author.trim(),
    license: value.license.trim(),
  }
}

/** Validate the complete manifest before enabling any replacement models. */
export function parseGlbAssetsManifest(value: unknown): GlbAssetsRegistry {
  if (!isRecord(value) || !isRecord(value.cars)) {
    throw new Error('GLB manifest must contain a cars object and a conveyor entry.')
  }
  if (Object.keys(value.cars).some((key) => !CAR_MODELS.includes(key as CarModelId))) {
    throw new Error('GLB manifest supports only onix, cobalt and j7 car models.')
  }

  return {
    cars: {
      onix: parseAsset(value.cars.onix, 'cars.onix'),
      cobalt: parseAsset(value.cars.cobalt, 'cars.cobalt'),
      j7: parseAsset(value.cars.j7, 'cars.j7'),
    },
    conveyor: parseAsset(value.conveyor, 'conveyor'),
  }
}

let manifestRequest: Promise<GlbAssetsRegistry> | undefined
let warned = false

function loadManifest(): Promise<GlbAssetsRegistry> {
  // Share one request across providers and React StrictMode's effect replay.
  manifestRequest ??= fetch('/models/manifest.json', { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GLB manifest request failed (${response.status}).`)
      return parseGlbAssetsManifest(await response.json())
    })
    .catch((error: unknown) => {
      if (!warned) {
        warned = true
        console.warn('Optional GLB models are unavailable; retaining the existing scene.', error)
      }
      return DEFAULT_ASSETS
    })
  return manifestRequest
}

const GlbAssetsContext = createContext<GlbAssetsRegistry>(DEFAULT_ASSETS)

export function GlbAssetsProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState(DEFAULT_ASSETS)

  useEffect(() => {
    let active = true
    void loadManifest().then((registry) => {
      if (active) setAssets(registry)
    })
    return () => { active = false }
  }, [])

  return <GlbAssetsContext.Provider value={assets}>{children}</GlbAssetsContext.Provider>
}

export function useGlbAssets(): GlbAssetsRegistry {
  return useContext(GlbAssetsContext)
}
