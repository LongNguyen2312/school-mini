import { useEffect, useRef, useState, type FormEvent } from 'react'
import './SocialPanel.css'

export type OnlinePlayer = {
  id: string
  name: string
  self?: boolean
}

export type ChatLogEntry = {
  id: string
  name: string
  text: string
  at: number
}

type Props = {
  onSend: (text: string) => void
  selfName: string
  selfId?: string
}

export function SocialPanel({ onSend, selfName }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [text, setText] = useState('')
  const [online, setOnline] = useState<OnlinePlayer[]>([])
  const [log, setLog] = useState<ChatLogEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPlayers = (e: Event) => {
      const list = (e as CustomEvent<OnlinePlayer[]>).detail ?? []
      setOnline(list)
    }
    const onChat = (e: Event) => {
      const d = (e as CustomEvent<ChatLogEntry>).detail
      if (!d?.text) return
      setLog((prev) => [...prev.slice(-79), { ...d, at: d.at || Date.now() }])
    }
    window.addEventListener('sm-players', onPlayers)
    window.addEventListener('sm-chat', onChat)
    return () => {
      window.removeEventListener('sm-players', onPlayers)
      window.removeEventListener('sm-chat', onChat)
    }
  }, [])

  useEffect(() => {
    if (panelOpen) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log, panelOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      if (typing) {
        if (e.key === 'Escape') {
          setComposeOpen(false)
          setText('')
          ;(e.target as HTMLInputElement).blur()
        }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        setPanelOpen((v) => !v)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        setComposeOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (composeOpen) inputRef.current?.focus()
  }, [composeOpen])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (t) onSend(t)
    setText('')
    setComposeOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className={`social-toggle${panelOpen ? ' is-on' : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        title="Tab — Online & chat"
      >
        {panelOpen ? 'Thu gọn' : `Online · ${Math.max(online.length, 1)}`}
      </button>

      {panelOpen && (
        <aside className="social-panel">
          <div className="social-head">
            <strong>Đang online</strong>
            <span className="social-hint">Tab để đóng</span>
          </div>
          <ul className="social-online">
            {(online.length
              ? online
              : [{ id: 'self', name: selfName, self: true }]
            ).map((p) => (
              <li key={p.id} className={p.self ? 'is-self' : ''}>
                <span className="social-dot" />
                {p.name}
                {p.self ? ' (bạn)' : ''}
              </li>
            ))}
          </ul>
          <div className="social-head">
            <strong>Chat</strong>
          </div>
          <div className="social-log">
            {log.length === 0 && <p className="social-empty">Chưa có tin nhắn</p>}
            {log.map((m, i) => (
              <div key={`${m.at}-${i}`} className="social-line">
                <span className="social-name">{m.name}</span>
                <span className="social-text">{m.text}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </aside>
      )}

      {!composeOpen && (
        <>
          <div className="chat-hint">Enter — Chat · Tab — Online</div>
          <button type="button" className="chat-open" onClick={() => setComposeOpen(true)}>
            Chat
          </button>
        </>
      )}

      {composeOpen && (
        <form className="chat-bar" onSubmit={submit}>
          <input
            ref={inputRef}
            className="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={80}
            placeholder="Nhắn gì đó…"
            autoComplete="off"
          />
          <button type="submit" className="chat-send">
            Gửi
          </button>
        </form>
      )}
    </>
  )
}
