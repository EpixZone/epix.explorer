<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useBlockchain, useBaseStore } from '@/stores';
import type { Endpoint } from '@/types/chaindata';
import { useRouter } from 'vue-router';

const chainStore = useBlockchain();
const baseStore = useBaseStore();
chainStore.initial();
const router = useRouter();

// Dropdown state (manual control instead of DaisyUI focus-based)
const dropdownOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value;
}

function closeDropdown() {
  dropdownOpen.value = false;
  showCustomForm.value = false;
  urlError.value = '';
  healthStatus.value = 'idle';
}

function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    closeDropdown();
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
});

// Custom endpoint form state
const showCustomForm = ref(false);
const customUrl = ref('');
const customLabel = ref('');
const urlError = ref('');
const isChecking = ref(false);
const healthStatus = ref<'idle' | 'success' | 'warning'>('idle');

function changeEndpoint(item: Endpoint) {
  chainStore.setRestEndpoint(item);
  closeDropdown();
  if (chainStore.current) router.push(`/${chainStore.current.chainName}`);
}

function validateUrl(url: string): boolean {
  urlError.value = '';
  if (!url.trim()) {
    urlError.value = 'URL is required';
    return false;
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      urlError.value = 'URL must start with http:// or https://';
      return false;
    }
  } catch {
    urlError.value = 'Invalid URL format';
    return false;
  }
  return true;
}

async function addCustomEndpoint() {
  if (!validateUrl(customUrl.value)) return;

  isChecking.value = true;
  healthStatus.value = 'idle';

  // Health check
  try {
    const normalized = customUrl.value.trim().replace(/\/+$/, '');
    const response = await fetch(
      `${normalized}/cosmos/base/tendermint/v1beta1/node_info`,
      { signal: AbortSignal.timeout(5000) }
    );
    healthStatus.value = response.ok ? 'success' : 'warning';
  } catch {
    healthStatus.value = 'warning';
  }

  const added = chainStore.addCustomEndpoint({
    address: customUrl.value.trim(),
    provider: customLabel.value.trim() || 'Custom',
  });

  isChecking.value = false;

  if (!added) {
    urlError.value = 'This endpoint already exists';
    return;
  }

  // Auto-select the new endpoint
  const newEndpoint: Endpoint = {
    address: customUrl.value.trim().replace(/\/+$/, ''),
    provider: customLabel.value.trim() || 'Custom',
  };
  chainStore.setRestEndpoint(newEndpoint);
  if (chainStore.current) router.push(`/${chainStore.current.chainName}`);

  // Reset form
  customUrl.value = '';
  customLabel.value = '';
  showCustomForm.value = false;
  healthStatus.value = 'idle';
}

function removeCustomEndpoint(address: string, event: Event) {
  event.stopPropagation();
  chainStore.removeCustomEndpoint(address);
}

function toggleCustomForm() {
  showCustomForm.value = !showCustomForm.value;
  urlError.value = '';
  healthStatus.value = 'idle';
}
</script>

<template>
  <div class="relative" ref="dropdownRef">
    <div class="flex items-center cursor-pointer" @click="toggleDropdown">
      <div class="p-1 relative mr-3">
        <img v-lazy="chainStore.logo" class="w-9 h-9 rounded-full" />
        <div
          class="w-2 h-2 rounded-full absolute right-0 bottom-0 shadow"
          :class="{
            'bg-success': baseStore.connected,
            'bg-error': !baseStore.connected,
          }"
        ></div>
      </div>
      <div class="flex-1 w-0">
        <div
          :key="baseStore.latest?.block?.header?.height || chainStore.chainName || ''"
          class="capitalize whitespace-nowrap text-base font-semibold text-gray-600 dark:text-gray-200 hidden md:!block"
        >
          {{
            baseStore.latest?.block?.header?.height
              ? `#${baseStore.latest.block.header.height}`
              : chainStore.chainName || ''
          }}
          <span class="text-error">{{ baseStore.connected ? '' : 'disconnected' }}</span>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap hidden md:!block">
          {{ chainStore.connErr || chainStore.endpoint.address }}
        </div>
      </div>
    </div>
    <div
      v-show="dropdownOpen"
      class="absolute -left-6 w-80 shadow-modern-lg modern-card rounded-xl overflow-auto mt-2 z-50"
      style="max-height: 70vh;"
    >
      <!-- Rest Endpoints -->
      <div
        class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-700"
        v-if="chainStore.current?.endpoints?.rest"
      >
        Rest Endpoint
      </div>
      <div
        v-for="(item, index) in chainStore.current?.endpoints?.rest"
        class="px-4 py-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors duration-200"
        :key="'config-' + index"
        @click="changeEndpoint(item)"
      >
        <div class="flex flex-col">
          <div class="flex items-center justify-between w-full">
            <div class="text-gray-700 dark:text-gray-200 capitalize font-medium">
              {{ item.provider }}
            </div>
            <span
              v-if="item.address === chainStore.endpoint?.address"
              class="bg-epix-primary inline-block h-3 w-3 rounded-full"
            />
          </div>
          <div class="text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap mt-1">
            {{ item.address }}
          </div>
        </div>
      </div>

      <!-- Custom Endpoints -->
      <div
        v-if="chainStore.customEndpoints[chainStore.chainName]?.length"
        class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-semibold border-t border-gray-200 dark:border-gray-700"
      >
        Custom Endpoints
      </div>
      <div
        v-for="(item, index) in chainStore.customEndpoints[chainStore.chainName]"
        class="px-4 py-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors duration-200"
        :key="'custom-' + index"
        @click="changeEndpoint(item)"
      >
        <div class="flex flex-col">
          <div class="flex items-center justify-between w-full">
            <div class="text-gray-700 dark:text-gray-200 capitalize font-medium flex items-center">
              <Icon icon="mdi:account-cog" class="text-epix-primary mr-1.5 text-sm" />
              {{ item.provider }}
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="item.address === chainStore.endpoint?.address"
                class="bg-epix-primary inline-block h-3 w-3 rounded-full"
              />
              <button
                @click="removeCustomEndpoint(item.address, $event)"
                class="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors duration-200"
                title="Remove custom endpoint"
              >
                <Icon icon="mdi:close" class="text-sm text-red-500" />
              </button>
            </div>
          </div>
          <div class="text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap mt-1">
            {{ item.address }}
          </div>
        </div>
      </div>

      <!-- Add Custom Endpoint -->
      <div class="border-t border-gray-200 dark:border-gray-700">
        <div
          class="px-4 py-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors duration-200 flex items-center"
          @click="toggleCustomForm"
        >
          <div class="flex items-center text-sm text-epix-primary font-medium">
            <Icon :icon="showCustomForm ? 'mdi:chevron-up' : 'mdi:plus-circle-outline'" class="mr-2" />
            {{ showCustomForm ? 'Cancel' : 'Add Custom Endpoint' }}
          </div>
        </div>

        <div v-if="showCustomForm" class="px-4 pb-4">
          <div class="mb-2">
            <input
              v-model="customUrl"
              type="text"
              placeholder="https://your-api-endpoint.com"
              class="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-epix-primary focus:outline-none focus:ring-1 focus:ring-epix-primary/50"
              @keydown.enter="addCustomEndpoint"
            />
          </div>
          <div class="mb-2">
            <input
              v-model="customLabel"
              type="text"
              placeholder="Label (optional, e.g. My Node)"
              class="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:border-epix-primary focus:outline-none focus:ring-1 focus:ring-epix-primary/50"
              @keydown.enter="addCustomEndpoint"
            />
          </div>

          <div v-if="urlError" class="mb-2 text-xs text-red-500 flex items-center">
            <Icon icon="mdi:alert-circle" class="mr-1" />
            {{ urlError }}
          </div>
          <div v-if="healthStatus === 'success'" class="mb-2 text-xs text-green-500 flex items-center">
            <Icon icon="mdi:check-circle" class="mr-1" />
            Endpoint responded successfully
          </div>
          <div v-if="healthStatus === 'warning'" class="mb-2 text-xs text-yellow-500 flex items-center">
            <Icon icon="mdi:alert" class="mr-1" />
            Endpoint did not respond, but was added anyway
          </div>

          <button
            @click="addCustomEndpoint"
            :disabled="isChecking || !customUrl.trim()"
            class="w-full px-3 py-2 text-xs font-medium rounded-lg text-white transition-all duration-200"
            :class="{
              'bg-epix-primary hover:bg-epix-secondary': !isChecking && customUrl.trim(),
              'bg-gray-400 cursor-not-allowed': isChecking || !customUrl.trim(),
            }"
          >
            <Icon v-if="isChecking" icon="mdi:loading" class="inline mr-1 animate-spin" />
            {{ isChecking ? 'Checking...' : 'Add Endpoint' }}
          </button>
        </div>
      </div>

      <!-- Information -->
      <div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-semibold border-t border-gray-200 dark:border-gray-700">Information</div>
      <div class="w-full pb-2">
        <div class="py-2 px-4 text-sm text-gray-700 dark:text-gray-300">
          <span class="font-medium">Chain Id:</span> {{ baseStore.latest?.block?.header?.chain_id && baseStore.connected
                        ? baseStore.latest.block.header.chain_id
                        : 'N/A' }}
        </div>
        <div class="py-2 px-4 text-sm text-gray-700 dark:text-gray-300">
          <span class="font-medium">Height:</span> {{ baseStore.latest?.block?.header?.height && baseStore.connected
                      ? baseStore.latest?.block?.header?.height
                      : '0' }}
        </div>
      </div>
      <div class="px-4 py-2">&nbsp;</div>
    </div>
  </div>
</template>
