import { useRoom } from '../game/rooms'

/** Going through a door or up in a lift: the screen goes dark for a moment, with a word about where to (game/rooms.ts). */
export function RoomFade() {
  const fading = useRoom((state) => state.fading)
  const text = useRoom((state) => state.fadeText)
  return (
    <div className="room-fade" data-on={fading} aria-hidden={!fading}>
      {text && <p>{text}</p>}
    </div>
  )
}
