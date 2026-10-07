import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'

/** Small deterministic tiles, generated locally; no texture downloads. */
export function surfaceTile(kind: 'concrete' | 'asphalt' | 'roof', repeat = 1) {
  const size = 256
  const pixels = new Uint8Array(size * size * 4)
  let seed = 417
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = (seed / 4294967296 - 0.5) * (kind === 'asphalt' ? 26 : 9)
      // Periodic, low-contrast variation reads as a surface at close range and
      // remains seamless when the same small tile covers the whole factory.
      const grain = Math.sin(x * Math.PI / 64) * Math.cos(y * Math.PI / 128) * (kind === 'roof' ? 1.5 : 3)
      const joint = kind === 'concrete' && (x < 1 || y < 1) ? -18 : 0
      const rib = kind === 'roof' ? Math.cos(x * Math.PI / 8) * 3 + (x % 32 < 2 ? -12 : 0) : 0
      const value = Math.round(231 + noise + grain + joint + rib)
      const i = (y * size + x) * 4
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value
      pixels[i + 3] = 255
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

export function fenceTile() {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    const value = x % 16 < 1 || y % 16 < 1 ? 255 : 0
    data[i] = data[i + 1] = data[i + 2] = value
    data[i + 3] = 255
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(24, 1)
  texture.needsUpdate = true
  return texture
}
