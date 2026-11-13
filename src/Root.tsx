import { lazy, Suspense } from 'react'
import { isMobileDevice } from './game/mobileDevice'
import { MobileNotice } from './ui/MobileNotice'

// The game is loaded only on a computer, so a phone never downloads three.js or the city.
const App = lazy(() => import('./App.tsx'))

/** A phone or tablet gets a page saying to play on a computer. A computer gets the game. */
export function Root() {
  if (isMobileDevice) return <MobileNotice />
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}
