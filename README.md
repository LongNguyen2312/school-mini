# School Mini

Phaser 4 top-down village overworld (Vite + React + TypeScript) with multiplayer on Cloudflare [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) (Durable Objects).

## Run (local multiplayer)

```bash
npm install
npm run dev
```

Opens Vite (web) + `wrangler dev` (`127.0.0.1:1999`). Open the Vite URL in **two browser tabs** to test.

## Deploy

1. Multiplayer server: `npx wrangler login`, then `npm run deploy:party` → prints `https://school-mini.<account>.workers.dev`.
2. Web (Vercel): set env `VITE_PARTYKIT_HOST=school-mini.<account>.workers.dev` (no `https://`), then build/deploy.

## Features

- Lobby: name, clothes color, character style → join room
- See other players move in the overworld
- **Enter** to chat; bubble shows above head ~4s

## Assets in use

| Path | Role |
|------|------|
| `public/assets/player.png` | Player LPC spritesheet |
| `public/assets/npc/*` | Owner / waiter / bikini staff |
| `public/assets/grass/grass_seamless.png` | Overworld grass |
| `public/assets/path.png` | Roads |

Credits: `public/assets/LPC_CREDITS.txt`, `public/assets/MAP_CREDITS.txt`.
