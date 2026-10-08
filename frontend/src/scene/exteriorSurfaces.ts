import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'

/** Soft mineral/grass variation without baked buildings, vehicles or satellite shadows. */
function makeTerrain() {
  const size = 256, pixels = new Uint8Array(size * size * 4)
  let seed = 812
  const lattice = Array.from({ length: 64 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  })
  const smooth = (v: number) => v * v * (3 - 2 * v)
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy)
    const sample = (a: number, b: number) => lattice[(b % 8) * 8 + a % 8]
    const top = sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx
    const bottom = sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx
    return top * (1 - ty) + bottom * ty - 0.5
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const grain = (seed / 4294967296 - 0.5) * 12
    const patches = noise(x / 32, y / 32) * 10 + noise(x / 8, y / 8) * 4
    const i = (y * size + x) * 4, value = 222 + grain + patches
    pixels[i] = value + 2; pixels[i + 1] = value + 2; pixels[i + 2] = value - 3; pixels[i + 3] = 255
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(320, 320)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

export const terrainTexture = makeTerrain()
