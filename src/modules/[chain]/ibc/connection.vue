<script lang="ts" setup>
import PaginationBar from '@/components/PaginationBar.vue';
import { useBlockchain, useFormatter } from '@/stores';
import { PageRequest, type Connection, type Pagination } from '@/types';
import { computed, onMounted } from 'vue';
import { ref } from 'vue';

import ChainRegistryClient from '@ping-pub/chain-registry-client';
import type { IBCPath } from '@ping-pub/chain-registry-client/dist/types';
import router from '@/router';
import { useIBCModule } from './connStore';

const props = defineProps(['chain']);
const chainStore = useBlockchain();
const ibcStore = useIBCModule()
const list = ref([] as Connection[]);
const pageRequest = ref(new PageRequest())
const pageResponse = ref({} as Pagination)
const tab = ref('registry');

onMounted(() => {
  pageload(1)
  ibcStore.load()
});

function pageload(p: number) {
  pageRequest.value.setPage(p)
  chainStore.rpc.getIBCConnections(pageRequest.value).then((x) => {
    list.value = x.connections;
    pageResponse.value = x.pagination
    if(x.pagination.total && Number(x.pagination.total) > 0) {
      ibcStore.showConnection(0)
    }
  });
}

</script>
<template>
  <div>
    <div class="modern-card shadow-modern px-6 pt-4 pb-5">
      <div class="flex flex-wrap gap-4 items-center">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white py-4">{{ $t('ibc.title') }}</h2>
        <div class="tabs tabs-boxed bg-gray-100 dark:bg-gray-800">
          <a class="tab text-gray-600 dark:text-gray-400" :class="{ 'tab-active bg-epix-primary text-white': tab === 'registry' }" @click="tab = 'registry'">{{ $t('ibc.registry') }}</a>
          <a class="tab text-gray-600 dark:text-gray-400" :class="{ 'tab-active bg-epix-primary text-white': tab === 'favorite' }" @click="tab = 'favorite'">{{ $t('module.favorite') }}</a>
        </div>
      </div>
      <div>
        <div v-show="tab === 'registry'" class="flex flex-wrap gap-2 p-4">
          <span v-for="s in ibcStore.commonIBCs" class="modern-button-secondary text-xs px-3 py-1 mr-1 cursor-pointer" @click="ibcStore.fetchConnection(s.path)">{{ s.from }}
            &#x21cc; {{ s.to }}</span>
        </div>
        <div v-show="tab === 'favorite'" class="flex flex-wrap gap-2 p-4">
          <div class="flex items-center bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <span class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 font-medium">{{ $t('ibc.connection_id') }}:</span>
            <input v-model="ibcStore.connectionId" type="number" class="modern-input w-40 border-0 bg-transparent" min="0"
              :max="pageResponse.total || 0" :placeholder="`0~${pageResponse.total}`" />
            <button class="modern-button px-4 py-2 m-2" @click="ibcStore.showConnection()">{{ $t('ibc.btn_apply') }}</button>
          </div>
        </div>
      </div>
      <div class="overflow-auto mt-5">
        <router-view :key="$route.fullPath"></router-view>
      </div>
    </div>
  </div>
</template>
