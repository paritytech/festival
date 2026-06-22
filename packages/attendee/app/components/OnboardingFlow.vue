<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useOnboardingSeen } from '~/composables/useOnboardingSeen'

type Step = {
  illustration: string
  title: string
}

const props = withDefaults(
  defineProps<{
    steps: Step[]
    finalRoute?: string
    finalCta?: string
    storageKey?: string
  }>(),
  {
    finalRoute: '/program',
    finalCta: 'Explore Sessions',
    storageKey: undefined,
  },
)

const router = useRouter()
const { markSeen } = useOnboardingSeen()

onMounted(() => {
  if (props.storageKey) markSeen(props.storageKey)
})

const currentStep = ref(1)
const current = computed(() => props.steps[currentStep.value - 1]!)
const isLastStep = computed(() => currentStep.value === props.steps.length)

function goNext() {
  if (isLastStep.value) {
    router.push(props.finalRoute)
  } else {
    currentStep.value += 1
  }
}
</script>

<template>
  <div class="-mx-4 flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] bg-white text-black">
    <!-- Header: step progress -->
    <div class="px-4 pt-4 pb-3 shrink-0">
      <StepProgressBar :steps="steps.length" :current-step="currentStep" variant="dark" />
    </div>

    <!-- Body: illustration + title -->
    <div class="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <img
        :src="current.illustration"
        :alt="current.title"
        class="w-full max-w-[300px] md:max-w-[400px] aspect-square object-contain"
      />
      <h1 class="mt-8 text-[32px] leading-[38px] font-semibold max-w-[355px]">
        {{ current.title }}
      </h1>
    </div>

    <!-- Footer CTA -->
    <div class="px-4 pt-3 pb-[calc(var(--safe-bottom)+16px)] shrink-0">
      <button
        type="button"
        class="block w-full py-4 bg-black text-white rounded-2xl text-sm font-semibold text-center"
        @click="goNext"
      >
        {{ isLastStep ? finalCta : 'Next' }}
      </button>
    </div>
  </div>
</template>
