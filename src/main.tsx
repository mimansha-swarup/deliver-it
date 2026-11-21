// First: `?fresh=1` has to be in place before any store opens its save (game/saveKeys.ts).
import './game/saveKeys'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
