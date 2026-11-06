import { use } from 'react'
import { DebugMap } from './DebugMap'
import { loadMapData } from './mapData'

export function World() {
  const data = use(loadMapData())

  return <DebugMap data={data} />
}
