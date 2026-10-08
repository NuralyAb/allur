import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import HmiApp from './HmiApp'
import './hmi.css'

createRoot(document.getElementById('root')!).render(<StrictMode><HmiApp /></StrictMode>)
