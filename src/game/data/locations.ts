export type LocationKind = 'home' | 'hometown' | 'restaurant' | 'ktv'

export interface GameLocation {
  id: string
  name: string
  shortName: string
  kind: LocationKind
  lat: number
  lng: number
  /** True when lat/lng is estimated (user chưa cung cấp toạ độ chính xác). */
  coordsApproximate?: boolean
  address?: string
  /** Exterior building color */
  color: number
  /** Ground / scenery tint theme */
  groundColor: number
  description: string
}

export const LOCATIONS: GameLocation[] = [
  {
    id: 'home-tan-binh',
    name: '66B Nguyễn Sỹ Sách',
    shortName: '66B Nguyễn Sỹ Sách',
    kind: 'home',
    lat: 10.819956612007987,
    lng: 106.63581741470237,
    address: '66B Nguyễn Sỹ Sách, Phường 15, Tân Bình, TP.HCM',
    color: 0x6b8cae,
    groundColor: 0x4a6b4a,
    description: 'Nhà ở 66B Nguyễn Sỹ Sách, Tân Bình',
  },
  {
    id: 'nhau-tc',
    name: 'Quán nhậu TC',
    shortName: 'Quán nhậu TC',
    kind: 'restaurant',
    lat: 20.330900875457214,
    lng: 106.38676270367772,
    coordsApproximate: true,
    color: 0xc45a3a,
    groundColor: 0x5a6a4a,
    description: 'Quán nhậu TC — vào trong để ngồi order',
  },
  {
    id: 'che-cau-nguyet',
    name: 'Chè Cầu Nguyệt',
    shortName: 'Chè Cầu Nguyệt',
    kind: 'restaurant',
    lat: 20.780881162623878,
    lng: 106.61478898873385,
    color: 0xe8a0bf,
    groundColor: 0x6a7a5a,
    description: 'Chè Cầu Nguyệt — vào trong để ngồi order',
  },
  {
    id: 'ga-nguyen-con',
    name: 'Gà xé không chặt',
    shortName: 'Gà xé không chặt',
    kind: 'restaurant',
    lat: 20.78111528608902,
    lng: 106.61492656054797,
    color: 0xe09b5a,
    groundColor: 0x6a7a5a,
    description: 'Gà xé không chặt — vào trong để ngồi order',
  },
  {
    id: 'bun-chi-rau',
    name: 'Bún toàn rau',
    shortName: 'Bún toàn rau',
    kind: 'restaurant',
    lat: 20.78095,
    lng: 106.61515,
    coordsApproximate: true,
    color: 0x7cbc6e,
    groundColor: 0x6a7a5a,
    description: 'Bún toàn rau — vào trong để ngồi order',
  },
  {
    id: 'mat-xa-nguoi-mu',
    name: 'Mát xa người mù',
    shortName: 'Mát xa người mù',
    kind: 'restaurant',
    lat: 20.7814,
    lng: 106.6162,
    coordsApproximate: true,
    color: 0x7a9ec8,
    groundColor: 0x5a6a7a,
    description: 'Mát xa người mù — vào trong nghỉ ngơi',
  },
  {
    id: 'ktv-corner',
    name: 'KTV',
    shortName: 'KTV',
    kind: 'ktv',
    lat: 10.75,
    lng: 106.55,
    coordsApproximate: true,
    color: 0x6a2a8a,
    groundColor: 0x3a2a4a,
    description: 'Quán Karaoke — đèn LED tím hồng',
  },
]

export function mapsUrl(location: GameLocation): string {
  return `https://www.google.com/maps?q=${location.lat},${location.lng}`
}

export function getLocationById(id: string): GameLocation | undefined {
  return LOCATIONS.find((loc) => loc.id === id)
}
