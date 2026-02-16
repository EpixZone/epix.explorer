<script lang="ts" setup>
import fetch from 'cross-fetch';
import { onMounted, ref, computed, onUnmounted } from 'vue';
import { useBlockchain, useFormatter, useStakingStore, useBaseStore } from '@/stores';
import { consensusPubkeyToHexAddress } from '@/libs';

const format = useFormatter();
const chainStore = useBlockchain();
const stakingStore = useStakingStore();
const baseStore = useBaseStore();
const rpcList = ref(chainStore.current?.endpoints?.rpc || [{ address: '', provider: '' }]);
let rpc = ref('');
const validators = ref(stakingStore.validators);

let httpstatus = ref(200);
let httpStatusText = ref('');
let roundState = ref({} as any);
let rate = ref('');
let height = ref('');
let round = ref('');
let step = ref('');
let timer = null as any;
let updatetime = ref(new Date());
let positions = ref([]);
let validatorsData = ref([] as any);
onMounted(async () => {
  // stakingStore.init();
  validatorsData.value = await stakingStore.fetchAcitveValdiators();
  rpc.value = rpcList.value[0].address + '/consensus_state';
  await fetchPosition();
  update();
  clearTime();
  timer = setInterval(() => {
    update();
  }, 1000);
});
onUnmounted(() => {
  clearTime();
});

function clearTime() {
  clearInterval(timer);
  timer = null;
}
const newTime = computed(() => {
  return format.toDay(updatetime.value, 'time');
});

const vals = computed(() => {
  return validatorsData.value.map((x: any) => {
    const x2 = x;
    // @ts-ignore
    x2.hex = consensusPubkeyToHexAddress(x.consensus_pubkey);
    return x2;
  });
});

function showName(i: number, text: string) {
  if (text === 'nil-Vote') {
    // @ts-ignore
    if (positions.value?.[i]?.address) {
      const val = vals.value.find(
        // @ts-ignore
        (x) => x.hex === positions.value?.[i]?.address
      );
      return val?.description?.moniker || i;
    }
    return i;
  }
  // const txt = text.substring(text.indexOf(':') + 1, text.indexOf(' '));
  // const sig = text.split(' ');
  // // @ts-ignore
  // const val = validators.value.find((x) => x?.hex?.startsWith(txt));
  // return `${val?.description?.moniker || txt} - ${sig[2]}`;
}
function color(i: number, txt: string) {
  if (i === roundState.value?.proposer?.index) {
    return txt === 'nil-Vote' ? 'warning' : 'primary';
  }
  return txt === 'nil-Vote' ? 'gray-700' : 'success';
}
async function onChange() {
  httpstatus.value = 200;
  httpStatusText.value = '';
  roundState.value = {};
  clearTime();
  await fetchPosition();
  update();
  timer = setInterval(() => {
    update();
  }, 1000);
}

async function fetchPosition() {
  let dumpurl = rpc.value.replace('consensus_state', 'dump_consensus_state');
  try {
    const response = await fetch(dumpurl);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    httpstatus.value = response.status;
    httpStatusText.value = response.statusText;

    const data = await response.json();
    positions.value = data.result.round_state.validators.validators;
  } catch (error) {
    // @ts-ignore
    httpstatus.value = error?.status || 500;
    // @ts-ignore
    httpStatusText.value = error?.message || 'Error';
  }
}

async function update() {
  rate.value = '0%';
  updatetime.value = new Date();
  if (httpstatus.value === 200) {
    fetch(rpc.value)
      .then((data) => {
        httpstatus.value = data.status;
        httpStatusText.value = data.statusText;
        return data.json();
      })
      .then((res) => {
        roundState.value = res.result.round_state;
        const raw = roundState?.value?.['height/round/step']?.split('/');
        // eslint-disable-next-line prefer-destructuring
        height.value = raw[0];
        // eslint-disable-next-line prefer-destructuring
        round.value = raw[1];
        // eslint-disable-next-line prefer-destructuring
        step.value = raw[2];

        // find the highest onboard rate
        roundState.value?.height_vote_set?.forEach((element: any) => {
          const rates = Number(element.prevotes_bit_array.substring(element.prevotes_bit_array.length - 4));
          if (rates > 0) {
            rate.value = `${(rates * 100).toFixed()}%`;
          }
        });
      })
      .catch((err) => {
        httpstatus.value = 500;
        httpStatusText.value = err;
      });
  }
}
</script>

<template>
  <div>
    <!--  -->
    <div class="modern-card shadow-modern px-6 pt-4 pb-5 mb-6">
      <div class="form-control">
        <label class="input-group input-group-md w-full flex">
          <select v-model="rpc" class="modern-input select w-full flex-1 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <option v-for="(item, index) in rpcList" :key="index">
              {{ item?.address }}/consensus_state
            </option>
          </select>
          <button class="modern-button px-4 py-2 ml-3" @click="onChange">{{ $t('consensus.monitor') }}</button>
        </label>
      </div>
      <div v-if="httpstatus !== 200" class="text-red-600 dark:text-red-400 mt-3 text-sm">
        {{ httpstatus }}: {{ httpStatusText }}
      </div>
    </div>
    <!-- cards -->
    <div class="mt-4" v-if="roundState['height/round/step']">
      <div class="grid grid-cols-1 md:!grid-cols-4 auto-cols-auto gap-4 pb-4">
        <div
          class="modern-card shadow-modern px-6 py-4 flex justify-between items-center"
        >
          <div class="text-sm mb-1 flex flex-col truncate">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ rate }}</h4>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('consensus.onboard_rate') }}</span>
          </div>
          <div class="avatar placeholder">
            <div
              class="bg-red-500/20 rounded-full w-12 h-12 flex items-center justify-center"
            >
              <span class="text-xl text-red-400 font-semibold">{{ $t('consensus.o') }}</span>
            </div>
          </div>
        </div>
        <!-- Height -->
        <div
          class="modern-card shadow-modern px-6 py-4 flex justify-between items-center"
        >
          <div class="text-sm mb-1 flex flex-col truncate">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ height }}</h4>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('account.height') }}</span>
          </div>
          <div class="avatar placeholder">
            <div
              class="bg-green-500/20 rounded-full w-12 h-12 flex items-center justify-center"
            >
              <span class="text-xl text-green-400 font-semibold">{{ $t('consensus.h') }}</span>
            </div>
          </div>
        </div>
        <!-- Round -->
        <div
          class="modern-card shadow-modern px-6 py-4 flex justify-between items-center"
        >
          <div class="text-sm mb-1 flex flex-col truncate">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ round }}</h4>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('consensus.round') }}</span>
          </div>
          <div class="avatar placeholder">
            <div
              class="bg-purple-500/20 rounded-full w-12 h-12 flex items-center justify-center"
            >
              <span class="text-xl text-purple-400 font-semibold">{{ $t('consensus.r') }}</span>
            </div>
          </div>
        </div>
        <!-- Step -->
        <div
          class="modern-card shadow-modern px-6 py-4 flex justify-between items-center"
        >
          <div class="text-sm mb-1 flex flex-col truncate">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ step }}</h4>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('consensus.step') }}</span>
          </div>
          <div class="avatar placeholder">
            <div
              class="bg-blue-500/20 rounded-full w-12 h-12 flex items-center justify-center"
            >
              <span class="text-xl text-blue-400 font-semibold">{{ $t('consensus.s') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- update -->
    <div
      class="modern-card shadow-modern p-6"
      v-if="roundState['height/round/step']"
    >
      <div class="flex flex-1 flex-col truncate">
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400 mb-6">
          {{ $t('consensus.updated_at') }} {{ newTime || '' }}
        </h2>
        <div v-for="item in roundState.height_vote_set" :key="item.round">
          <div class="text-xs mb-1 text-gray-700 dark:text-gray-300">{{ $t('consensus.round') }}: {{ item.round }}</div>
          <div class="text-xs break-words text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded">{{ item.prevotes_bit_array }}</div>

          <div class="flex flex-rows flex-wrap py-6">
            <div
              class="w-48 rounded-lg h-5 text-sm px-2 leading-5 bg-gray-100 dark:bg-gray-800"
              v-for="(pre, i) in item.prevotes"
              :key="i"
              size="sm"
              style="margin: 2px"
            >
              <span class="flex flex-rows justify-between">
                <span class="truncate text-gray-700 dark:text-gray-300">{{ showName(i, 'nil-Vote') }} </span>
                <span>
                  <span class="tooltip w-3 h-3 rounded-sm inline-block" :data-tip="pre"
                  :class="{
                    'bg-green-400': String(pre).toLowerCase() !== 'nil-vote',
                    'bg-red-400': String(pre).toLowerCase() === 'nil-vote'
                  }"
                  ></span>
                  <span class="tooltip ml-1 w-3 h-3 rounded-sm inline-block" :data-tip="item.precommits[i]"
                  :class="{
                    'bg-green-400': String(item.precommits[i]).toLowerCase() !== 'nil-vote',
                    'bg-red-400': String(item.precommits[i]).toLowerCase() === 'nil-vote'
                  }"></span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="divider border-gray-200 dark:border-gray-700"></div>

    </div>

    <!-- alert-info -->
    <div
      class="modern-card shadow-modern mt-6 border-l-4 border-epix-teal"
    >
      <div
        class="px-6 pt-4 pb-2"
      >
        <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ $t('consensus.tips') }}</h2>
      </div>
      <div class="px-6 py-4">
        <ul style="list-style-type: disc" class="pl-6 text-gray-700 dark:text-gray-300">
          <li class="mb-2">
            {{ $t('consensus.tips_description_1') }}
          </li>
          <li>
            {{ $t('consensus.tips_description_2') }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'consensus',
    }
  }
</route>
