<script setup lang="ts">
import { ref } from 'vue'
import IconMenu from '~icons/ic/round-menu'
import IconClose from '~icons/ic/round-close'
import { useWalletStore } from '@festival/shared/host/wallet'
import { useMyAddressModal } from '~/composables/useMyAddressModal'

const wallet = useWalletStore()
const myAddressModal = useMyAddressModal()
const mobileMenuOpen = ref(false)
const isDev = import.meta.dev

const router = useRouter()
router.afterEach(() => { mobileMenuOpen.value = false })
</script>

<template>
  <div class="h-screen flex flex-col lg:flex-row">
    <!-- Mobile header -->
    <header class="lg:hidden sticky top-0 h-14 bg-surface z-40 flex items-center px-4 gap-3 shrink-0">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/8 transition-colors"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <IconMenu v-if="!mobileMenuOpen" class="w-5 h-5" />
        <IconClose v-else class="w-5 h-5" />
      </button>
      <h1 class="font-heading text-sm font-bold">Festival Admin</h1>
    </header>

    <!-- Mobile nav overlay -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition duration-150"
        leave-to-class="opacity-0"
      >
        <div v-if="mobileMenuOpen" class="fixed inset-0 z-50 lg:hidden" @click.self="mobileMenuOpen = false">
          <div class="absolute inset-0 bg-black/80" @click="mobileMenuOpen = false" />
          <nav class="relative w-72 h-full bg-surface p-4 flex flex-col overflow-y-auto">
            <div class="flex items-center justify-between mb-6">
              <h1 class="font-heading text-xl font-bold">Festival Admin</h1>
              <button class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/8" @click="mobileMenuOpen = false">
                <IconClose class="w-5 h-5" />
              </button>
            </div>

            <div class="flex-1 space-y-1">
              <NuxtLink to="/" class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors" active-class="!bg-white/8 !text-text-primary font-medium">Dashboard</NuxtLink>
              <NuxtLink to="/create" class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors" active-class="!bg-white/8 !text-text-primary font-medium">Create Festival</NuxtLink>
            </div>

            <div class="border-t border-border pt-4 mt-4">
              <button
                v-if="wallet.isConnected"
                class="w-full text-left hover:bg-white/8 rounded-lg p-1.5 -m-1.5 transition-colors"
                @click="myAddressModal.open(); mobileMenuOpen = false"
              >
                <p class="text-xs text-text-muted">Connected</p>
                <p class="text-sm font-medium truncate">{{ wallet.accountName }}</p>
                <p class="text-xs text-text-muted font-mono">{{ wallet.truncatedAddress }}</p>
              </button>
              <p v-else class="text-xs text-text-muted">No wallet connected</p>
              <p v-if="isDev" class="text-[10px] text-primary mt-1">DEV MODE</p>
            </div>
          </nav>
        </div>
      </Transition>
    </Teleport>

    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex w-64 bg-surface p-4 flex-col shrink-0 overflow-y-auto">
      <h1 class="font-heading text-xl font-bold mb-6">Festival Admin</h1>

      <nav class="flex-1 space-y-1">
        <NuxtLink
          to="/"
          class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors"
          active-class="!bg-white/8 !text-text-primary font-medium"
        >
          Dashboard
        </NuxtLink>
        <NuxtLink
          to="/create"
          class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors"
          active-class="!bg-white/8 !text-text-primary font-medium"
        >
          Create Festival
        </NuxtLink>
      </nav>

      <!-- Wallet info -->
      <div class="border-t border-border pt-4 mt-4">
        <button
          v-if="wallet.isConnected"
          class="w-full text-left hover:bg-white/8 rounded-lg p-1.5 -m-1.5 transition-colors"
          @click="myAddressModal.open()"
        >
          <p class="text-xs text-text-muted">Connected</p>
          <p class="text-sm font-medium truncate">{{ wallet.accountName }}</p>
          <p class="text-xs text-text-muted font-mono">{{ wallet.truncatedAddress }}</p>
        </button>
        <p v-else class="text-xs text-text-muted">No wallet connected</p>
        <p v-if="isDev" class="text-[10px] text-primary mt-1">DEV MODE</p>
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 p-4 lg:p-6 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
