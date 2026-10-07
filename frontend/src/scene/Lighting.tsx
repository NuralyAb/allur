import { Environment, Lightformer, Sky } from '@react-three/drei'
import { Vector3 } from 'three'

export type LightMood = 'day' | 'sunset'

export function Lighting({ mood, detailed }: { mood: LightMood; detailed: boolean }) {
  const evening = mood === 'sunset'
  const sun = evening ? new Vector3(-480, 210, 320) : new Vector3(-300, 520, 260)
  return (
    <>
      <color attach="background" args={[evening ? '#d6c3b4' : '#b9d0df']} />
      <fog attach="fog" args={[evening ? '#d6c3b4' : '#c6d8e2', 950, 2800]} />
      <Sky sunPosition={sun} turbidity={evening ? 3.5 : 2.5} rayleigh={evening ? 2 : 0.65} mieCoefficient={0.003} />
      <hemisphereLight args={['#dbeeff', evening ? '#826b58' : '#646d65', evening ? 0.65 : 0.85]} />
      <directionalLight key={detailed ? 'high-shadow' : 'light-shadow'} position={sun} color={evening ? '#ffd0a0' : '#fff2db'} intensity={evening ? 2.5 : 2.8}
        castShadow shadow-mapSize={detailed ? [4096, 4096] : [2048, 2048]}
        shadow-bias={-0.00015} shadow-normalBias={0.18} shadow-radius={3}
        shadow-camera-left={-520} shadow-camera-right={520} shadow-camera-top={520} shadow-camera-bottom={-520}
        shadow-camera-near={1} shadow-camera-far={1800} />
      <directionalLight position={[300, 180, -350]} color="#bcdcff" intensity={evening ? 0.3 : 0.45} />
      {/* Locally rendered studio sky gives metal and glass readable reflections. */}
      <Environment key={mood} resolution={128} frames={1} environmentIntensity={evening ? 0.65 : 0.85}>
        <color attach="background" args={['#9ab5ca']} />
        <Lightformer form="rect" intensity={3} color="#e6f2ff" position={[0, 20, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[40, 40]} />
        <Lightformer form="rect" intensity={4} color={evening ? '#ffd5aa' : '#fff5e7'} position={[-15, 8, 5]} rotation={[0, Math.PI / 2, 0]} scale={[12, 20]} />
        <Lightformer form="rect" intensity={2} color="#d3e7ff" position={[15, 5, -10]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 14]} />
      </Environment>
    </>
  )
}
