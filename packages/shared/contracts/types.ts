/** Role constants (keccak256 hashes matching contract) */
export const ROLES = {
  DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
  MANAGER_ROLE: '0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08' as `0x${string}`,
  VOLUNTEER_ROLE: '0xf7f0fdec05d2d68a3ca32c78a26a4236722632f1d98fdee081484acf844fc7dc' as `0x${string}`,
} as const

/** Festival getEventDetails() 10-field return tuple */
export interface FestivalDetails {
  metadataCid: `0x${string}`
  creator: `0x${string}`
  festivalPoapContract: `0x${string}`
  sessionPoapContract: `0x${string}`
  startTime: bigint
  endTime: bigint
  sessionsEnabled: boolean
  capacity: number
  cancelled: boolean
  registeredCount: bigint
}

/** FestivalSession getEventDetails() 8-field return tuple */
export interface SessionDetails {
  metadataCid: `0x${string}`
  creator: `0x${string}`
  poapContract: `0x${string}`
  parentFestival: `0x${string}`
  startTime: bigint
  endTime: bigint
  cancelled: boolean
  registeredCount: bigint
  flagCount: bigint
  flagThreshold: bigint
}

/** POAP data from getPOAPData() */
export interface POAPData {
  sourceContract: `0x${string}`
  attendee: `0x${string}`
  issuedAt: bigint
}
