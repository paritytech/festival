<script setup lang="ts">
const steps = [
  { icon: '/three-dots-inline.svg', before: 'Tap the', after: 'menu in the top right' },
  { icon: '/chat-bubble-inline.svg', before: 'Open', after: '"Chat" from the menu' },
]
</script>

<template>
  <div
    class="-mx-4 flex flex-col min-h-[calc(100dvh-52px)] md:min-h-[100dvh]"
    data-testid="chat-page"
  >
    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center shrink-0">
      <BackButton class="text-text-and-icons-primary" />
      <h1
        class="flex-1 text-center text-base font-semibold text-text-and-icons-primary"
        data-testid="chat-heading"
      >
        Festival Chat
      </h1>
      <div class="w-10" />
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-6 pb-6">
      <img
        src="/festival-chat-hero.svg"
        alt=""
        class="mx-auto mt-4 w-full max-w-[340px]"
      />

      <h2
        class="mt-6 text-center text-[32px] font-semibold leading-[38px] text-text-and-icons-primary"
      >
        Ask festival in chat
      </h2>
      <p
        class="mt-2 text-center text-base leading-5 text-text-and-icons-secondary"
      >
        Try things like 'What's on now?' or 'Any new broadcast?'
      </p>

      <div class="rounded-2xl border border-stroke-primary p-4 mt-8">
        <p class="text-sm font-semibold uppercase tracking-wide text-text-and-icons-secondary">
          How to open chat
        </p>
        <ol class="mt-3 space-y-3">
          <li
            v-for="(step, i) in steps"
            :key="i"
            class="flex items-center gap-2 text-base leading-snug text-text-and-icons-primary"
          >
            <span class="shrink-0">{{ i + 1 }}.</span>
            <span>
              {{ step.before }}
              <img
                :src="step.icon"
                alt=""
                class="inline-block h-6 w-6 align-middle mx-0.5"
              />
              {{ step.after }}
            </span>
          </li>
          <li class="flex items-center gap-2 text-base leading-snug text-text-and-icons-primary">
            <span class="shrink-0">{{ steps.length + 1 }}.</span>
            <span>Pick a topic to see the info</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>
