<script setup lang="ts">
import { computed } from 'vue'
import InputField from './ui/InputField.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    maxLength?: number
    rows?: number
    placeholder?: string
  }>(),
  {
    maxLength: 1200,
    rows: 4,
    placeholder: 'Describe your session...',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const length = computed(() => props.modelValue.length)
</script>

<template>
  <InputField label="Session Description">
    <template #label-trailing>
      <span class="text-xs leading-[18px] font-normal text-text-and-icons-secondary" data-testid="session-description-counter">
        {{ length }}/{{ maxLength }}
      </span>
    </template>
    <template #default="{ inputId }">
      <textarea
        :id="inputId"
        data-testid="session-description-input"
        :value="modelValue"
        :rows="rows"
        :maxlength="maxLength"
        :placeholder="placeholder"
        class="w-full bg-transparent text-text-and-icons-primary text-base leading-5 font-normal focus:outline-none resize-none placeholder-text-and-icons-tertiary"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
    </template>
  </InputField>
</template>
