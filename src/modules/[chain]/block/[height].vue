<script lang="ts" setup>
import { computed, onMounted, ref, watchEffect } from 'vue';
import { Icon } from '@iconify/vue';
import TxsElement from '@/components/dynamic/TxsElement.vue';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import { onBeforeRouteUpdate } from 'vue-router';
import { useBaseStore, useFormatter } from '@/stores';
import type { Block } from '@/types';
import Countdown from '@/components/Countdown.vue';

const props = defineProps(['height', 'chain']);

const store = useBaseStore();
const format = useFormatter()
const current = ref({} as Block)
const target = ref(Number(props.height || 0))

const height = computed(() => {
  return Number(current.value.block?.header?.height || props.height || 0);
});

const isFutureBlock = computed({
  get: () => {
    const latest = store.latest?.block?.header.height
    const isFuture = latest ? target.value > Number(latest) : true
    if (!isFuture && !current.value.block_id) store.fetchBlock(target.value).then(x => current.value = x)
    return isFuture
  },
  set: val => {
    console.log(val)
  }
})

const remainingBlocks = computed(() => {
  const latest = store.latest?.block?.header.height
  return latest ? Number(target.value) - Number(latest) : 0
})

const estimateTime = computed(() => {
  const seconds = Number((remainingBlocks.value * store.blocktime).toFixed(2))
  return seconds
})

const estimateDate = computed(() => {
  return new Date(new Date().getTime() + estimateTime.value)
})

const edit = ref(false)
const newHeight = ref(props.height)
function updateTarget() {
  target.value = Number(newHeight.value)
  console.log(target.value)
}

onBeforeRouteUpdate(async (to, from, next) => {
  if (from.path !== to.path) {
    store.fetchBlock(String(to.params.height)).then(x => current.value = x);
    next();
  }
});
</script>
<template>
  <div>
    <div v-if="isFutureBlock" class="text-center">
      <div v-if="remainingBlocks > 0">
        <div class="text-primary font-bold text-lg my-10">#{{ target }}</div>
        <Countdown :time="estimateTime" css="md:!text-5xl font-sans md:mx-5" />
        <div class="my-5">{{ $t('block.estimated_time') }}: <span class="text-xl font-bold">{{ format.toLocaleDate(estimateDate) }}</span>
        </div>
        <div class="pt-10 flex justify-center">
          <table class="w-max rounded-lg modern-card shadow-modern">
            <thead>
              <tr>
                <th class="text-left py-2 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Property</th>
                <th class="text-right py-2 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr class="hover:bg-gray-50 dark:hover:bg-epix-gray-light cursor-pointer transition-colors duration-200" @click="edit = !edit">
                <td class="py-2 px-4 text-gray-900 dark:text-white">{{ $t('block.countdown_for_block') }}:</td>
                <td class="text-right py-2 px-4 text-gray-900 dark:text-white"><span class="md:!ml-40">{{ target }}</span></td>
              </tr>
              <tr v-if="edit">
                <td colspan="2" class="text-center py-4 px-4">
                  <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ $t('block.countdown_for_block_input') }}</h3>
                  <p class="py-4">
                  <div class="flex gap-2 justify-center">
                    <input class="modern-input px-3 py-2" v-model="newHeight" type="number" />
                    <button class="modern-button px-4 py-2" @click="updateTarget()">{{ $t('block.btn_update') }}</button>
                  </div>
                  </p>
                </td>
              </tr>
              <tr class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
                <td class="py-2 px-4 text-gray-900 dark:text-white">{{ $t('block.current_height') }}:</td>
                <td class="text-right py-2 px-4 text-gray-900 dark:text-white">#{{ store.latest?.block?.header.height }}</td>
              </tr>
              <tr class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
                <td class="py-2 px-4 text-gray-900 dark:text-white">{{ $t('block.remaining_blocks') }}:</td>
                <td class="text-right py-2 px-4 text-gray-900 dark:text-white">{{ remainingBlocks }}</td>
              </tr>
              <tr class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
                <td class="py-2 px-4 text-gray-900 dark:text-white">{{ $t('block.average_block_time') }}:</td>
                <td class="text-right py-2 px-4 text-gray-900 dark:text-white">{{ (store.blocktime / 1000).toFixed(1) }}s</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
    <div v-else>
      <div class="modern-card px-4 pt-3 pb-4 mb-4 shadow-modern">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white flex flex-row justify-between">
          <p class="">#{{ current.block?.header?.height }}</p>
          <div class="flex" v-if="props.height">
            <RouterLink :to="`/${store.blockchain.chainName}/block/${height - 1}`"
              class="modern-button p-2 text-xl mr-2">
              <Icon icon="mdi-arrow-left" class="w-6 h-6" />
            </RouterLink>
            <RouterLink :to="`/${store.blockchain.chainName}/block/${height + 1}`"
              class="modern-button p-2 text-xl">
              <Icon icon="mdi-arrow-right" class="w-6 h-6" />
            </RouterLink>
          </div>
        </h2>
        <div>
          <DynamicComponent :value="current.block_id" />
        </div>
      </div>

      <div class="modern-card px-4 pt-3 pb-4 mb-4 shadow-modern">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white flex flex-row justify-between">{{ $t('block.block_header') }}</h2>
        <DynamicComponent :value="current.block?.header" />
      </div>

      <div class="modern-card px-4 pt-3 pb-4 mb-4 shadow-modern">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white flex flex-row justify-between">{{ $t('account.transactions') }}</h2>
        <TxsElement :value="current.block?.data?.txs" />
      </div>

      <div class="modern-card px-4 pt-3 pb-4 shadow-modern">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white flex flex-row justify-between">{{ $t('block.last_commit') }}</h2>
        <DynamicComponent :value="current.block?.last_commit" />
      </div>
  </div>
</div></template>
