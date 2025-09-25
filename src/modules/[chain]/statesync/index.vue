<script lang="ts" setup>
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import type { NodeInfo } from '@/types';
import { fromBase64, toHex } from '@cosmjs/encoding';
import { onMounted, ref } from 'vue';
import { computed } from 'vue';

const props = defineProps(['hash', 'chain']);
const blockchain = useBlockchain();
const base = useBaseStore();
const nodeInfo = ref({} as NodeInfo);

const height = ref(0)
const hash = ref("")

base.$subscribe((m, { latest }) => {
  let h = Number(latest.block?.header?.height)
  h = Math.round((h - 2000) / 1000) * 1000
  if (h > height.value) {
    height.value = h
    base.fetchBlock(h).then(res => {
      hash.value = toHex(fromBase64(res.block_id.hash)).toUpperCase()
    })
  }
})

const rpcs = computed(() => {
  return blockchain.current?.endpoints?.rpc
    ?.map((x) => x.address)
    .join(',');
});

const appName = computed(() => {
  return nodeInfo.value.application_version?.app_name || 'gaiad';
});

onMounted(() => {
  blockchain.rpc.getBaseNodeInfo().then((x) => {
    nodeInfo.value = x;
  });
});
</script>
<template>
  <div>
    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white truncate mb-3">{{ $t('statesync.title') }}</h2>
      <div class="text-sm text-gray-700 dark:text-gray-300">
        {{ $t('statesync.description') }}
        <a class="text-epix-teal hover:text-epix-accent transition-colors duration-200 lowercase" href="https://blog.cosmos.network/cosmos-sdk-state-sync-guide-99e4cf43be2f">{{
          $t('statesync.here') }}&nbsp;</a>
        <a class="lowercase">
          {{ $t('statesync.for_more_info') }}.</a>
      </div>
    </div>


    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white truncate mb-3">
        {{ $t('statesync.title_2') }}
      </h2>
      <div class="text-sm text-gray-700 dark:text-gray-300">
        1. {{ $t('statesync.text_1') }} ({{ appName }} {{ $t('statesync.version') }}:
        {{ nodeInfo.application_version?.version || '' }})
        <br />
        {{ $t('statesync.text_1_1') }}.
        <br />
        <br />
        2. {{ $t('statesync.text_2') }}<br />
        {{ $t('statesync.text_2_1') }}.
        <br /><br />
        <div class="bg-gray-900 dark:bg-black rounded-lg p-4 my-4 font-mono text-sm">
          <div class="text-gray-300"><span class="text-gray-500">></span> [state-sync]</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> enable = true</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> </div>
          <div class="text-gray-300"><span class="text-gray-500">></span> rpc_servers = "{{ rpcs }}"</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> trust_height = {{ height }}</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> trust_hash = "{{ hash }}"</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> </div>
          <div class="text-green-400"><span class="text-gray-500">></span> # 2/3 of unbonding time</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> trust_period = "168h"</div>
        </div>
        <br />
        3. {{ $t('statesync.text_3') }}: <code
          class="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1 mx-1 rounded font-mono text-sm">{{ appName }} start</code>
        <br />
        {{ $t('statesync.text_3_1') }}
        <code class="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1 mx-1 rounded font-mono text-sm">{{ appName }} unsafe-reset-all</code> or
        <code
          class="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1 mx-1 rounded font-mono text-sm">{{ appName }} tendermint unsafe-reset-all --home ~/.HOME</code>
        {{ $t('statesync.text_3_2') }}.
      </div>
    </div>

    <div class="modern-card shadow-modern px-6 pt-4 pb-5">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white truncate mb-3">{{ $t('statesync.title_3') }}</h2>
      <div class="text-sm text-gray-700 dark:text-gray-300">
        {{ $t('statesync.text_title_3') }}
        <br /><br />
        <div class="bg-gray-900 dark:bg-black rounded-lg p-4 my-4 font-mono text-sm">
          <div class="text-gray-300"><span class="text-gray-500">></span> [state-sync]</div>
          <div class="text-green-400"><span class="text-gray-500">></span> # snapshot-interval specifies the block interval at which local state sync snapshots are</div>
          <div class="text-green-400"><span class="text-gray-500">></span> # taken (0 to disable). Must be a multiple of pruning-keep-every.</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> snapshot-interval = 1000</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> </div>
          <div class="text-green-400"><span class="text-gray-500">></span> # snapshot-keep-recent specifies the number of recent snapshots to keep and serve (0 to keep all). Each snapshot is about 500MiB</div>
          <div class="text-gray-300"><span class="text-gray-500">></span> snapshot-keep-recent = 2</div>
        </div>
      </div>
    </div>
  </div>
</template>

<route>
    {
      meta: {
        i18n: 'state-sync'
      }
    }
  </route>
