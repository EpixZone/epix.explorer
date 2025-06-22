<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import { useRouter } from 'vue-router';
const props = defineProps(['chain']);
const vueRouters = useRouter();
const tab = ref('recent');

const base = useBaseStore()
const chainStore = useBlockchain()

const format = useFormatter();
const hashReg = /^[A-Z\d]{64}$/;
const hash = ref('');
const current = chainStore?.current?.chainName || '';
const isLoadingRecents = ref(false);

// Computed property for recent transactions with loading state
const recentTxs = computed(() => {
    if (tab.value === 'recent') {
        return base.txsInRecents;
    }
    return [];
});

// Watch for tab changes to manage loading state
watch(tab, (newTab) => {
    if (newTab === 'recent') {
        isLoadingRecents.value = true;
        // Use nextTick to allow UI to update before heavy computation
        setTimeout(() => {
            isLoadingRecents.value = false;
        }, 100);
    }
}, { immediate: true });

onMounted(() => {
    tab.value = String(vueRouters.currentRoute.value.query.tab || 'recent');
    console.log(tab.value);
});

function search() {
    if (hashReg.test(hash.value)) {
      vueRouters.push({ path: `/${current}/tx/${hash.value}` });
    }
}
</script>
<template>
    <div>
        <div class="tabs tabs-boxed bg-transparent mb-4">
            <a class="tab text-gray-400 uppercase" :class="{ 'tab-active': tab === 'recent' }"
                @click="tab = 'recent'">{{ $t('block.recent') }}</a>
            <a class="tab text-gray-400 uppercase" :class="{ 'tab-active': tab === 'search' }"
                @click="tab = 'search'">Search</a>
        </div>

        <div v-show="tab === 'recent'" class="modern-card shadow-modern overflow-x-auto">
            <!-- Loading indicator -->
            <div v-if="isLoadingRecents" class="flex items-center justify-center py-12">
                <div class="flex items-center space-x-3">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-epix-primary"></div>
                    <span class="text-gray-600 dark:text-gray-400">Loading recent transactions...</span>
                </div>
            </div>

            <!-- Transaction table -->
            <div v-else>
                <table class="table w-full">
                    <thead class="bg-gray-50 dark:bg-epix-gray-light">
                        <tr>
                            <th class="py-3 px-4 text-gray-900 dark:text-white font-semibold" style="position: relative; z-index: 2;">{{ $t('account.height') }}</th>
                            <th class="py-3 px-4 text-gray-900 dark:text-white font-semibold" style="position: relative; z-index: 2;">{{ $t('account.hash') }}</th>
                            <th class="py-3 px-4 text-gray-900 dark:text-white font-semibold">{{ $t('account.messages') }}</th>
                            <th class="py-3 px-4 text-gray-900 dark:text-white font-semibold">{{ $t('block.fees') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(item, index) in recentTxs" :key="`${item.height}-${item.hash}`" :index="index" class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
                            <td class="py-3 px-4 text-sm">
                                <RouterLink :to="`/${props.chain}/block/${item.height}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{ item.height }}</RouterLink>
                            </td>
                            <td class="py-3 px-4 truncate w-1/2">
                                <RouterLink :to="`/${props.chain}/tx/${item.hash}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{
                    item.hash
                }}</RouterLink>
                            </td>
                            <td class="py-3 px-4 text-gray-900 dark:text-white">{{ format.messages(item.tx.body.messages) }}</td>
                            <td class="py-3 px-4 text-gray-900 dark:text-white">{{ format.formatTokens(item.tx.authInfo.fee?.amount) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="p-6">
                <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div class="flex items-center gap-3 text-blue-700 dark:text-blue-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                            class="stroke-current flex-shrink-0 w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-sm font-medium">{{ $t('block.only_tx') }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div v-show="tab === 'search'" class="modern-card shadow-modern">
            <div class="p-6">
                <div class="space-y-4">
                    <div>
                        <label for="tx-hash-input" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Transaction Hash
                        </label>
                        <input
                            id="tx-hash-input"
                            v-model="hash"
                            type="text"
                            class="modern-input w-full px-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                            placeholder="Enter transaction hash (64 characters)"
                            @blur="search"
                            @keyup.enter="search"
                        />
                    </div>
                    <div class="flex justify-end">
                        <button
                            @click="search"
                            class="modern-button px-6 py-2 text-white font-medium"
                            :disabled="!hash || !hashReg.test(hash)"
                        >
                            Search Transaction
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<route>
    {
      meta: {
        i18n: 'tx',
        order: 5
      }
    }
  </route>
