import { Component, type ReactNode } from 'react'
import { useTexture } from '@react-three/drei'
import { Icon } from './Icon'

/** Keep production data accessible when a device cannot render the 3D view. */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="scene-error" role="alert"><Icon name="box" size={30} /><strong>Не удалось отобразить 3D-модель</strong><p>Попробуйте загрузить её ещё раз.<br />Показатели и аналитика остаются доступны.</p><button className="button-primary" onClick={() => { useTexture.clear('/site_sat.jpg'); this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 })) }}><Icon name="rotate" size={15} />Повторить</button></div>
    return <div className="scene-renderer" key={this.state.attempt}>{this.props.children}</div>
  }
}
