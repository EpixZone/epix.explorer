<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import { onMounted, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';

import { useBlockchain } from '@/stores';
const vueRouters = useRouter();
const blockStore = useBlockchain();
let searchModalShow = ref(false);
let searchQuery = ref('');
let errorMessage = ref('');
let isSearching = ref(false);
const searchInput = ref<HTMLInputElement>();

onMounted(() => {});

function closeSearchModal() {
  searchModalShow.value = false;
  searchQuery.value = '';
  errorMessage.value = '';
  isSearching.value = false;
}

function openSearchModal() {
  searchModalShow.value = true;
  nextTick(() => {
    searchInput.value?.focus();
  });
}

function preventClick(event: any) {
  event.preventDefault();
  event.stopPropagation();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeSearchModal();
  } else if (event.key === 'Enter') {
    confirm();
  }
}

function confirm() {
  errorMessage.value = '';
  isSearching.value = true;
  const key = searchQuery.value.trim();

  if (!key) {
    errorMessage.value = 'Please enter a value!';
    isSearching.value = false;
    return;
  }

  const height = /^\d+$/;
  const txhash = /^[A-Z\d]{64}$/;
  const addr = /^[a-z\d]+1[a-z\d]{38,58}$/;

  const current = blockStore?.current?.chainName || '';

  // Check if input matches any of the patterns and navigate
  if (height.test(key)) {
    vueRouters.push({ path: `/${current}/block/${key}` });
    // Always close modal after navigation attempt
    setTimeout(() => {
      closeSearchModal();
    }, 200);
  } else if (txhash.test(key)) {
    vueRouters.push({ path: `/${current}/tx/${key}` });
    // Always close modal after navigation attempt
    setTimeout(() => {
      closeSearchModal();
    }, 200);
  } else if (addr.test(key)) {
    vueRouters.push({ path: `/${current}/account/${key}` });
    // Always close modal after navigation attempt
    setTimeout(() => {
      closeSearchModal();
    }, 200);
  } else {
    errorMessage.value = 'Input not recognized. Please enter a valid block height, transaction hash, or account address.';
    isSearching.value = false;
  }
}
</script>
<template>
  <div>
    <button
      class="p-2 rounded-xl hover:bg-epix-gray dark:hover:bg-epix-gray-light transition-all duration-200"
      @click="openSearchModal"
      title="Search blocks, transactions, and accounts"
    >
      <Icon
        icon="mdi:magnify"
        class="text-xl text-gray-600 dark:text-gray-400 hover:text-epix-primary transition-colors duration-200"
      />
    </button>

    <!-- Enhanced modal with better backdrop and animations -->
    <Transition name="modal" appear>
      <div
        v-if="searchModalShow"
        class="fixed inset-0 z-50 flex items-center justify-center cursor-pointer modal-backdrop"
        @click="closeSearchModal"
        @keydown="handleKeydown"
        tabindex="-1"
      >
        <div
          class="relative search-modal-card max-w-lg w-full mx-4 cursor-default"
          @click="(event) => preventClick(event)"
        >
          <!-- Enhanced header with better styling -->
          <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div class="flex flex-col">
              <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-1">
                <Icon icon="mdi:magnify" class="inline mr-2 text-epix-primary" />
                Search Blockchain
              </h2>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Enter block height, transaction hash, or account address
              </p>
            </div>
            <button
              class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors duration-200 group"
              @click="closeSearchModal"
              title="Close search (Esc)"
            >
              <Icon
                icon="mdi:close"
                class="text-xl text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200"
              />
            </button>
          </div>

          <!-- Enhanced body with better input styling -->
          <div class="p-6">
            <div class="relative">
              <input
                ref="searchInput"
                class="search-input w-full px-4 py-3 text-base"
                v-model="searchQuery"
                placeholder="e.g., 12345, ABC123..., epix1abc..."
                @keydown="handleKeydown"
                :disabled="isSearching"
              />
              <div class="absolute right-3 top-1/2 transform -translate-y-1/2">
                <Icon
                  v-if="isSearching"
                  icon="mdi:loading"
                  class="text-lg text-epix-primary animate-spin"
                />
                <Icon
                  v-else
                  icon="mdi:magnify"
                  class="text-lg text-gray-400"
                />
              </div>
            </div>

            <!-- Enhanced error message -->
            <Transition name="error">
              <div
                v-if="errorMessage"
                class="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
              >
                <div class="flex items-center">
                  <Icon icon="mdi:alert-circle" class="text-red-500 mr-2" />
                  <span class="text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</span>
                </div>
              </div>
            </Transition>

            <!-- Search hints -->
            <div class="mt-4 text-xs text-gray-500 dark:text-gray-400">
              <div class="flex flex-wrap gap-4">
                <span><strong>Block:</strong> Numbers only (e.g., 12345)</span>
                <span><strong>Transaction:</strong> 64-character hash</span>
                <span><strong>Account:</strong> Bech32 address</span>
              </div>
            </div>
          </div>

          <!-- Enhanced footer with better button styling -->
          <div class="p-6 pt-0 flex gap-3">
            <button
              class="search-button flex-1 px-6 py-3 font-medium"
              @click="confirm"
              :disabled="isSearching || !searchQuery.trim()"
            >
              <Icon
                v-if="isSearching"
                icon="mdi:loading"
                class="inline mr-2 animate-spin"
              />
              <Icon
                v-else
                icon="mdi:magnify"
                class="inline mr-2"
              />
              {{ isSearching ? 'Searching...' : 'Search' }}
            </button>
            <button
              class="cancel-button px-6 py-3 font-medium"
              @click="closeSearchModal"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Modal backdrop with proper blur */
.modal-backdrop {
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Enhanced search modal styling */
.search-modal-card {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.dark .modal-backdrop {
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.dark .search-modal-card {
  background: rgba(10, 10, 10, 0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}

.search-input {
  background: rgba(255, 255, 255, 0.8);
  border: 2px solid rgba(138, 75, 219, 0.2);
  border-radius: 12px;
  transition: all 0.3s ease;
  color: #1a1a1a;
}

.search-input:focus {
  border-color: #8A4BDB;
  box-shadow: 0 0 0 4px rgba(138, 75, 219, 0.1);
  outline: none;
  background: rgba(255, 255, 255, 0.95);
}

.search-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .search-input {
  background: rgba(26, 26, 26, 0.9);
  border: 2px solid rgba(138, 75, 219, 0.3);
  color: #ffffff;
}

.dark .search-input:focus {
  border-color: #8A4BDB;
  box-shadow: 0 0 0 4px rgba(138, 75, 219, 0.2);
  background: rgba(26, 26, 26, 0.95);
}

.search-button {
  background: linear-gradient(135deg, #8A4BDB, #5954CD);
  border: none;
  border-radius: 8px;
  color: white;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(138, 75, 219, 0.3);
}

.search-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(138, 75, 219, 0.4);
}

.search-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 6px rgba(138, 75, 219, 0.2);
}

.cancel-button {
  background: rgba(107, 114, 128, 0.1);
  border: 1px solid rgba(107, 114, 128, 0.3);
  border-radius: 8px;
  color: #6B7280;
  transition: all 0.3s ease;
}

.cancel-button:hover {
  background: rgba(107, 114, 128, 0.2);
  color: #4B5563;
}

.dark .cancel-button {
  color: #9CA3AF;
  border-color: rgba(156, 163, 175, 0.3);
}

.dark .cancel-button:hover {
  background: rgba(156, 163, 175, 0.1);
  color: #D1D5DB;
}

/* Modal animations */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .search-modal-card,
.modal-leave-to .search-modal-card {
  transform: scale(0.9) translateY(-20px);
  opacity: 0;
}

/* Error message animations */
.error-enter-active,
.error-leave-active {
  transition: all 0.3s ease;
}

.error-enter-from,
.error-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
