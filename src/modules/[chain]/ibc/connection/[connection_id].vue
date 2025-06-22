<script lang="ts" setup>
import { formatSeconds } from '@/libs/utils';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import { type Connection, type ClientState, type Channel, PageRequest, type TxResponse, type PaginatedTxs } from '@/types';
import { computed, onMounted } from 'vue';
import { ref } from 'vue';
import { useIBCModule } from '../connStore';
import PaginationBar from '@/components/PaginationBar.vue';
import { Icon } from '@iconify/vue';

const props = defineProps(['chain', 'connection_id']);
const chainStore = useBlockchain();
const baseStore = useBaseStore();
const format = useFormatter();
const ibcStore = useIBCModule()
const conn = ref({} as Connection);
const clientState = ref({} as { client_id: string; client_state: ClientState });
const channels = ref([] as Channel[]);

const connId = computed(() => {
  return props.connection_id || 0
})

const loading = ref(false)
const txs = ref({} as PaginatedTxs)
const direction = ref('')
const channel_id = ref('')
const port_id = ref('')
const page = ref(new PageRequest())
page.value.limit = 5

onMounted(() => {
  if (connId.value) {
    chainStore.rpc.getIBCConnectionsById(connId.value).then((x) => {
      conn.value = x.connection;
    });
    chainStore.rpc
      .getIBCConnectionsClientState(connId.value)
      .then((x) => {
        clientState.value = x.identified_client_state;
      });
    chainStore.rpc.getIBCConnectionsChannels(connId.value).then((x) => {
      channels.value = x.channels;
    });
  }
});

function loadChannel(channel: string, port: string) {
  chainStore.rpc.getIBCChannelNextSequence(channel, port).then((x) => {
    console.log(x);
  });
}

function pageload(pageNum: number) {
  if (direction.value === 'In') {
    fetchSendingTxs(channel_id.value, port_id.value, pageNum -1)
  } else {
    fetchSendingTxs(channel_id.value, port_id.value, pageNum -1)
  }

}

function fetchSendingTxs(channel: string, port: string, pageNum = 0) {

  page.value.setPage(pageNum)
  loading.value = true
  direction.value = 'Out'
  channel_id.value = channel
  port_id.value = port
  txs.value = {} as PaginatedTxs
  chainStore.rpc.getTxs("?order_by=2&events=send_packet.packet_src_channel='{channel}'&events=send_packet.packet_src_port='{port}'", { channel, port }, page.value).then(res => {
    txs.value = res
  })
    .finally(() => loading.value = false)
}
function fetchRecevingTxs(channel: string, port: string, pageNum = 0) {
  page.value.setPage(pageNum)
  loading.value = true
  direction.value = 'In'
  channel_id.value = channel
  port_id.value = port
  txs.value = {} as PaginatedTxs
  chainStore.rpc.getTxs("?order_by=2&events=recv_packet.packet_dst_channel='{channel}'&events=recv_packet.packet_dst_port='{port}'", { channel, port }, page.value).then(res => {
    txs.value = res
  })
    .finally(() => loading.value = false)
}

function color(v: string) {
  if (v && v.indexOf('_OPEN') > -1) {
    return 'success';
  }
  return 'warning';
}
</script>
<template>
  <div class="">
    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <div class="mx-auto max-w-7xl">
        <dl class="grid grid-cols-1 gap-x-6 text-center lg:!grid-cols-3">
          <div class="mx-auto flex items-center">
            <div>
              <div class="order-first text-3xl font-semibold tracking-tight text-gray-900 dark:text-white mb-1">
                {{ baseStore.latest?.block?.header?.chain_id }}
              </div>
              <div class="text-sm text-gray-600 dark:text-gray-400">
                {{ conn.client_id }} {{ props.connection_id }}
              </div>
            </div>
          </div>
          <div class="mx-auto flex items-center">
            <div :class="{ 'text-green-500': conn.state?.indexOf('_OPEN') > -1 }" class="text-gray-700 dark:text-gray-300">
              <span class="text-lg rounded-full">&#x21cc;</span>
              <div class="text-center">
                {{ conn.state }}
              </div>
            </div>
          </div>
          <div class="mx-auto">
            <div class="order-first text-3xl font-semibold tracking-tight text-gray-900 dark:text-white mb-2">
              {{ clientState.client_state?.chain_id }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">
              {{ conn.counterparty?.connection_id }} {{ clientState.client_id }}
            </div>
          </div>
        </dl>
      </div>
    </div>

    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4 overflow-hidden">{{ $t('ibc.title_2') }}<span class="ml-2 text-sm text-gray-600 dark:text-gray-400">{{
        clientState.client_state?.['@type'] }}</span></h2>
      <div class="overflow-x-auto grid grid-cols-1 md:grid-cols-2 gap-4">
        <table class="table table-sm capitalize">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th colspan="3" class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.trust_parameters') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.trust_level') }}:</td>
              <td class="text-gray-900 dark:text-white">
                {{ clientState.client_state?.trust_level?.numerator }}/{{
                  clientState.client_state?.trust_level?.denominator
                }}
              </td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.trusting_period') }}:</td>
              <td class="text-gray-900 dark:text-white">{{ formatSeconds(clientState.client_state?.trusting_period) }}</td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.unbonding_period') }}:</td>
              <td class="text-gray-900 dark:text-white">{{ formatSeconds(clientState.client_state?.unbonding_period) }}</td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.max_clock_drift') }}:</td>
              <td class="text-gray-900 dark:text-white">{{ formatSeconds(clientState.client_state?.max_clock_drift) }}</td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.frozen_height') }}:</td>
              <td class="text-gray-900 dark:text-white">{{ clientState.client_state?.frozen_height }}</td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.latest_height') }}:</td>
              <td class="text-gray-900 dark:text-white">{{ clientState.client_state?.latest_height }}</td>
            </tr>
          </tbody>
        </table>
        <table class="table table-sm text-sm w-full capitalize">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th colspan="2" class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.upgrade_parameters') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="2">
                <div class="flex justify-between text-gray-700 dark:text-gray-300"><span>{{ $t('ibc.allow_update_after_expiry') }}:</span> <span class="text-gray-900 dark:text-white">{{
                  clientState.client_state?.allow_update_after_expiry }}</span></div>
              </td>
            </tr>
            <tr>
              <td colspan="2">
                <div class="flex justify-between text-gray-700 dark:text-gray-300"><span>{{ $t('ibc.allow_update_after_misbehaviour') }}: </span> <span class="text-gray-900 dark:text-white">{{
                  clientState.client_state?.allow_update_after_misbehaviour }}</span></div>
              </td>
            </tr>
            <tr>
              <td class="w-52 text-gray-700 dark:text-gray-300">{{ $t('ibc.upgrade_path') }}:</td>
              <td class="text-right text-gray-900 dark:text-white">{{ clientState.client_state?.upgrade_path.join(', ') }}</td>
            </tr>
          </tbody>
        </table>

      </div>
    </div>
    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6 overflow-hidden">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white">{{ $t('ibc.channels') }}</h2>
      <div class="overflow-auto">
        <table class="table w-full mt-4">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.txs') }}</th>
              <th style="position: relative; z-index: 2" class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.channel_id') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.port_id') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.state') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.counterparty') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.hops') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.version') }}</th>
              <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.ordering') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in ibcStore.registryChannels" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
              <td>
                <div class="flex gap-1">
                  <button class="modern-button-secondary text-xs px-2 py-1"
                    @click="fetchSendingTxs(v[ibcStore.sourceField].channel_id, v[ibcStore.sourceField].port_id)"
                    :disabled="loading">
                    <span v-if="loading" class="loading loading-spinner loading-sm"></span>
                    {{ $t('ibc.btn_out') }}
                  </button>
                  <button class="modern-button-secondary text-xs px-2 py-1"
                    @click="fetchRecevingTxs(v[ibcStore.sourceField].channel_id, v[ibcStore.sourceField].port_id)"
                    :disabled="loading">
                    <span v-if="loading" class="loading loading-spinner loading-sm"></span>
                    {{ $t('ibc.btn_in') }}
                  </button>
                </div>
              </td>
              <td>
                <a href="#" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{
                  v[ibcStore.sourceField].channel_id
                }}</a>
              </td>
              <td class="text-gray-700 dark:text-gray-300">{{ v[ibcStore.sourceField].port_id }}</td>
            </tr>
            <tr v-for="v in channels" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
              <td>
                <div class="flex gap-1">
                  <button class="modern-button-secondary text-xs px-2 py-1" @click="fetchSendingTxs(v.channel_id, v.port_id)" :disabled="loading">
                    <span v-if="loading" class="loading loading-spinner loading-sm"></span>
                    {{ $t('ibc.btn_out') }}
                  </button>
                  <button class="modern-button-secondary text-xs px-2 py-1" @click="fetchRecevingTxs(v.channel_id, v.port_id)" :disabled="loading">
                    <span v-if="loading" class="loading loading-spinner loading-sm"></span>
                    {{ $t('ibc.btn_in') }}
                  </button>
                </div>
              </td>
              <td>
                <a href="#" @click="loadChannel(v.channel_id, v.port_id)" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{
                  v.channel_id
                }}</a>
              </td>
              <td class="text-gray-700 dark:text-gray-300">{{ v.port_id }}</td>
              <td>
                <div class="text-xs truncate py-1 px-3 rounded-lg w-fit" :class="v.state === 'STATE_OPEN' ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' : 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800'">
                  {{ v.state }}
                </div>
              </td>
              <td class="text-gray-700 dark:text-gray-300">
                {{ v.counterparty?.port_id }}/{{ v.counterparty?.channel_id }}
              </td>
              <td class="text-gray-700 dark:text-gray-300">{{ v.connection_hops.join(', ') }}</td>
              <td class="text-gray-700 dark:text-gray-300">{{ v.version }}</td>
              <td class="text-gray-700 dark:text-gray-300">{{ v.ordering }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-if="channel_id" class="modern-card shadow-modern px-6 pt-4 pb-5 mt-6">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white capitalize mb-4">Transactions ({{ channel_id }} {{ port_id }} {{ direction }}) </h3>
      <table class="table">
        <thead class="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.height') }}</th>
            <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.txhash') }}</th>
            <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.messages') }}</th>
            <th class="text-gray-700 dark:text-gray-300 font-semibold">{{ $t('ibc.time') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="resp in txs?.tx_responses" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
            <td class="text-gray-900 dark:text-white">{{ resp.height }}</td>
            <td>
              <div class="text-xs truncate">
                <RouterLink :to="`/${chainStore.chainName}/tx/${resp.txhash}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{ resp.txhash }}</RouterLink>
              </div>
            </td>
            <td>
              <div class="flex items-center text-gray-700 dark:text-gray-300">
                {{ format.messages(resp.tx.body.messages) }}
                <Icon v-if="resp.code === 0" icon="mdi-check" class="text-green-500 text-lg ml-2" />
                <Icon v-else icon="mdi-multiply" class="text-red-500 text-lg ml-2" />
              </div>
            </td>
            <td class="text-gray-700 dark:text-gray-300">{{ format.toLocaleDate(resp.timestamp) }}</td>
          </tr>
        </tbody>
      </table>
      <PaginationBar :limit="page.limit" :total="txs.pagination?.total" :callback="pageload" />
    </div>
  </div>
</template>
