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
let lastCompletedRounds = ref([] as any[]);
let lastHeight = ref('');
let prevBlockHeight = ref('');
let prevBlockRounds = ref([] as any[]);
let commitFlash = ref(false);
let updating = false;
onMounted(async () => {
  // stakingStore.init();
  validatorsData.value = await stakingStore.fetchAcitveValdiators();
  rpc.value = rpcList.value[0].address + '/consensus_state';
  await fetchPosition();
  update();
  clearTime();
  timer = setInterval(() => {
    update();
  }, 100);
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

const consensusSteps = [
  { num: 1, label: 'NewHeight', short: 'NH' },
  { num: 2, label: 'NewRound', short: 'NR' },
  { num: 3, label: 'Propose', short: 'Prop' },
  { num: 4, label: 'Prevote', short: 'PV' },
  { num: 5, label: 'PrevoteWait', short: 'PVW' },
  { num: 6, label: 'Precommit', short: 'PC' },
  { num: 7, label: 'PrecommitWait', short: 'PCW' },
  { num: 8, label: 'Commit', short: 'Com' },
];

const currentStep = computed(() => Number(step.value));

const stepName = computed(() => {
  return consensusSteps.find((cs) => cs.num === currentStep.value)?.label || step.value;
});

// Blue-to-green gradient for progress bar steps
function stepColor(stepNum: number): string {
  // Interpolate from blue (210, 80%, 55%) to green (145, 70%, 50%)
  const t = (stepNum - 1) / 7; // 0 at step 1, 1 at step 8
  const r = Math.round(30 + t * (50 - 30));
  const g = Math.round(120 + t * (205 - 120));
  const b = Math.round(220 + t * (100 - 220));
  return `rgb(${r}, ${g}, ${b})`;
}

const hasVotes = (r: any) => r.prevotes.some((v: string) => String(v).toLowerCase() !== 'nil-vote');

const visibleRounds = computed(() => {
  const voteSet = roundState.value?.height_vote_set || [];
  const activeRounds = voteSet.filter(hasVotes);
  if (activeRounds.length > 0) {
    // Save for the "Last Block" card when height changes
    lastCompletedRounds.value = [...activeRounds];
  }
  // Always show current height's actual data (including all-nil rounds)
  return voteSet;
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
  }, 100);
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
  if (updating) return;
  updating = true;
  try {
    const data = await fetch(rpc.value);
    httpstatus.value = data.status;
    httpStatusText.value = data.statusText;
    const res = await data.json();
    roundState.value = res.result.round_state;
    updatetime.value = new Date();
    const raw = roundState?.value?.['height/round/step']?.split('/');
    const newHeight = raw[0];
    // Height changed — save previous block's vote rounds and trigger flash
    if (lastHeight.value && newHeight !== lastHeight.value) {
      prevBlockHeight.value = lastHeight.value;
      prevBlockRounds.value = [...lastCompletedRounds.value];
      commitFlash.value = true;
      setTimeout(() => { commitFlash.value = false; }, 1500);
    }
    lastHeight.value = newHeight;
    // eslint-disable-next-line prefer-destructuring
    height.value = raw[0];
    // eslint-disable-next-line prefer-destructuring
    round.value = raw[1];
    // eslint-disable-next-line prefer-destructuring
    step.value = raw[2];

    // find the highest onboard rate
    let maxRate = 0;
    roundState.value?.height_vote_set?.forEach((element: any) => {
      const rates = Number(element.prevotes_bit_array.substring(element.prevotes_bit_array.length - 4));
      if (rates > maxRate) {
        maxRate = rates;
      }
    });
    rate.value = `${(maxRate * 100).toFixed()}%`;
  } catch (err) {
    // Don't update httpstatus on transient errors — keep polling
  } finally {
    updating = false;
  }
}
</script>

<template>
  <div>
    <!-- cards -->
    <div>
      <div class="grid grid-cols-2 md:!grid-cols-4 auto-cols-auto gap-2 sm:gap-4 pb-4">
        <div
          class="modern-card shadow-modern px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center"
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
          class="modern-card shadow-modern px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center"
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
          class="modern-card shadow-modern px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center"
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
          class="modern-card shadow-modern px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center"
        >
          <div class="text-sm mb-1 flex flex-col truncate">
            <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ stepName }}</h4>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('consensus.step') }} {{ currentStep }}/8</span>
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
      <!-- Current Block: Progress + Live Vote Results -->
      <div class="modern-card shadow-modern px-3 sm:px-6 py-4 mb-4">
        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Current: <span class="font-semibold text-gray-700 dark:text-gray-300">#{{ height }}</span></span>
          <span class="font-semibold text-epix-teal">{{ stepName }}</span>
          <span class="text-gray-400">{{ $t('consensus.updated_at') }} {{ newTime || '' }}</span>
          <span v-if="httpstatus !== 200" class="text-red-500">{{ httpstatus }}: {{ httpStatusText }}</span>
          <select v-if="rpcList.length > 1" v-model="rpc" @change="onChange" class="ml-auto modern-input px-2 py-1 text-xs text-gray-600 dark:text-gray-400">
            <option v-for="(item, index) in rpcList" :key="index">
              {{ item?.address }}/consensus_state
            </option>
          </select>
        </div>
        <div class="flex items-center gap-0.5 sm:gap-1 mb-4">
          <div
            v-for="cs in consensusSteps"
            :key="cs.num"
            class="flex-1 flex flex-col items-center"
          >
            <div
              class="w-full h-2 rounded-full transition-colors duration-150"
              :style="currentStep >= cs.num ? { backgroundColor: stepColor(cs.num) } : {}"
              :class="currentStep >= cs.num ? '' : 'bg-gray-200 dark:bg-gray-700'"
            ></div>
            <span
              class="text-[8px] sm:text-[10px] mt-1 transition-colors duration-150"
              :style="currentStep >= cs.num ? { color: stepColor(cs.num) } : {}"
              :class="currentStep >= cs.num ? 'font-semibold' : 'text-gray-400 dark:text-gray-500'"
            ><span class="hidden sm:inline">{{ cs.label }}</span><span class="sm:hidden">{{ cs.short }}</span></span>
          </div>
        </div>
        <!-- Current block vote rounds -->
        <div v-for="item in visibleRounds" :key="item.round"
          :class="hasVotes(item) ? '' : 'opacity-30 pointer-events-none'"
          class="transition-opacity duration-300"
        >
          <div class="text-xs mb-1 text-gray-700 dark:text-gray-300">{{ $t('consensus.round') }}: {{ item.round }}</div>
          <div class="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto whitespace-nowrap sm:whitespace-normal sm:break-words">{{ item.prevotes_bit_array }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 py-4">
            <div
              class="rounded-lg h-5 text-sm px-2 leading-5 bg-gray-100 dark:bg-gray-800"
              v-for="(pre, i) in item.prevotes"
              :key="i"
            >
              <span class="flex flex-rows justify-between min-w-0">
                <span class="truncate text-gray-700 dark:text-gray-300">{{ showName(i, 'nil-Vote') }}</span>
                <span class="flex-shrink-0 ml-1">
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
      <!-- Previous Block: Progress + Vote Results -->
      <div v-if="prevBlockHeight" class="modern-card shadow-modern px-3 sm:px-6 py-4 mb-4 transition-all duration-300" :class="{ 'commit-flash': commitFlash }">
        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2 flex flex-wrap gap-x-2">
          <span>Last Block: <span class="font-semibold text-gray-700 dark:text-gray-300">#{{ prevBlockHeight }}</span></span>
          <span class="text-green-500 font-semibold">Committed</span>
        </div>
        <div class="flex items-center gap-0.5 sm:gap-1 mb-4">
          <div
            v-for="cs in consensusSteps"
            :key="cs.num"
            class="flex-1 flex flex-col items-center"
          >
            <div class="w-full h-2 rounded-full bg-green-400/60"></div>
            <span class="text-[8px] sm:text-[10px] mt-1 text-green-500/70"><span class="hidden sm:inline">{{ cs.label }}</span><span class="sm:hidden">{{ cs.short }}</span></span>
          </div>
        </div>
        <!-- Previous block vote rounds -->
        <div v-for="item in prevBlockRounds" :key="'prev-' + item.round">
          <div class="text-xs mb-1 text-gray-700 dark:text-gray-300">{{ $t('consensus.round') }}: {{ item.round }}</div>
          <div class="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto whitespace-nowrap sm:whitespace-normal sm:break-words">{{ item.prevotes_bit_array }}</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 py-4">
            <div
              class="rounded-lg h-5 text-sm px-2 leading-5 bg-gray-100 dark:bg-gray-800"
              v-for="(pre, i) in item.prevotes"
              :key="i"
            >
              <span class="flex flex-rows justify-between min-w-0">
                <span class="truncate text-gray-700 dark:text-gray-300">{{ showName(i, 'nil-Vote') }}</span>
                <span class="flex-shrink-0 ml-1">
                  <span class="w-3 h-3 rounded-sm inline-block"
                    :class="{
                      'bg-green-400': String(pre).toLowerCase() !== 'nil-vote',
                      'bg-red-400': String(pre).toLowerCase() === 'nil-vote'
                    }"
                  ></span>
                  <span class="ml-1 w-3 h-3 rounded-sm inline-block"
                    :class="{
                      'bg-green-400': String(item.precommits[i]).toLowerCase() !== 'nil-vote',
                      'bg-red-400': String(item.precommits[i]).toLowerCase() === 'nil-vote'
                    }"
                  ></span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- alert-info -->
    <div
      class="modern-card shadow-modern mt-6 border-l-4 border-epix-teal"
    >
      <div
        class="px-3 sm:px-6 pt-4 pb-2"
      >
        <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ $t('consensus.tips') }}</h2>
      </div>
      <div class="px-3 sm:px-6 py-4">
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

<style scoped>
.commit-flash {
  animation: commitPulse 1.5s ease-out;
}

@keyframes commitPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
    border-color: rgba(74, 222, 128, 0.8);
  }
  20% {
    box-shadow: 0 0 20px 4px rgba(74, 222, 128, 0.4);
    border-color: rgba(74, 222, 128, 0.6);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
    border-color: transparent;
  }
}
</style>

<route>
  {
    meta: {
      i18n: 'consensus',
    }
  }
</route>
