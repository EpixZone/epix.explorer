<script lang="ts" setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { fromHex, toBase64, fromBase64, toHex } from '@cosmjs/encoding';
import {
  useStakingStore,
  useBaseStore,
  useBlockchain,
  useFormatter,
} from '@/stores';
import UptimeBar from '@/components/UptimeBar.vue';
import type { SlashingParam, SigningInfo, Block } from '@/types';
import { consensusPubkeyToHexAddress, valconsToBase64 } from '@/libs';

const props = defineProps(['chain']);

const stakingStore = useStakingStore();
const format = useFormatter();
const baseStore = useBaseStore();
const chainStore = useBlockchain();
const latest = ref(0);
const keyword = ref('');
const live = ref(true);
const slashingParam = ref({} as SlashingParam);
const signingInfo = ref({} as Record<string, SigningInfo>);
const consumerValidators = ref([] as {moniker: string, base64: string}[]);

// Avatar functionality
const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});

interface BlockColor {
  height: string;
  color: string;
}
interface ValidatorUnit {
  moniker: string;
  blocks: BlockColor[];
  hex: string;
  base64: string;
  missed_blocks_counter: number | string;
  uptime: number;
  signing: SigningInfo;
}

function padding(blocks: BlockColor[] = []) {
  const raw = Array(50).fill({ height: "0", color: 'bg-secondary' } as BlockColor).concat(blocks)
  return raw.slice(raw.length - 50);
}

const validatorSet = computed(() => {
  if (chainStore.isConsumerChain) {
    return consumerValidators.value.map((v) => {
      const b64 = valconsToBase64(v.moniker)
      const moniker = stakingStore.validators.find((x) => toBase64(fromHex(consensusPubkeyToHexAddress(x.consensus_pubkey))) === b64)?.description.moniker;
      return {
        moniker: moniker || v.moniker,
        base64: v.base64
      };
    });
  }; 
  return stakingStore.validators.map((v) => {
    const hex = consensusPubkeyToHexAddress(v.consensus_pubkey)
    return {
      moniker: v.description.moniker,
      base64: toBase64(fromHex(hex))
    };
  });
});

const blockColors = ref({} as Record<string, BlockColor[]>);

const grid = computed(() => {

  const validators = keyword.value.length === 0 ? validatorSet.value :
    validatorSet.value.filter((v) => v.moniker.toLowerCase().includes(keyword.value.toLowerCase()));

  const window = Number(slashingParam.value.signed_blocks_window || 0);
  return validators.map((v) => {
    const signing = signingInfo.value[v.base64];
    const uptime = signing && window > 0
      ? (window - Number(signing.missed_blocks_counter)) / window
      : undefined
    return {
      moniker: v.moniker,
      base64: v.base64,
      blocks: padding(blockColors.value[v.base64] || []),
      uptime,
      missed_blocks_counter: signing?.missed_blocks_counter,
      signing
    } as ValidatorUnit;
  })
});

const preload = ref(false);
baseStore.$subscribe((_, state) => {
  const newHeight = Number(state.latest?.block?.header?.height || 0)
  if (newHeight > latest.value) {
    latest.value = newHeight;
    // initialize if it's the first time
    if(!preload.value) {
      preFill();
      preload.value = true;
    }

    // reset the consumer validators
    if (newHeight > 0 && consumerValidators.value.length === 0) {
      const chain_id = state.latest.block.header.chain_id;
      Promise.resolve().then(async () =>{
        await stakingStore.getConsumerValidators(chain_id).then((x) => {
        x.validators.sort((a,b) => Number(b.power)-Number(a.power)).forEach(v => {
          const base64 = toBase64(fromHex(consensusPubkeyToHexAddress({"@type": "/cosmos.crypto.ed25519.PubKey", key: v.consumer_key.ed25519 })));
          const moniker = v.provider_address;
          consumerValidators.value.push({ moniker, base64});
        });

      });
      }) 
    }
    
    if (Number(state.latest.block.header.height) % 7 === 0) updateTotalSigningInfo();
    fillblock(state.latest);
  }
});

onMounted(() => {
  live.value = true;

  // fill the recent blocks
  baseStore.recents?.forEach((b) => {
    fillblock(b, 'start');
  });

  updateTotalSigningInfo();

  chainStore.rpc.getSlashingParams().then((x) => {
    slashingParam.value = x.params;
  });
});

function preFill() {

  if(latest.value > 50 && baseStore.recents.length >= 49 ) return
  // preload 50 blocks if recent blocks are not enough
  let promise = Promise.resolve();
  for (let i = latest.value - baseStore.recents.length; i > latest.value - 50 && i > 1; i -= 1) {
    promise = promise.then(() =>
      new Promise((resolve) => {
        if (live.value) {
          // continue only if the page is living
          if (i > latest.value - 50)
            baseStore.fetchBlock(i).then((x) => {
              fillblock(x, 'start');
              resolve();
            });
        }
      })
    );
  }
}
function fillblock(b: Block, direction: string = 'end') {
  validatorSet.value.forEach((v) => {
    const sig = b.block.last_commit?.signatures.find((s) => s.validator_address === v.base64)
    const block = blockColors.value[v.base64] || [];
    let color = {
      height: b.block.header.height,
      color: 'bg-red-500'
    }
    if (sig) {
      color = {
        height: b.block.header.height,
        color: sig.block_id_flag === 'BLOCK_ID_FLAG_COMMIT' ? 'bg-green-500' : 'bg-yellow-500'
      }
    }
    if (direction === 'end') {
      block.push(color);
    } else {
      block.unshift(color);
    }
    if (block.length > 50) block.shift();
    blockColors.value[v.base64] = block;
  });
}

function updateTotalSigningInfo() {
  chainStore.rpc.getSlashingSigningInfos().then((x) => {
    x.info?.forEach((i) => {
      signingInfo.value[valconsToBase64(i.address)] = i;
    });
  });
}

onUnmounted(() => {
  live.value = false;
});

//const tab = ref(window.location.hash.search("block")>-1?"2":"3")
const tab = ref('2');
function changeTab(v: string) {
  tab.value = v;
}

// Avatar functions
const logo = (identity?: string) => {
  if (!identity || !avatars.value[identity]) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const fetchAvatar = (identity: string) => {
  return new Promise<void>((resolve) => {
    stakingStore
      .keybase(identity)
      .then((d) => {
        if (Array.isArray(d.them) && d.them.length > 0) {
          const uri = String(d.them[0]?.pictures?.primary?.url).replace(
            'https://s3.amazonaws.com/keybase_processed_uploads/',
            ''
          );
          avatars.value[identity] = uri;
          resolve();
        } else throw new Error(`failed to fetch avatar for ${identity}`);
      })
      .catch((error) => {
        resolve();
      });
  });
};

const loadAvatar = (identity: string) => {
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

// Get validator identity from moniker
const getValidatorIdentity = (moniker: string) => {
  const validator = stakingStore.validators.find(v => v.description.moniker === moniker);
  return validator?.description?.identity;
};

</script>

<template>
  <div>
    <div class="tabs tabs-boxed bg-transparent mb-4">
      <a class="tab text-gray-400 capitalize" :class="{ 'tab-active': tab === '3' }" @click="changeTab('3')">{{
        $t('uptime.overall') }}</a>
      <a class="tab text-gray-400 capitalize" :class="{ 'tab-active': tab === '2' }" @click="changeTab('2')">{{
        $t('module.blocks') }}</a>
      <RouterLink :to="`/${chain}/uptime/customize`">
        <a class="tab text-gray-400 capitalize">{{ $t('uptime.customize') }}</a>
      </RouterLink>
    </div>
    <div class="modern-card px-5 pt-5 shadow-modern">
      <div class="flex items-center gap-x-4">
        <input type="text" v-model="keyword" placeholder="Keywords to filter validators"
          class="modern-input px-3 py-2 w-full flex-1" />
      </div>

      <!-- Matrix-style uptime visualization -->
      <div :class="tab === '2' ? '' : 'hidden'">
        <div class="flex flex-row flex-wrap gap-4 mt-4 justify-center px-2 sm:px-0">
          <div v-for="(unit, i) in grid" :key="i" class="matrix-validator-card relative">
            <div class="flex justify-between items-center py-2 w-full px-2 sm:px-2 rounded-t-lg bg-black dark:bg-black">
              <div class="flex items-center gap-2 truncate text-sm flex-1">
                <!-- Validator Avatar next to name -->
                <div
                  v-if="getValidatorIdentity(unit.moniker)"
                  class="w-5 h-5 rounded-full overflow-hidden bg-gray-800 border border-green-500/30 flex-shrink-0">
                  <img
                    v-if="logo(getValidatorIdentity(unit.moniker))"
                    :src="logo(getValidatorIdentity(unit.moniker))"
                    :alt="`${unit.moniker} avatar`"
                    class="w-full h-full object-cover"
                    @error="() => {
                      const identity = getValidatorIdentity(unit.moniker);
                      if (identity) loadAvatar(identity);
                    }"
                  />
                </div>
                <span class="text-green-400 font-mono truncate">{{ i + 1 }}.{{ unit.moniker }}</span>
              </div>

              <!-- Missed blocks counter in header -->
              <div>
                <div v-if="Number(unit?.missed_blocks_counter || 0) > 10"
                  class="px-1.5 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400 font-mono border border-red-500/30">
                  {{ unit?.missed_blocks_counter }}
                </div>
                <div v-else class="px-1.5 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 font-mono border border-green-500/30">
                  {{ unit?.missed_blocks_counter }}
                </div>
              </div>
            </div>
            <div class="bg-black dark:bg-black p-4 sm:p-4 rounded-b-lg border border-green-500/20 w-full">
              <UptimeBar :blocks="unit.blocks" />
            </div>
          </div>
        </div>
        <div class="mt-5 text-xs flex flex-wrap justify-center gap-2 sm:gap-4 font-mono px-2">
          <span class="font-bold text-gray-900 dark:text-green-400">{{ $t('uptime.legend') }}: </span>
          <span class="flex items-center gap-1">
            <span class="w-3 h-3 bg-green-400 rounded-sm shadow-sm shadow-green-400/50">&nbsp;</span>
            <span class="text-gray-700 dark:text-green-300">{{ $t('uptime.committed') }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="w-3 h-3 bg-yellow-400 rounded-sm shadow-sm shadow-yellow-400/50">&nbsp;</span>
            <span class="text-gray-700 dark:text-yellow-300">{{ $t('uptime.precommitted') }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="w-3 h-3 bg-red-400 rounded-sm shadow-sm shadow-red-400/50">&nbsp;</span>
            <span class="text-gray-700 dark:text-red-300">{{ $t('uptime.missed') }}</span>
          </span>
        </div>
      </div>

      <div :class="tab === '3' ? '' : 'hidden'" class="overflow-x-auto">
        <table class="w-full mt-5 bg-white dark:bg-epix-gray rounded-lg border border-gray-200 dark:border-gray-700">
          <thead class="capitalize bg-gray-50 dark:bg-epix-gray-light">
            <tr>
              <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('account.validator') }}</th>
              <th class="text-right py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('module.uptime') }}</th>
              <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.last_jailed_time') }}</th>
              <th class="text-right py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.signed_precommits') }}</th>
              <th class="text-right py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.start_height') }}</th>
              <th class="text-left py-3 px-4 text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('uptime.tombstoned') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(v, i) in grid" :key="i" class="hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200 border-b border-gray-100 dark:border-gray-800">
              <td class="py-3 px-4">
                <div class="truncate max-w-sm text-gray-900 dark:text-white font-mono">
                  {{ i + 1 }}. {{ v.moniker }}
                </div>
              </td>
              <td class="text-right py-3 px-4">
                <span :class="v.uptime && v.uptime > 0.95 ? 'text-green-400 dark:text-green-400' : 'text-red-400 dark:text-red-400'" class="font-mono">
                  <div class="tooltip" :data-tip="`${v.missed_blocks_counter} missing blocks`">
                    {{ format.percent(v.uptime) }}
                  </div>
                </span>
              </td>
              <td class="py-3 px-4">
                <span v-if="v.signing && !v.signing.jailed_until.startsWith('1970')" class="text-gray-900 dark:text-white">
                  <div class="tooltip" :data-tip="format.toDay(v.signing.jailed_until, 'long')">
                    <span>{{ format.toDay(v.signing.jailed_until, 'from') }}</span>
                  </div>
                </span>
              </td>
              <td class="text-xs text-right py-3 px-4 text-gray-900 dark:text-white font-mono">
                <span v-if="v.signing && v.signing.jailed_until.startsWith('1970')" class="text-right">{{
          format.percent(
            Number(v.signing.index_offset) /
            (latest - Number(v.signing.start_height))
          )
        }}</span>
                {{ v.signing?.index_offset }}
              </td>
              <td class="text-right py-3 px-4 text-gray-900 dark:text-white font-mono">{{ v.signing?.start_height }}</td>
              <td class="capitalize py-3 px-4 text-gray-900 dark:text-white">{{ v.signing?.tombstoned }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="text-right py-3 px-4 text-gray-700 dark:text-gray-300">
                {{ $t('uptime.minimum_uptime') }}:
                <span class="lowercase tooltip" :data-tip="`Window size: ${slashingParam.signed_blocks_window}`">
                  <span class="ml-2 px-2 py-1 text-xs rounded-full bg-red-500/20 text-red-400 border border-red-500/30">{{
          format.percent(slashingParam.min_signed_per_window)
                  }}</span>
                </span>
              </td>
              <td colspan="4"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="h-6"></div>
    </div>
  </div>
</template>
<route>
  {
    meta: {
      i18n: 'uptime',
      order: 8
    }
  }
</route>

<style lang="scss">
.v-field--variant-outlined .v-field__outline__notch {
  border-width: 0 !important;
}

/* Matrix-style validator cards */
.matrix-validator-card {
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  width: 100%;
  max-width: 380px;
  min-width: 280px;
}

/* Mobile responsive adjustments */
@media (max-width: 640px) {
  .matrix-validator-card {
    min-width: 100%;
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .matrix-validator-card {
    min-width: calc(100vw - 2rem);
    max-width: calc(100vw - 2rem);
  }
}

.matrix-validator-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.5), transparent);
  animation: matrix-scan 3s ease-in-out infinite;
}

@keyframes matrix-scan {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

/* Dark mode matrix effects */
.dark .matrix-validator-card {
  background: linear-gradient(145deg, rgba(0, 0, 0, 0.6), rgba(26, 26, 26, 0.8));
  border: 1px solid rgba(34, 197, 94, 0.2);
}
</style>
