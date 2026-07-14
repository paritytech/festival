<script setup lang="ts">
import { useId, useSlots } from 'vue'

defineProps<{
  label: string
  required?: boolean
}>()

const inputId = useId()
const slots = useSlots()
</script>

<template>
  <div class="rounded-xl bg-fill-6 ring-1 ring-inset ring-stroke-primary px-4 py-3">
    <div
      class="mb-1"
      :class="slots['label-trailing'] ? 'flex items-center justify-between' : ''"
    >
      <label
        :for="inputId"
        class="block text-xs leading-[18px] font-normal text-text-and-icons-secondary"
      >
        {{ label }}<span v-if="required" aria-hidden="true" class="text-fg-error">*</span>
      </label>
      <slot name="label-trailing" />
    </div>
    <slot :inputId="inputId" />
  </div>
</template>
