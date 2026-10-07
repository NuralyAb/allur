import { Environment, Lightformer, Sky } from '@react-three/drei'
import { Vector3 } from 'three'

export type LightMood = 'day' | 'sunset'

export function Lighting({ mood, detailed }: { mood: LightMood; detailed: boolean }) {
  const evening = mood === 'sunset'
  const sun = evening ? new Vector3(-480, 210, 320) : new Vector3(-360, 580, 320)
  return (
    <>
      <color attach="background" args={[evening ? '#d6c3b4' : '#dce5eb']} />
      <fog attach="fog" args={[evening ? '#d6c3b4' : '#dce5eb', 1150, 3000]} />
      <Sky sunPosition={sun} turbidity={evening ? 3.5 : 4} rayleigh={evening ? 2 : 0.4} mieCoefficient={0.003} />
      <hemisphereLight args={['#edf4f9', evening ? '#826b58' : '#8b8e83', evening ? 0.65 : 1.05]} />
      <directionalLight key={detailed ? 'high-shadow' : 'light-shadow'} position={sun} color={evening ? '#ffd0a0' : '#fffaf2'} intensity={evening ? 2.5 : 2.45}
        castShadow shadow-mapSize={detailed ? [4096, 4096] : [2048, 2048]}
        shadow-bias={-0.00015} shadow-normalBias={0.18} shadow-radius={3}
        shadow-camera-left={-520} shadow-camera-right={520} shadow-camera-top={520} shadow-camera-bottom={-520}
        shadow-camera-near={1} shadow-camera-far={1800} />
      <directionalLight position={[300, 180, -350]} color="#dbe8f2" intensity={evening ? 0.3 : 0.4} />
      {/* Locally rendered studio sky gives metal and glass readable reflections. */}
      <Environment key={mood} resolution={128} frames={1} environmentIntensity={evening ? 0.65 : 0.7}>
        <color attach="background" args={['#b5c4cd']} />
        <Lightformer form="rect" intensity={2.6} color="#f1f5f8" position={[0, 20, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[40, 40]} />
        <Lightformer form="rect" intensity={3.5} color={evening ? '#ffd5aa' : '#fffaf2'} position={[-15, 8, 5]} rotation={[0, Math.PI / 2, 0]} scale={[12, 20]} />
        <Lightformer form="rect" intensity={1.8} color="#dfebf4" position={[15, 5, -10]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 14]} />
      </Environment>
    </>
  )
}
