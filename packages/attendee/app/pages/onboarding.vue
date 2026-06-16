<script setup lang="ts">
import { useRegistration } from "~/composables/useRegistration";
import { useCheckInPoll } from "~/composables/useCheckInPoll";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";

const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);

// Attendees sit on this screen waiting to be scanned, so it can't rely solely
// on the event watcher / boot load having succeeded. Poll-reconcile check-in
// state (and retry a dead wallet connection) until checked in.
useCheckInPoll();
</script>

<template>
  <div
    v-if="isCheckedIn"
    class="min-h-full flex flex-col bg-bg-surface-main"
    data-testid="onboarding-checked-in"
  >
    <div class="flex flex-col items-center px-4 pt-15">
      <div
        role="img"
        aria-hidden="true"
        class="onboarding-illustration w-full max-w-sm"
        data-testid="onboarding-intro-illustration"
      />
      <h1
        class="font-semibold text-fg-primary text-center max-w-xs mt-[52px] text-onboarding-title"
        data-testid="onboarding-intro-heading"
      >
        Chat / Browse / Play<br />
        All within Polkadot App
      </h1>
    </div>
  </div>

  <div
    v-else
    class="min-h-full flex flex-col bg-bg-surface-main"
    data-testid="onboarding-page"
  >
    <div class="flex-1 flex flex-col justify-end pt-4 pb-8">
      <h1
        class="font-semibold text-fg-primary text-center px-4 max-w-xs mx-auto text-onboarding-title"
        data-testid="onboarding-heading"
      >
        Check in at Web3 Summit to activate Polkadot App
      </h1>
    </div>

    <HomePassport class="my-6" />

    <div class="px-4 pb-4 text-center text-sm text-text-and-icons-secondary">
      By continuing, you agree to the
      <a
        href="https://web3summit.com/cash-token-terms-and-conditions"
        class="underline"
        >CASH token Terms &amp; Conditions</a
      >
      and
      <a href="https://web3summit.com/event-rules" class="underline"
        >Event Rules</a
      >
    </div>

    <div class="flex-1 flex flex-col justify-start pt-[25px] pb-8">
      <HomeLocation />
    </div>
  </div>
</template>

<style scoped>
/* The illustration is driven by [data-theme] (set on <html> by plugins/theme.client.ts)
   so it stays in sync with the active palette. Same mechanism the colors use.
   Aspect ratio matches the source SVGs (391x524). */
.onboarding-illustration {
  aspect-ratio: 391 / 524;
  background-image: url("/onboarding/berlin-night.svg");
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
[data-theme="berlin-night"] .onboarding-illustration {
  background-image: url("/onboarding/berlin-night.svg");
}
[data-theme="berlin-day"] .onboarding-illustration {
  background-image: url("/onboarding/berlin-day.svg");
}
[data-theme="lisbon"] .onboarding-illustration {
  background-image: url("/onboarding/lisbon.svg");
}
[data-theme="malta"] .onboarding-illustration {
  background-image: url("/onboarding/malta.svg");
}
[data-theme="tokyo"] .onboarding-illustration {
  background-image: url("/onboarding/tokyo.svg");
}
</style>
