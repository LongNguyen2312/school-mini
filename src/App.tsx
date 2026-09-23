import { useEffect, useRef, useState } from 'react'
import { createGame } from './game/Game'
import { checkNameAvailable } from './multiplayer/checkName'
import type { PlayerProfile } from './multiplayer/types'
import { Lobby } from './ui/Lobby'
import { SocialPanel } from './ui/SocialPanel'
import './App.css'

function App() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)
  const gameContainerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<ReturnType<typeof createGame> | null>(null)
  const joiningRef = useRef(false)

  useEffect(() => {
    const onTaken = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string }>).detail
      setJoinError(detail?.message || 'Tên đã có người dùng. Chọn tên khác.')
      setProfile(null)
    }
    window.addEventListener('sm-name-taken', onTaken)
    return () => window.removeEventListener('sm-name-taken', onTaken)
  }, [])

  useEffect(() => {
    if (!profile || !gameContainerRef.current) return

    const game = createGame(gameContainerRef.current, profile)
    gameRef.current = game

    const handleResize = () => {
      game.scale.resize(window.innerWidth, window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
      game.destroy(true)
      gameRef.current = null
    }
  }, [profile])

  const sendChat = (text: string) => {
    const game = gameRef.current
    if (!game) return
    const fn = game.registry.get('sendChat') as ((t: string) => void) | undefined
    fn?.(text)
  }

  const handleJoin = async (p: PlayerProfile) => {
    if (joiningRef.current) return
    joiningRef.current = true
    setJoining(true)
    setJoinError('')

    const result = await checkNameAvailable(p.name)
    joiningRef.current = false
    setJoining(false)

    if (!result.ok) {
      if (result.reason === 'taken') {
        setJoinError(`Tên “${p.name}” đã có người dùng. Chọn tên khác.`)
      } else if (result.reason === 'timeout') {
        setJoinError('Kết nối chậm — thử lại.')
      } else {
        setJoinError('Không kết nối được phòng (chạy npm run dev).')
      }
      return
    }

    setProfile(p)
  }

  if (!profile) {
    return <Lobby error={joinError} busy={joining} onJoin={handleJoin} />
  }

  return (
    <div className="app">
      <div ref={gameContainerRef} className="game-container" />
      <SocialPanel onSend={sendChat} selfName={profile.name} />
    </div>
  )
}

export default App
