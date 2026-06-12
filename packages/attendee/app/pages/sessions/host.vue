<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRegistration } from '~/composables/useRegistration'
import { useOnboardingSeen } from '~/composables/useOnboardingSeen'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'

const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS)
const { markSeen } = useOnboardingSeen()

watch(
  isCheckedIn,
  (checkedIn) => {
    if (!checkedIn) navigateTo('/', { replace: true })
  },
  { immediate: true },
)

onMounted(() => {
  markSeen('host-session')
})
</script>

<template>
  <div class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[60] bg-white flex flex-col">
    <!-- Back chevron -->
    <div class="px-4 pt-[calc(var(--safe-top)+16px)] pb-3">
      <BackButton class="text-fg-primary-inverted" />
    </div>

    <!-- Centered illustration area -->
    <div class="flex-1 flex flex-col items-center justify-center px-8">
      <img
        src="/host-schedule-bw.svg"
        alt=""
        class="w-72 h-auto"
      />

      <h1 class="text-3xl font-bold text-black text-center mt-10 leading-tight max-w-xs">
        Bring your ideas to the stage like a host
      </h1>
    </div>

    <!-- Bottom section -->
    <div class="px-6 pb-[calc(var(--safe-bottom)+32px)] space-y-3">
      <NuxtLink
        to="/sessions/create"
        class="block w-full py-4 bg-black text-white text-center rounded-2xl font-semibold text-base"
      >
        Start
      </NuxtLink>

      <p class="text-black/40 text-sm text-center leading-snug">
        You can host up to two sessions per day<br />
        You can edit or cancel anytime
      </p>
    </div>
  </div>
</template>
