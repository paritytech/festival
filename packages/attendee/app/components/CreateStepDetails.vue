<script setup lang="ts">
import { computed } from 'vue'
import type { FestivalDay } from '@festival/shared'
import InputField from './ui/InputField.vue'

interface FormData {
  name: string
  speaker: string
  description: string
  dateKey: string
  startMinutesOfDay: number | null
  endMinutesOfDay: number | null
}

const props = defineProps<{
  modelValue: FormData
  festivalDays: FestivalDay[]
  validStartSlots: number[]
  validEndSlots: number[]
  fullDateKeys?: Set<string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: FormData]
}>()

function patch<K extends keyof FormData>(key: K, value: FormData[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const canProceed = computed(
  () =>
    props.modelValue.name.trim() !== '' &&
    props.modelValue.dateKey !== '' &&
    props.modelValue.startMinutesOfDay != null &&
    props.modelValue.endMinutesOfDay != null,
)

defineExpose({ canProceed })
</script>

<template>
  <div class="space-y-6 px-4">
    <!-- Speaker (optional — left blank, a fun "Anonymous <Animal>" is saved) -->
    <InputField v-slot="{ inputId }" label="Speaker">
      <input
        :id="inputId"
        data-testid="session-speaker-input"
        :value="modelValue.speaker"
        type="text"
        placeholder="Leave blank to stay anonymous"
        class="w-full bg-transparent text-text-and-icons-primary text-base leading-5 font-normal focus:outline-none placeholder-white/30"
        @input="patch('speaker', ($event.target as HTMLInputElement).value)"
      />
    </InputField>

    <!-- Session Name -->
    <InputField v-slot="{ inputId }" label="Session Name" required>
      <input
        :id="inputId"
        data-testid="session-name-input"
        :value="modelValue.name"
        type="text"
        required
        aria-required="true"
        class="w-full bg-transparent text-text-and-icons-primary text-base leading-5 font-normal focus:outline-none placeholder-white/30"
        @input="patch('name', ($event.target as HTMLInputElement).value)"
      />
    </InputField>

    <SessionDatePicker
      :days="festivalDays"
      :model-value="modelValue.dateKey"
      :disabled-date-keys="fullDateKeys"
      @update:model-value="patch('dateKey', $event)"
    />

    <SessionTimePicker
      :start-minutes-of-day="modelValue.startMinutesOfDay"
      :end-minutes-of-day="modelValue.endMinutesOfDay"
      :valid-start-slots="validStartSlots"
      :valid-end-slots="validEndSlots"
      :disabled="!modelValue.dateKey"
      @update:start-minutes-of-day="patch('startMinutesOfDay', $event)"
      @update:end-minutes-of-day="patch('endMinutesOfDay', $event)"
    />

    <SessionDescriptionField
      :model-value="modelValue.description"
      @update:model-value="patch('description', $event)"
    />
  </div>
</template>
