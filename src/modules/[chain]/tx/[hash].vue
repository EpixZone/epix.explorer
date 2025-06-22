<script lang="ts" setup>
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import { computed, ref } from 'vue';
import type { Tx, TxResponse } from '@/types';

import { JsonViewer } from "vue3-json-viewer"
// if you used v1.0.5 or latster ,you should add import "vue3-json-viewer/dist/index.css"
import "vue3-json-viewer/dist/index.css";

const props = defineProps(['hash', 'chain']);

const blockchain = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();
const tx = ref(
    {} as {
        tx: Tx;
        tx_response: TxResponse;
    }
);
const loading = ref(true);
const error = ref('');

async function fetchTransaction() {
    if (!props.hash) {
        error.value = 'No transaction hash provided';
        loading.value = false;
        return;
    }

    // Wait for RPC client to be initialized
    if (!blockchain.rpc) {
        try {
            await blockchain.randomSetupEndpoint();
        } catch (err) {
            console.error('Failed to setup endpoint:', err);
            error.value = 'Failed to setup blockchain endpoint';
            loading.value = false;
            return;
        }
    }

    if (!blockchain.rpc) {
        error.value = 'Failed to initialize blockchain RPC client';
        loading.value = false;
        return;
    }

    try {
        const response = await blockchain.rpc.getTx(props.hash);
        tx.value = response;
        loading.value = false;
    } catch (err: any) {
        console.error('Error fetching transaction:', err);
        error.value = err.message || 'Failed to load transaction';
        loading.value = false;
    }
}

if (props.hash) {
    fetchTransaction();

    // Add a timeout to prevent infinite loading
    setTimeout(() => {
        if (loading.value) {
            console.error('Transaction loading timeout');
            error.value = 'Transaction loading timeout. Please try again.';
            loading.value = false;
        }
    }, 30000); // 30 second timeout
}
const messages = computed(() => {
    return tx.value.tx?.body?.messages.map(x=> {
        if(x.packet?.data) {
            // @ts-ignore
            x.message = format.base64ToString(x.packet.data)
        }
        return x
    }) || [];
});
</script>
<template>
    <div>
        <div class="modern-card shadow-modern p-1 mb-6 flex space-x-1">
            <RouterLink class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
                :to="`/${chain}/tx/?tab=recent`">
                {{ $t('block.recent') }}
            </RouterLink>
            <RouterLink class="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
                :to="`/${chain}/tx/?tab=search`">
                Search
            </RouterLink>
            <div class="px-4 py-2 rounded-lg text-sm font-medium bg-epix-primary text-white">
                Transaction
            </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="modern-card shadow-modern p-8 text-center">
            <div class="flex items-center justify-center space-x-3">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-epix-primary"></div>
                <span class="text-gray-600 dark:text-gray-400">Loading transaction...</span>
            </div>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="modern-card shadow-modern p-8 text-center">
            <div class="text-red-500 mb-4">
                <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Transaction Not Found</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4">{{ error }}</p>
                <p class="text-sm text-gray-500 dark:text-gray-500">
                    Please verify the transaction hash and try again.
                </p>
            </div>
        </div>

        <div v-else-if="tx.tx_response" class="modern-card shadow-modern p-6 mb-6">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-6">{{ $t('tx.title') }}</h2>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('tx.tx_hash') }}</label>
                        <div class="modern-input px-4 py-3 font-mono text-sm break-all">{{ tx.tx_response.txhash }}</div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('account.height') }}</label>
                        <RouterLink :to="`/${props.chain}/block/${tx.tx_response.height}`"
                                    class="modern-input px-4 py-3 block text-epix-teal hover:text-epix-primary transition-colors duration-200">
                            {{ tx.tx_response.height }}
                        </RouterLink>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('staking.status') }}</label>
                        <div class="flex items-center space-x-3">
                            <span class="px-3 py-1 rounded-lg text-sm font-medium"
                                  :class="tx.tx_response.code === 0 ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'">
                                {{ tx.tx_response.code === 0 ? 'Success' : 'Failed' }}
                            </span>
                            <span v-if="tx.tx_response.code !== 0" class="text-sm text-red-600 dark:text-red-400">
                                {{ tx?.tx_response?.raw_log }}
                            </span>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('account.time') }}</label>
                        <div class="modern-input px-4 py-3">
                            {{ format.toLocaleDate(tx.tx_response.timestamp) }}
                            <span class="text-gray-500 dark:text-gray-400">({{ format.toDay(tx.tx_response.timestamp, 'from') }})</span>
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('tx.gas') }}</label>
                        <div class="modern-input px-4 py-3">
                            <span class="font-mono">{{ tx.tx_response.gas_used }}</span> /
                            <span class="font-mono">{{ tx.tx_response.gas_wanted }}</span>
                            <div class="mt-2 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div class="bg-epix-primary rounded-full h-2 transition-all duration-300"
                                     :style="`width: ${Math.min((parseInt(tx.tx_response.gas_used) / parseInt(tx.tx_response.gas_wanted)) * 100, 100)}%`"></div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('tx.fee') }}</label>
                        <div class="modern-input px-4 py-3 font-mono">
                            {{ format.formatTokens(tx.tx?.auth_info?.fee?.amount, true, '0,0.[00]') }}
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('tx.memo') }}</label>
                        <div class="modern-input px-4 py-3 min-h-[3rem]" :class="tx.tx.body.memo ? '' : 'text-gray-500 dark:text-gray-400 italic'">
                            {{ tx.tx.body.memo || 'No memo' }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="tx.tx_response" class="modern-card shadow-modern p-6 mb-6">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-6">
                {{ $t('account.messages') }} <span class="text-sm font-normal text-gray-500 dark:text-gray-400">({{ messages.length }})</span>
            </h2>
            <div v-if="messages.length > 0" class="space-y-4">
                <div v-for="(msg, i) in messages" :key="i" class="modern-card border border-gray-200 dark:border-gray-700 p-4">
                    <DynamicComponent :value="msg" />
                </div>
            </div>
            <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
                <svg class="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m13-8l-4 4m0 0l-4-4m4 4V3"></path>
                </svg>
                {{ $t('tx.no_messages') }}
            </div>
        </div>

        <div v-if="tx.tx_response" class="modern-card shadow-modern p-6">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-6">Raw Transaction Data</h2>
            <div class="modern-input p-4 overflow-auto max-h-96">
                <JsonViewer :value="tx" :theme="baseStore.theme" style="background: transparent;" copyable boxed sort expand-depth="3"/>
            </div>
        </div>
    </div>
</template>
