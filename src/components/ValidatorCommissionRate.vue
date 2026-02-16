<script setup lang="ts">
import ApexCharts from 'vue3-apexcharts';
import { computed, type PropType } from 'vue';
import { useFormatter } from '@/stores';
import type { CommissionRate } from '@/types';

const props = defineProps({
  commission: { type: Object as PropType<CommissionRate> },
});

let rate = computed(() => Number(props.commission?.commission_rates.rate || 0) * 100);
let change = computed(() => Number(props.commission?.commission_rates.max_change_rate || 0) * 100);
let max = computed(() => Number(props.commission?.commission_rates.max_rate || 1) * 100);

const left = rate;
const right = computed(() => max.value - rate.value);

const s1 = computed(() => (left.value > change.value ? left.value - change.value : 0));
const s2 = computed(() => (left.value > change.value ? change.value : left.value));
const s3 = 2;
const s4 = computed(() => (right.value > change.value ? change.value : right.value));
const s5 = computed(() => (right.value > change.value ? right.value - change.value : 0));

const series = computed(() => [s1.value, s2.value, s3, s4.value, s5.value]);

const format = useFormatter();

const chartConfig = computed(() => {
  const secondaryText = `hsl(var(--bc))`;
  const primaryText = `hsl(var(--bc))`;

  return {
    chart: {
      width: '200px',
      sparkline: { enabled: false },
    },
    colors: [
      'rgba(109,120,141,0.2)',
      'rgba(114,225,40,0.2)',
      'rgba(114,225,40,1)',
      'rgba(114,225,40,0.2)',
      'rgba(109,120,141,0.2)',
    ],
    legend: { show: false },
    tooltip: { enabled: false },
    dataLabels: { enabled: false },
    stroke: {
      width: 3,
      lineCap: 'round',
      colors: ['hsl(var(--b1))'],
    },
    labels: ['Available', 'Daily Change', 'Commission Rate', 'Daily Change', 'Available'],
    states: {
      hover: {
        filter: { type: 'none' },
      },
      active: {
        filter: { type: 'none' },
      },
    },
    plotOptions: {
      pie: {
        endAngle: 130,
        startAngle: -130,
        customScale: 0.9,
        donut: {
          size: '83%',
          labels: {
            show: true,
            name: {
              offsetY: 25,
              fontSize: '1rem',
              color: secondaryText,
            },
            value: {
              offsetY: -15,
              fontWeight: 500,
              fontSize: '2.125rem',
              formatter: (value: unknown) => `${rate.value.toFixed(1)}%`,
              color: primaryText,
            },
            total: {
              show: true,
              label: 'Commission Rate',
              fontSize: '1rem',
              color: secondaryText,
              formatter: () => `${rate.value.toFixed(1)}%`,
            },
          },
        },
      },
    },
    responsive: [
      {
        breakpoint: 1709,
        options: {
          chart: { height: 237 },
        },
      },
    ],
  };
});
</script>

<template>
    <div class="modern-card p-6 hover-lift">
        <div class="text-xl font-bold text-gray-900 dark:text-white mb-2">Commission Rate</div>
        <div class="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {{ `Updated at ${format.toDay(props.commission?.update_time, 'short')}` }}
        </div>
        <div class="w-80 m-auto mb-6">
            <ApexCharts type="donut" :options="chartConfig" :series="series" />
        </div>
        <div>
            <div class="flex items-center justify-center flex-wrap gap-x-4 gap-y-2">
                <div class="flex items-center gap-x-2">
                    <div class="bg-epix-primary w-3 h-3 rounded-full"></div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Rate: {{ rate.toFixed(0) }}%</span>
                </div>
                <div class="flex items-center gap-x-2">
                    <div class="bg-epix-primary w-3 h-3 rounded-full opacity-60"></div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">24h: &#177;{{ change }}%</span>
                </div>
                <div class="flex items-center gap-x-2">
                    <div class="bg-epix-secondary w-3 h-3 rounded-full"></div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Max: {{ max }}%</span>
                </div>
            </div>
        </div>
    </div>
</template>
