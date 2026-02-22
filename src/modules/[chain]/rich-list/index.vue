<script lang="ts" setup>
import { useBlockchain, useFormatter } from '@/stores';
import type { TopHolder, TopHoldersResponse, PageRequest } from '@/types';
import { onMounted, ref, computed } from 'vue';
import PaginationBar from '@/components/PaginationBar.vue';
import { Icon } from '@iconify/vue';

const blockchain = useBlockchain();
const formatter = useFormatter();

// Known special addresses (e.g. IBC escrow accounts, module accounts)
const knownAddresses: Record<string, { label: string; link: string }> = {
  'epix1a53udazy8ayufvy0s434pfwjcedzqv34r8vsv4': {
    label: 'IBC Escrow (Osmosis)',
    link: '/epix/ibc/connection/connection-1',
  },
};

// State
const holders = ref<TopHolder[]>([]);
const loading = ref(true);
const error = ref('');
const pageRequest = ref({
  limit: 50,
  offset: 0,
  count_total: true
} as any);
const totalCount = ref(0);
const lastUpdated = ref(0);
const blockHeight = ref(0);

// Computed
const totalPages = computed(() => Math.ceil(1000 / pageRequest.value.limit)); // Limit to top 1000
const currentPage = computed(() => Math.floor(pageRequest.value.offset / pageRequest.value.limit) + 1);

// Methods
async function fetchTopHolders() {
  try {
    loading.value = true;
    error.value = '';

    const queryParams = new URLSearchParams({
      'pagination.limit': pageRequest.value.limit.toString(),
      'pagination.offset': pageRequest.value.offset.toString(),
      'pagination.count_total': pageRequest.value.count_total.toString()
    });

    const data = await blockchain.rpc.getTopHolders(`?${queryParams}`);

    holders.value = data.holders || [];
    totalCount.value = data.total_count || 0;
    lastUpdated.value = data.last_updated || 0;
    blockHeight.value = data.block_height || 0;

  } catch (err: any) {
    console.error('Error fetching top holders:', err);
    error.value = 'Failed to load top holders data. Please try again.';
  } finally {
    loading.value = false;
  }
}

function handlePageChange(page: number) {
  pageRequest.value.offset = (page - 1) * pageRequest.value.limit;
  fetchTopHolders();
}

function formatBalance(balance: string, denom: string = 'aepix') {
  return formatter.formatToken({ amount: balance, denom });
}

function formatAddress(address: string) {
  return address; // Show full address
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

// Lifecycle
onMounted(() => {
  fetchTopHolders();
});
</script>

<template>
  <div>
    <!-- Header -->
    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
          {{ $t('rich_list.title', 'Rich List') }}
        </h2>
        <div class="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
          <div v-if="blockHeight" class="flex items-center">
            <Icon icon="mdi:cube" class="w-4 h-4 mr-1" />
            Block: {{ blockHeight.toLocaleString() }}
          </div>
          <div v-if="lastUpdated" class="flex items-center">
            <Icon icon="mdi:clock" class="w-4 h-4 mr-1" />
            Updated: {{ formatTimestamp(lastUpdated) }}
          </div>
        </div>
      </div>
      <p class="text-sm text-gray-700 dark:text-gray-300">
        {{ $t('rich_list.description', 'Top token holders ranked by total balance (liquid + bonded + unbonding)') }}
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="modern-card shadow-modern px-6 py-8 text-center">
      <Icon icon="mdi:loading" class="w-8 h-8 animate-spin mx-auto mb-4 text-epix-teal" />
      <p class="text-gray-600 dark:text-gray-400">Loading top holders...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="modern-card shadow-modern px-6 py-8 text-center">
      <Icon icon="mdi:alert-circle" class="w-8 h-8 mx-auto mb-4 text-red-500" />
      <p class="text-red-600 dark:text-red-400 mb-4">{{ error }}</p>
      <button 
        @click="fetchTopHolders" 
        class="modern-button px-4 py-2 rounded-lg"
      >
        Try Again
      </button>
    </div>

    <!-- Data Table -->
    <div v-else class="modern-card shadow-modern overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Rank
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Address
              </th>
              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Total Balance
              </th>
              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Liquid Balance
              </th>
              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Bonded Balance
              </th>
              <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Undelegating Balance
              </th>
            </tr>
          </thead>
          <tbody class="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-for="holder in holders" :key="holder.address" class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">
                    #{{ holder.rank }}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div>
                  <RouterLink
                    :to="`/${blockchain.chainName}/account/${holder.address}`"
                    class="text-sm font-mono text-epix-teal hover:text-epix-accent transition-colors duration-200 hover:underline break-all"
                  >
                    {{ formatAddress(holder.address) }}
                  </RouterLink>
                  <div v-if="knownAddresses[holder.address]" class="mt-1">
                    <RouterLink
                      :to="knownAddresses[holder.address].link"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 whitespace-nowrap hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors duration-200">
                      <Icon icon="mdi:link-variant" class="w-3 h-3" />
                      {{ knownAddresses[holder.address].label }}
                    </RouterLink>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-right">
                <div class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ formatBalance(holder.total_balance) }}
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-right">
                <div class="text-sm text-gray-900 dark:text-white">
                  {{ formatBalance(holder.liquid_balance) }}
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-right">
                <div class="text-sm text-gray-900 dark:text-white">
                  {{ formatBalance(holder.bonded_balance) }}
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-right">
                <div class="text-sm text-gray-900 dark:text-white">
                  {{ formatBalance(holder.unbonding_balance) }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <div class="text-sm text-gray-700 dark:text-gray-300">
            Showing {{ pageRequest.offset + 1 }} to {{ Math.min(pageRequest.offset + pageRequest.limit, 1000) }} of top 1000 holders
          </div>
          <PaginationBar
            :total="Math.min(totalCount, 1000).toString()"
            :limit="pageRequest.limit"
            :current-page="currentPage"
            :callback="handlePageChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<route>
{
  meta: {
    i18n: 'rich-list',
    order: 99
  }
}
</route>
