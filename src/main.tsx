import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTouchDevice } from './game/touchDevice'

// Lets the CSS switch to the phone layout, using the same test as the code.
document.documentElement.classList.toggle('touch', isTouchDevice)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
