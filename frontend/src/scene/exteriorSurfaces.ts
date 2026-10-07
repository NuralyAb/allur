import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'

/** Soft mineral/grass variation without baked buildings, vehicles or satellite shadows. */
function makeTerrain() {
  const size = 256, pixels = new Uint8Array(size * size * 4)
  let seed = 812
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const grain = (seed / 4294967296 - 0.5) * 12
    const patches = Math.sin(x * Math.PI / 64) * Math.cos(y * Math.PI / 128) * 11 + Math.sin((x + y) * Math.PI / 32) * 3
    const i = (y * size + x) * 4, value = 222 + grain + patches
    pixels[i] = value + 2; pixels[i + 1] = value + 2; pixels[i + 2] = value - 3; pixels[i + 3] = 255
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(75, 75)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

export const terrainTexture = makeTerrain()
