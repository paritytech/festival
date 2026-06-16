import { ref } from "vue";
import type { TxStatus } from "@festival/shared/contracts/write";
import { writeContract } from "@festival/shared/contracts/write";
import { FestivalABI } from "@festival/shared/contracts/abis";
import { readIsRegistered } from "@festival/shared/contracts/festival-reads";
import { batchRead } from "@festival/shared/contracts/multicall";
import { formatTxError } from "@festival/shared/contracts/errors";
import { useWalletStore } from "@festival/shared/host/wallet";
import { addPending, dropPending } from "@festival/shared/cache/pending";
import {
  shortenAddress,
  ss58ToH160,
  h160ToSs58,
  isValidSs58,
  isValidEvmAddress,
} from "@festival/shared/utils/address";

export type CheckInStep =
  | "idle"
  | "scanning-account"
  | "validating-account"
  | "confirming"
  | "executing"
  | "success"
  | "error";

export interface CheckInRecord {
  address: string;
  name: string;
  time: string;
  method: "qr" | "manual";
}

function toH160(address: string): `0x${string}` {
  if (isValidEvmAddress(address)) return address as `0x${string}`;
  if (isValidSs58(address)) return ss58ToH160(address);
  return address as `0x${string}`;
}

/** Render any address (SS58 or H160) as a shortened SS58 for display. */
function toDisplaySs58(address: string): string {
  const ss58 = isValidEvmAddress(address) ? h160ToSs58(address) : address;
  return shortenAddress(ss58);
}

export function useCheckIn(festivalAddress: string) {
  const step = ref<CheckInStep>("idle");
  const attendeeSS58 = ref<string | null>(null);
  const txStatus = ref<TxStatus>("idle");
  const error = ref<string | null>(null);
  const accountStatus = ref<{ registered: boolean; checkedIn: boolean } | null>(
    null,
  );
  const errorSource = ref<"account" | "transaction" | null>(null);
  const recentCheckins = ref<CheckInRecord[]>([]);
  const MAX_RECENT_CHECKINS = 50;

  function addRecentCheckin(record: CheckInRecord) {
    recentCheckins.value.unshift(record);
    if (recentCheckins.value.length > MAX_RECENT_CHECKINS) {
      recentCheckins.value.length = MAX_RECENT_CHECKINS;
    }
  }

  function reset() {
    step.value = "idle";
    attendeeSS58.value = null;
    accountStatus.value = null;
    errorSource.value = null;
    txStatus.value = "idle";
    error.value = null;
  }

  function startScanningAccount() {
    error.value = null;
    errorSource.value = null;
    attendeeSS58.value = null;
    accountStatus.value = null;
    step.value = "scanning-account";
  }

  async function handleAccountScan(qrData: string) {
    const address = qrData.trim();
    if (!isValidSs58(address)) {
      error.value = "Invalid SS58 address";
      step.value = "scanning-account";
      return;
    }

    attendeeSS58.value = address;
    error.value = null;
    step.value = "validating-account";

    try {
      const attendeeH160 = ss58ToH160(address);
      const [registered, checkedIn] = (await batchRead([
        { address: festivalAddress as `0x${string}`, abi: FestivalABI, functionName: 'isRegistered', args: [attendeeH160] },
        { address: festivalAddress as `0x${string}`, abi: FestivalABI, functionName: 'isCheckedIn', args: [attendeeH160] },
      ])) as [boolean, boolean];

      if (checkedIn) {
        error.value = "This account is already checked in";
        errorSource.value = "account";
        step.value = "error";
        return;
      }

      accountStatus.value = { registered, checkedIn: false };
      step.value = "confirming";
    } catch {
      error.value = "Failed to verify account status on-chain";
      errorSource.value = "account";
      step.value = "error";
    }
  }

  async function executeCheckIn() {
    if (attendeeSS58.value === null) return;

    step.value = "executing";
    txStatus.value = "preparing";
    error.value = null;

    // Captured before the tx so a late failure still drops the right key,
    // even if the operator already moved on to the next attendee.
    const attendeeH160 = ss58ToH160(attendeeSS58.value);
    try {
      const wallet = useWalletStore();
      const registered = accountStatus.value?.registered ?? false;
      const fnName = registered ? "checkIn" : "manualCheckIn";

      await writeContract({
        address: festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: fnName,
        args: [attendeeH160],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s;
          // Attendee list shows the check-in immediately; the overlay rolls
          // back on failure and is GC'd once the CheckedIn event confirms.
          if (s === "broadcasting") addPending("checkin", attendeeH160);
          if (s === "in-block") {
            addRecentCheckin({
              address: shortenAddress(attendeeSS58.value!),
              name: registered ? "Check-In" : "Manual Check-In",
              time: "just now",
              method: "qr",
            });
            step.value = "success";
          }
        },
      });
    } catch (e: any) {
      dropPending("checkin", attendeeH160);
      txStatus.value = "error";
      error.value = formatTxError(e);
      errorSource.value = "transaction";
      step.value = "error";
    }
  }

  /** Manual fallback — check in by typed/scanned address via Festival. */
  async function manualCheckInOnly(address: string) {
    txStatus.value = "preparing";
    error.value = null;

    try {
      const wallet = useWalletStore();
      const attendeeH160 = toH160(address);
      const registered = await readIsRegistered(
        festivalAddress as `0x${string}`,
        attendeeH160,
      );
      const fnName = registered ? "checkIn" : "manualCheckIn";

      await writeContract({
        address: festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: fnName,
        args: [attendeeH160],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s;
          if (s === "broadcasting") addPending("checkin", attendeeH160);
          if (s === "in-block") {
            addRecentCheckin({
              address: toDisplaySs58(address),
              name: registered ? "Check-In" : "Manual Check-In",
              time: "just now",
              method: "manual",
            });
          }
        },
      });
    } catch (e: any) {
      dropPending("checkin", toH160(address));
      txStatus.value = "error";
      error.value = formatTxError(e);
      throw new Error(error.value);
    }
  }

  return {
    step,
    attendeeSS58,
    accountStatus,
    errorSource,
    txStatus,
    error,
    recentCheckins,
    reset,
    startScanningAccount,
    handleAccountScan,
    executeCheckIn,
    manualCheckInOnly,
  };
}
