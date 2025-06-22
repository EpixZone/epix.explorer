<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import {
  useDashboard,
  LoadingStatus,
  type ChainConfig,
} from '@/stores/useDashboard';
import ChainSummary from '@/components/ChainSummary.vue';

import { computed, onMounted, ref } from 'vue';
import { useBlockchain } from '@/stores';
import { useRouter } from 'vue-router';

const dashboard = useDashboard();
const router = useRouter();

// Automatically redirect to Epix dashboard
onMounted(async () => {
  // Wait for dashboard to load
  await dashboard.initial();
  // Redirect to Epix dashboard
  router.push('/epix');
});

const keywords = ref('');
const chains = computed(() => {
  if (keywords.value) {
    const lowercaseKeywords = keywords.value.toLowerCase();

    return Object.values(dashboard.chains).filter(
      (x: ChainConfig) => x.chainName.toLowerCase().indexOf(lowercaseKeywords) > -1
      || x.prettyName.toLowerCase().indexOf(lowercaseKeywords) > -1
    );
  } else {
    return Object.values(dashboard.chains);
  }
});

const featured = computed(() => {
  const names = ["cosmos", "osmosis", "akash", "celestia", "evmos", "injective", "dydx", "noble"];
  return chains.value
    .filter(x => names.includes(x.chainName))
    .sort((a, b)=> (names.indexOf(a.chainName) - names.indexOf(b.chainName)))
})

const chainStore = useBlockchain()

</script>
<template>
  <div class="min-h-screen">
    <!-- Hero Section -->
    <div class="relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br from-epix-primary/10 via-epix-secondary/5 to-epix-accent/10"></div>
      <div class="relative flex md:!flex-row flex-col items-center justify-center mb-12 mt-8 gap-6 px-4">
        <div class="relative group">
          <div class="w-24 h-24 rounded-full bg-gradient-to-br from-epix-primary to-epix-secondary p-1">
            <div class="w-full h-full rounded-full bg-white dark:bg-epix-dark flex items-center justify-center">
              <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 150.000000 132.000000"
                preserveAspectRatio="xMidYMid meet"
                class="w-16 h-16">
                <defs>
                  <linearGradient id="epixGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#8A4BDB;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#69E9F5;stop-opacity:1" />
                  </linearGradient>
                </defs>
                <g transform="translate(0.000000,132.000000) scale(0.100000,-0.100000)"
                fill="url(#epixGradient)" stroke="none">
                  <path d="M500 1310 l-125 -5 -182 -315 c-100 -173 -182 -321 -182 -329 -1 -7
                  81 -159 181 -337 l183 -324 372 0 371 0 186 325 c102 179 186 330 186 337 0 7
                  -82 157 -182 335 l-183 323 -250 -2 c-137 -1 -306 -5 -375 -8z m588 -454 c61
                  -106 112 -197 112 -201 0 -4 -50 -95 -111 -201 l-112 -194 -231 0 -231 0 -105
                  181 c-58 100 -109 190 -114 200 -6 14 17 63 104 213 l112 196 232 0 231 0 113
                  -194z"/>
                  <path d="M591 1001 l-54 -6 -87 -150 -88 -150 176 -3 c97 -1 181 -1 187 2 9 3
                  165 267 183 308 4 9 -233 7 -317 -1z"/>
                  <path d="M872 824 l-90 -159 36 -66 c113 -201 147 -258 153 -251 8 8 179 302
                  179 307 0 2 -37 68 -83 147 -46 78 -88 151 -94 162 -9 16 -24 -5 -101 -140z"/>
                  <path d="M360 625 c0 -7 148 -263 172 -297 l19 -28 186 0 c101 0 183 3 181 8
                  -1 4 -43 78 -93 165 l-90 157 -187 0 c-104 0 -188 -2 -188 -5z"/>
                </g>
              </svg>
            </div>
          </div>
        </div>
        <div class="text-center md:text-left">
          <h1 class="gradient-text text-4xl md:!text-6xl font-bold mb-4 leading-tight">
            {{ $t('pages.title') }}
          </h1>
          <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto md:mx-0">
            {{ $t('pages.slogan') }}
          </p>
        </div>
      </div>
    </div>
    <!-- Loading Progress -->
    <div
      v-if="dashboard.status !== LoadingStatus.Loaded"
      class="flex justify-center mt-8"
    >
      <div class="w-80 h-2 bg-gray-200 dark:bg-gray-700 rounded-sm overflow-hidden">
        <div class="h-full bg-gray-600 dark:bg-gray-400 rounded-sm"></div>
      </div>
    </div>

    <!-- Featured Blockchains -->
    <div v-if="featured.length>0" class="mt-16">
      <div class="text-center mb-8">
        <h2 class="text-2xl font-bold gradient-text mb-2">Featured Blockchains 🔥</h2>
        <p class="text-gray-600 dark:text-gray-400">Discover the most popular blockchain networks</p>
      </div>
      <div class="grid grid-cols-1 gap-6 md:!grid-cols-2 lg:!grid-cols-3 xl:!grid-cols-4 2xl:!grid-cols-5">
        <ChainSummary
          v-for="(chain, index) in featured"
          :key="index"
          :name="chain.chainName"
        />
      </div>
    </div>

    <!-- All Blockchains Section -->
    <div class="mt-16">
      <div class="text-center mb-8">
        <h2 class="text-2xl font-bold gradient-text mb-2">{{ $t('pages.description') }}</h2>
        <p class="text-gray-600 dark:text-gray-400">Explore all available blockchain networks</p>
      </div>

      <!-- Search Bar -->
      <div class="modern-card flex items-center p-4 mb-8 hover-lift">
        <Icon icon="mdi:magnify" class="text-2xl text-epix-primary mr-4"/>
        <input
          :placeholder="$t('pages.search_placeholder')"
          class="modern-input flex-1 px-4 py-3 text-base font-medium"
          v-model="keywords"
        />
        <div class="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg ml-4 hidden md:!block">
          {{ chains.length }}/{{ dashboard.length }}
        </div>
      </div>

      <!-- Blockchain Grid -->
      <div class="grid grid-cols-1 gap-6 md:!grid-cols-2 lg:!grid-cols-3 xl:!grid-cols-4 2xl:!grid-cols-5">
        <ChainSummary
          v-for="(chain, index) in chains"
          :key="index"
          :name="chain.chainName"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
 .logo path{
  fill: #171d30;
}
</style>
