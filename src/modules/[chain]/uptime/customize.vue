<script lang="ts" setup>
import { ref, onMounted, computed, watchEffect } from 'vue';
import { fromHex, toBase64 } from '@cosmjs/encoding';
import { Icon } from '@iconify/vue';
import {
  useFormatter,
  useStakingStore,
  useBaseStore,
  useBlockchain,
useDashboard,
} from '@/stores';
import UptimeBar from '@/components/UptimeBar.vue';
import type { Block, Commit } from '@/types';
import { consensusPubkeyToHexAddress, valconsToBase64 } from '@/libs';
import type { SigningInfo } from '@/types/slashing';
import { CosmosRestClient } from '@/libs/client';

const props = defineProps(['chain']);

const stakingStore = useStakingStore();
const format = useFormatter();
const chainStore = useBlockchain();
const dashboard = useDashboard()
// storage local favorite validator ids
const local = ref(JSON.parse(localStorage.getItem('uptime-validators') || '{}') as Record<string, {name: string, address: string}[]>)
const signingInfo = ref({} as Record<string, SigningInfo[]>);
const selected = ref([] as string[])
const selectChain = ref(chainStore.chainName)
const validators = ref(stakingStore.validators)
const keyword = ref("")

function loadSigningInfo(chainName: string) {
  const chain = dashboard.chains[chainName]
  if(chain && chain.endpoints.rest) {
    const client = CosmosRestClient.newDefault(chain.endpoints.rest[0].address)
    client.getSlashingSigningInfos().then( resp => {
      signingInfo.value[chainName] = resp.info
    })
  }
}
if(local.value) Object.keys(local.value).map(chainName => {
  loadSigningInfo(chainName)
})

function initial() {
  const vals = local.value[selectChain.value]
  if(vals) {
    selected.value = vals.map(x => x.address)
  }
}

const filterValidators = computed(() => {
  if(keyword.value) {
    return validators.value.filter(x => x.description.moniker.indexOf(keyword.value) > -1)
  }
  return validators.value
})

const list = computed(() => {
  const list = [] as any[]
  if(local.value) Object.keys(local.value).map( chainName => {
    const vals = local.value[chainName]
    const info = signingInfo.value[chainName]
    if(vals && info) {
      vals.forEach(v => {
        const sigingInfo = info.find(x => valconsToBase64(x.address) === v.address)
        list.push( {
          chainName,
          v,
          sigingInfo,
        })
      })
    }
  })
  return list
})

function add() {
  if(!signingInfo.value[selectChain.value]) {
    loadSigningInfo(selectChain.value)
  }
  const newList = [] as { name: string; address: string; }[]
  selected.value.forEach(x => {
    const validator = validators.value.find(v => (consensusPubkeyToHexAddress(v.consensus_pubkey) === x))
    if(validator) newList.push({
      name: validator.description.moniker || x,
      address: x
    })
  })
  if(!local.value) local.value = {}
  local.value[selectChain.value] = newList

  localStorage.setItem("uptime-validators", JSON.stringify(local.value))
}

function changeChain() {
  validators.value = []
  const endpoint = dashboard.chains[selectChain.value].endpoints.rest?.at(0)?.address
  if(!endpoint) return 

  const client = CosmosRestClient.newDefault(endpoint)
  client.getStakingValidators("BOND_STATUS_BONDED").then(x => {
    validators.value = x.validators
  })

  const vals = local.value[selectChain.value]
  if(vals) {
    selected.value = vals.map(x => x.address)
  } else {
    selected.value = []
  }
}

function color(v: string) {
  if(v) {
    const n = Number(v)
    if(n < 10) return " badge-success"
    if(n > 1000) return " badge-error"
    if(n > 0) return " badge-warning"
  }
}

</script>

<template>
  <div>
    <div class="overflow-x-auto w-full">
      <div class="lg:!flex lg:!items-center lg:!justify-between modern-card p-5 shadow-modern">
        <div class="min-w-0 flex-1">
          <h2 class="text-2xl font-bold leading-7 sm:!truncate sm:!text-3xl sm:!tracking-tight text-gray-900 dark:text-white">{{ $t('uptime.my_validators') }}</h2>
          <div class="mt-1 flex flex-col sm:!mt-0 sm:!flex-row sm:!flex-wrap sm:!space-x-6">
            <div class="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
              <svg class="mr-1.5 h-5 w-5 flex-shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor"
                aria-hidden="true">
                <path fill-rule="evenodd"
                  d="M6 3.75A2.75 2.75 0 018.75 1h2.5A2.75 2.75 0 0114 3.75v.443c.572.055 1.14.122 1.706.2C17.053 4.582 18 5.75 18 7.07v3.469c0 1.126-.694 2.191-1.83 2.54-1.952.599-4.024.921-6.17.921s-4.219-.322-6.17-.921C2.694 12.73 2 11.665 2 10.539V7.07c0-1.321.947-2.489 2.294-2.676A41.047 41.047 0 016 4.193V3.75zm6.5 0v.325a41.622 41.622 0 00-5 0V3.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25zM10 10a1 1 0 00-1 1v.01a1 1 0 001 1h.01a1 1 0 001-1V11a1 1 0 00-1-1H10z"
                  clip-rule="evenodd" />
                <path
                  d="M3 15.055v-.684c.126.053.255.1.39.142 2.092.642 4.313.987 6.61.987 2.297 0 4.518-.345 6.61-.987.135-.041.264-.089.39-.142v.684c0 1.347-.985 2.53-2.363 2.686a41.454 41.454 0 01-9.274 0C3.985 17.585 3 16.402 3 15.055z" />
              </svg>
              {{ $t('uptime.add_validators_monitor') }}
            </div>
          </div>
        </div>
        <div class="mt-5 flex lg:!ml-4 lg:!mt-0">
          
        </div>
      </div>
      <table class="w-full bg-white dark:bg-epix-gray rounded-lg border border-gray-200 dark:border-gray-700">
        <thead class="bg-gray-50 dark:bg-epix-gray-light">
          <tr>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.no') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Blockchain</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('account.validator') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.signed_blocks') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.last_jailed_time') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.tombstoned') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.missing_blocks') }}</th>
            <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(v, i) in list" :key="i" class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200 border-b border-gray-100 dark:border-gray-800">
            <td class="py-3 px-4 text-gray-900 dark:text-white">{{ i+1 }}</td>
            <td class="py-3 px-4 capitalize text-gray-900 dark:text-white">{{ v.chainName }}</td>
            <td class="py-3 px-4 text-gray-900 dark:text-white">{{ v.v.name }}</td>
            <td class="py-3 px-4 text-gray-900 dark:text-white"><span v-if="v.sigingInfo">{{ Number(v.sigingInfo.index_offset) - Number(v.sigingInfo.start_height) }}</span></td>
            <td class="py-3 px-4">
              <div v-if="v.sigingInfo && !v.sigingInfo?.jailed_until.startsWith('1970')" class="text-xs flex flex-wrap">
                <div class="mt-1 text-gray-900 dark:text-white">{{ format.toLocaleDate(v.sigingInfo?.jailed_until) }}</div>
                <div class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 ml-2">{{ format.toDay(v.sigingInfo.jailed_until, 'from') }}</div>
              </div>
            </td>
            <td class="py-3 px-4 capitalize text-gray-900 dark:text-white">{{ v.sigingInfo?.tombstoned }}</td>
            <td class="py-3 px-4"><span v-if="v.sigingInfo" class="px-2 py-1 text-xs rounded-full" :class="color( v.sigingInfo?.missed_blocks_counter)">{{ v.sigingInfo?.missed_blocks_counter }}</span></td>
            <td class="py-3 px-4"><RouterLink :to="`/${v.chainName}/uptime/#blocks`" class="modern-button px-3 py-1 text-xs">{{ $t('module.blocks') }}</RouterLink></td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <div class="text-center">
      <label for="add-validator" class="modern-button px-6 py-3 mt-5">{{ $t('uptime.add_validators') }}</label>
    </div>

    <!-- Put this part before </body> tag -->
    <input type="checkbox" id="add-validator" class="modal-toggle" @change="initial" />
    <div class="modal">
      <div class="modern-card relative max-w-4xl mx-auto shadow-modern">
        <label for="add-validator" class="absolute right-4 top-4 w-8 h-8 rounded-full bg-gray-100 dark:bg-epix-gray hover:bg-gray-200 dark:hover:bg-epix-gray-light flex items-center justify-center cursor-pointer transition-colors duration-200">✕</label>
        <h3 class="text-lg font-bold text-gray-900 dark:text-white p-6 pb-0">{{ $t('uptime.add_validators') }}</h3>
          <div class="p-6">
            <div class="flex gap-2">
              <select v-model="selectChain" class="modern-input px-3 py-2 capitalize" @change="changeChain">
                <option v-for="v in dashboard.chains" :value="v.chainName">
                  {{ v.chainName }}
                </option>
              </select>
              <input v-model="keyword" type="text" class="modern-input px-3 py-2 flex-1" placeholder="keywords to filter validator">
            </div>
          </div>
        <div class="py-4 max-h-60 overflow-y-auto px-6">

          <table class="w-full bg-white dark:bg-epix-gray rounded-lg border border-gray-200 dark:border-gray-700">
            <thead class="bg-gray-50 dark:bg-epix-gray-light">
              <tr>
                <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('account.validator') }}</th>
                <th class="text-center py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">Select</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, i) in filterValidators" :key="i" class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200 border-b border-gray-100 dark:border-gray-800">
                <td class="py-3 px-4"><label :for="v.operator_address" class="w-full cursor-pointer text-gray-900 dark:text-white">{{ i+1 }}. {{ v.description.moniker }}</label></td>
                <td class="py-3 px-4 text-center"><input :id="v.operator_address" v-model="selected" class="w-4 h-4 text-epix-primary bg-gray-100 border-gray-300 rounded focus:ring-epix-primary dark:focus:ring-epix-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600" type="checkbox" :value="consensusPubkeyToHexAddress(v.consensus_pubkey)"/></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-6 pt-0 flex justify-end">
          <button class="modern-button px-6 py-2" @click="add">{{ $t('uptime.add') }}</button>
        </div>
      </div>
    </div>
    <div class="h-6"></div>
  </div>
</template>

