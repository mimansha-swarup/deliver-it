// First: `?fresh=1` has to be in place before any store opens its save (game/saveKeys.ts).
import './game/saveKeys'
// Then, with `?debug=2`: React's commits and its scheduler's tasks are watched from before React loads (dev/frameTimes.ts).
import './dev/watchReact'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
