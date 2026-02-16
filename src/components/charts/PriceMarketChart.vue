<script lang="ts" setup>
import ApexCharts from 'vue3-apexcharts';
import { getMarketPriceChartConfig } from './apexChartConfig';
import { useIndexModule } from '@/modules/[chain]/indexStore';
import { computed, ref } from 'vue';
import { useBaseStore } from '@/stores';

const store = useIndexModule();
const baseStore = useBaseStore();
const chartConfig = computed(() => {
  const theme = baseStore.theme;
  const labels = store.marketData.prices.map((item: any) => item[0]);
  return getMarketPriceChartConfig(theme, labels);
});
const kind = ref('price');
const series = computed(() => {
  return [
    {
      name: kind.value === 'price' ? 'Price' : 'Volume',
      data:
        kind.value === 'price'
          ? store.marketData.prices.map((item: any) => item[1])
          : store.marketData.total_volumes.map((item: any) => item[1]),
    },
  ];
});

const timeframes = [
    { label: '1H', days: 1/24 },
    { label: '1D', days: 1 },
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '1Y', days: 365 },
    { label: 'ALL', days: 9999 },
];

function changeChart(type: string) {
  kind.value = type;
}

function changeTimeframe(days: number) {
    store.setTimeframe(days);
}
</script>

<template>
    <div class="flex flex-wrap items-center justify-between">
        <div class="tabs tabs-boxed bg-transparent">
            <a
                v-for="tf in timeframes"
                :key="tf.label"
                class="tab tab-sm text-xs text-gray-400"
                :class="{ 'tab-active': store.days === tf.days }"
                @click="changeTimeframe(tf.days)"
            >
                {{ tf.label }}
            </a>
        </div>
        <div class="tabs tabs-boxed bg-transparent">
            <a
                class="tab tab-sm text-xs mr-2 text-gray-400 uppercase"
                :class="{ 'tab-active': kind === 'price' }"
                @click="changeChart('price')"
            >
                Price
            </a>
            <a
                class="tab tab-sm text-xs text-gray-400 uppercase"
                :class="{ 'tab-active': kind === 'volume' }"
                @click="changeChart('volume')"
            >
                Volume
            </a>
        </div>
    </div>
    <div class="relative">
        <div v-if="store.chartLoading" class="absolute inset-0 flex items-center justify-center z-10 bg-white/50 dark:bg-gray-900/50 rounded-lg">
            <span class="loading loading-spinner loading-md text-epix-teal"></span>
        </div>
        <ApexCharts
            type="area"
            height="230"
            :options="chartConfig"
            :series="series"
        />
    </div>
</template>
