<script setup lang="ts">
import { useWalletStore } from '@/stores';
import { useQRCode } from '@vueuse/integrations/useQRCode';

const walletStore = useWalletStore();
const qrcode = useQRCode(walletStore.currentAddress);
</script>

<template>
  <div class="modern-card p-4 text-center shadow-modern">
    <div class="text-xl font-semibold text-center text-gray-900 dark:text-white">Pay Me</div>
    <div v-if="walletStore.currentAddress" class="flex items-center justify-center mt-8 mb-4">
      <img :src="qrcode" alt="QR Code" class="rounded-sm overflow-hidden" />
    </div>
    <div class="text-gray-900 dark:text-white">
      {{ walletStore.currentAddress }}
    </div>
    <div class="mt-4 mb-4">
      <button class="modern-button px-10 py-2">Go To Pay</button>
    </div>
  </div>
</template>
