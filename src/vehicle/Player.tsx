import { useRef } from 'react'
import type { Group } from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { Scooter } from './Scooter'

export function Player() {
  const scooter = useRef<Group>(null)

  return (
    <>
      <Scooter ref={scooter} />
      <FollowCamera target={scooter} />
    </>
  )
}
