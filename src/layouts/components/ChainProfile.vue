<script setup lang="ts">
import { useBlockchain, useBaseStore, type Endpoint } from '@/stores';
import { useRouter } from 'vue-router';
const chainStore = useBlockchain();
const baseStore = useBaseStore();
chainStore.initial();
const router = useRouter();
function changeEndpoint(item: Endpoint) {
  chainStore.setRestEndpoint(item);
  if (chainStore.current) router.push(`/${chainStore.current.chainName}`);
}
</script>

<template>
  <div class="dropdown">
    <label tabindex="0" class="flex items-center">
      <div class="p-1 relative mr-3 cursor-pointer">
        <img v-lazy="chainStore.logo" class="w-9 h-9 rounded-full" />
        <div
          class="w-2 h-2 rounded-full absolute right-0 bottom-0 shadow" :class="{
            'bg-success': baseStore.connected,
            'bg-error': !baseStore.connected
          }"
        ></div>
      </div>
      <div class="flex-1 w-0">
        <div
          :key="
            baseStore.latest?.block?.header?.height ||
            chainStore.chainName ||
            ''
          "
          class="capitalize whitespace-nowrap text-base font-semibold text-gray-600 dark:text-gray-200 hidden md:!block"
        >
          {{ 
            baseStore.latest?.block?.header?.height
              ? `#${baseStore.latest.block.header.height}`
              : chainStore.chainName  || '' 
          }} <span class="text-error">{{ baseStore.connected ? '' : 'disconnected' }}</span>
        </div>
        <div
          class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap hidden md:!block"
        >
          {{ chainStore.connErr || chainStore.endpoint.address }}
        </div>
      </div>
    </label>
    <div
      tabindex="0"
      class="dropdown-content -left-6 w-80 menu shadow-modern-lg modern-card rounded-xl overflow-auto mt-2"
    >
      <!-- rest -->
      <div
        class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-700"
        v-if="chainStore.current?.endpoints?.rest"
      >
        Rest Endpoint
      </div>
      <div
        v-for="(item, index) in chainStore.current?.endpoints?.rest"
        class="px-4 py-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors duration-200"
        :key="index"
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

      <!-- rest -->
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
      <!-- bottom-->
      <div class="px-4 py-2">&nbsp;</div>
    </div>
  </div>
</template>
