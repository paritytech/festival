<script setup lang="ts">
// Badge-editor eraser tool. This glyph is custom-drawn (32×32) — it is not part
// of the Material Icons (`ic`) set, so it lives here as a local component rather
// than a `~icons/*` import. Color is driven by the parent via `currentColor`.
</script>

<template>
  <svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M17.89 4.69 4.69 17.88a2.67 2.67 0 0 0 0 3.77l5.65 5.66a2.67 2.67 0 0 0 3.77 0L27.31 14.11a2.67 2.67 0 0 0 0-3.77l-5.66-5.66a2.67 2.67 0 0 0-3.77 0Zm7.54 7.54L12.23 25.43l-5.66-5.66L19.77 6.57l5.66 5.66Z" />
    <path d="M10.98 11.59 3.82 18.75c-.56.56-.17 1.87.87 2.91l5.66 5.66c1.04 1.04 2.35 1.43 2.91.87l7.15-7.16c.56-.56.17-1.87-.87-2.91l-5.66-5.66c-1.03-1.04-2.34-1.43-2.9-.87Z" />
  </svg>
</template>
