import { watchReact } from './frameSteps'

// Its own file, imported for what it does: it has to run before React is loaded (main.tsx).
watchReact()
