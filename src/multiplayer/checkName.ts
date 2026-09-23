import PartySocket from 'partysocket'
import { partyHost, type ServerMsg } from './types'

export type NameCheckResult =
  | { ok: true }
  | { ok: false; reason: 'taken' | 'offline' | 'timeout' }

/**
 * Probe the room for name availability without joining as a player.
 * Stays on lobby — no Phaser mount / flicker.
 */
export function checkNameAvailable(rawName: string): Promise<NameCheckResult> {
  const name = rawName.trim().slice(0, 16) || 'Khách'

  return new Promise((resolve) => {
    let settled = false
    const socket = new PartySocket({
      host: partyHost(),
      room: 'village',
      party: 'main',
      maxRetries: 0,
    })

    const finish = (result: NameCheckResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 7000)

    socket.addEventListener('error', () => finish({ ok: false, reason: 'offline' }))
    socket.addEventListener('close', () => {
      if (!settled) finish({ ok: false, reason: 'offline' })
    })

    socket.addEventListener('open', () => {
      // hello arrives as first server message; if not, still send after open
    })

    socket.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data) as ServerMsg
      } catch {
        return
      }
      if (msg.type === 'hello') {
        socket.send(JSON.stringify({ type: 'checkName', name }))
        return
      }
      if (msg.type === 'nameOk') {
        finish({ ok: true })
        return
      }
      if (msg.type === 'nameTaken') {
        finish({ ok: false, reason: 'taken' })
      }
    })
  })
}
