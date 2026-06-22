// @festival/shared. Barrel exports

// Host
export { detectHostEnvironment, isInHost } from './host/detect'
export type { HostEnvironment } from './host/detect'
export { bootApp } from './host/boot'
export { useMainClient, useBulletinClient } from './host/client'
export { useWalletStore } from './host/wallet'
export type { WalletAccount } from './host/wallet'
export * from './host/constants'
export {
  sendNotification,
  pushNotification,
  cancelNotification,
  SCHEDULE_LIMIT_REACHED,
} from './host/notifications'
export type {
  NotificationId,
  PushNotificationInput,
  ScheduleLimitReached,
} from './host/notifications'
export {
  requestCameraPermission,
  requestNotificationsPermission,
  requestRemoteAccess,
  checkChainSupported,
} from './host/permissions'

// Contracts
export { readContract } from './contracts/read'
export { writeContract, watchTransaction } from './contracts/write'
export type { TxStatus } from './contracts/write'
export * from './contracts/types'
export * from './contracts/addresses'
export { decodeContractError, formatTxError } from './contracts/errors'
export {
  hasDeployedContracts, isNonZeroCid,
  readFestivalDetails, readSessionDetails,
  readFestivalAttendees, readSessionAddresses,
  readIsRegistered, readIsCheckedIn, readTicketOf, readHasRole,
  readTokensBySource, readPOAPData,
  readRoleMemberCount, readRoleMember, readRoleMembers,
  readSessionAttendees,
} from './contracts/festival-reads'
export { loadUserRoles, ROLE_OPTIONS } from './contracts/role-helpers'
export {
  checkInSession, manualCheckInSession, cancelSession,
  grantSessionRole, revokeSessionRole, updateSessionCid,
} from './contracts/session-writes'

// Permissions
export { usePermissions } from './permissions'
export type { ContractRole } from './permissions'

// Metadata
export * from './metadata/schemas'
export { validateFestivalMetadata, validateSubEventMetadata } from './metadata/validation'
export type { ValidationResult } from './metadata/validation'
export { computeCid, cidToBytes32, bytes32ToCid, cidToGatewayUrl } from './metadata/cid'
export { useBulletinStorage } from './metadata/bulletin'
export type { BulletinTxStatus } from './metadata/bulletin'
export { compressImage, compressImageFromUrl } from './metadata/image'

// Check-in
export { createCheckInChallenge, isChallengeValid } from './checkin/sign'
export type { CheckInPayload } from './checkin/sign'
export { verifyCheckInChallenge } from './checkin/verify'
export type { VerificationResult } from './checkin/verify'
export {
  encodeCheckInQR, decodeCheckInQR, isCheckInQR, extractCheckInAddress,
} from './checkin/qr'
export type { CheckInQRData } from './checkin/qr'

// Identity
export { resolveDisplayName } from './identity/resolve'

// Utils
export * from './utils/address'
export { formatBalance, parseBalance } from './utils/balance'
export {
  formatTimestamp, formatDuration, isHappeningNow, timeUntil, timestampToInputBounds,
  formatTimeBerlin, formatDateBerlin, formatDateTimeBerlin, berlinHourOf, toBerlinDateKey,
  parseFestivalDate, berlinFormToUnix,
} from './utils/time'
export { GRID_SIZE, PIXEL_COUNT, PALETTE, encodeBadgeHex, decodeBadgeHex, generateBadge } from './utils/badge'
export type { EditorTool } from './utils/badge'

// Sessions
export {
  DAY_START_HOUR, DAY_END_HOUR, SLOT_MIN, MIN_DURATION_MIN, MAX_DURATION_MIN,
  dateKeyOf, berlinHourToDate, berlinMinuteToDate,
  formatTimeLabel, formatDurationLabel,
  getValidFestivalDays, getValidStartSlots, getValidEndSlots,
  bucketHours, minutesInHour,
  validateSessionTime,
} from './sessions/timeWindow'
export type {
  FestivalDay, SessionTimeRange, SessionTimeValidation, SessionTimeValidationFailReason,
} from './sessions/timeWindow'
