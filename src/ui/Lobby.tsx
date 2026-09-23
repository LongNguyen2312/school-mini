import { useState, type FormEvent } from 'react'
import { SHIRT_COLORS, type PlayerProfile } from '../multiplayer/types'
import './Lobby.css'

type Props = {
  onJoin: (profile: PlayerProfile) => void | Promise<void>
  error?: string
  busy?: boolean
}

export function Lobby({ onJoin, error, busy }: Props) {
  const [name, setName] = useState(() => localStorage.getItem('sm-name') || '')
  const [bald, setBald] = useState(() => localStorage.getItem('sm-bald') === '1')
  const [shirtId, setShirtId] = useState(
    () => localStorage.getItem('sm-shirt') || SHIRT_COLORS[0].id,
  )

  const shirt = SHIRT_COLORS.find((c) => c.id === shirtId) ?? SHIRT_COLORS[0]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const trimmed = name.trim().slice(0, 16) || 'Khách'
    localStorage.setItem('sm-name', trimmed)
    localStorage.setItem('sm-bald', bald ? '1' : '0')
    localStorage.setItem('sm-shirt', shirt.id)
    void onJoin({
      name: trimmed,
      bald,
      shirtColor: shirt.color,
    })
  }

  return (
    <div className="lobby">
      <form className={`lobby-card${busy ? ' is-busy' : ''}`} onSubmit={submit}>
        <h1 className="lobby-title">School Mini</h1>
        <p className="lobby-sub">Nhập tên, chọn tóc & áo, vào làng cùng mọi người</p>

        <label className="lobby-label">
          Tên
          <input
            className="lobby-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="Tên của bạn"
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(error)}
          />
        </label>
        {error ? <p className="lobby-error">{error}</p> : null}
        {busy ? <p className="lobby-busy">Đang kiểm tra tên…</p> : null}

        <div className="lobby-label">Tóc</div>
        <div className="lobby-choice">
          <button
            type="button"
            disabled={busy}
            className={`lobby-choice-btn${!bald ? ' is-on' : ''}`}
            onClick={() => setBald(false)}
          >
            Có tóc
          </button>
          <button
            type="button"
            disabled={busy}
            className={`lobby-choice-btn${bald ? ' is-on' : ''}`}
            onClick={() => setBald(true)}
          >
            Đầu trọc
          </button>
        </div>

        <div className="lobby-label">Màu áo</div>
        <div className="lobby-swatches">
          {SHIRT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              disabled={busy}
              className={`lobby-swatch${shirtId === c.id ? ' is-on' : ''}`}
              style={{ background: `#${c.color.toString(16).padStart(6, '0')}` }}
              onClick={() => setShirtId(c.id)}
            />
          ))}
        </div>

        <div className="lobby-preview-wrap">
          <div className="lobby-preview-stack">
            <div className={`lobby-preview-hair${bald ? ' is-bald' : ''}`} />
            <div
              className="lobby-preview-shirt"
              style={{ background: `#${shirt.color.toString(16).padStart(6, '0')}` }}
            />
          </div>
          <span>
            {name.trim() || 'Khách'} · {bald ? 'Trọc' : 'Có tóc'}
          </span>
        </div>

        <button className="lobby-join" type="submit" disabled={busy}>
          {busy ? 'Đang vào…' : 'Vào làng'}
        </button>
      </form>
    </div>
  )
}
