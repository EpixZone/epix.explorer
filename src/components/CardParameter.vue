<script lang="ts" setup>
import type { PropType } from 'vue';
import { useFormatter } from '@/stores';
import { formatSeconds } from '@/libs/utils';
const props = defineProps({
  cardItem: {
    type: Object as PropType<{ title: string; items: Array<any> }>,
  },
});

const formatter = useFormatter();
function calculateValue(value: any) {
  if (Array.isArray(value)) {
    return (value[0] && value[0].amount) || '-';
  }
  if(String(value).search(/^\d+s$/g) > -1) {
    return formatSeconds(value)
  }
  const newValue = Number(value);
  if (`${newValue}` === 'NaN' || typeof value === 'boolean') {
    return value;
  }

  if (newValue < 1 && newValue > 0) {
    return formatter.formatDecimalToPercent(value);
  }
  return newValue;
}

function formatTitle(v: string) {
  if(!v) return ""
  return v.replace(/_/g, " ")
}
</script>
<template>
  <div
    class="modern-card px-6 pt-4 pb-5 mt-6"
    v-if="props.cardItem?.items && props.cardItem?.items?.length > 0"
  >
    <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">{{ props.cardItem?.title }}</div>
    <div
      class="grid grid-cols-2 md:!grid-cols-4 lg:!grid-cols-5 2xl:!grid-cols-6 gap-4"
    >
      <div
        v-for="(item, index) of props.cardItem?.items"
        :key="index"
        class="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
      >
        <div class="text-xs mb-2 text-gray-600 dark:text-gray-400 capitalize font-medium">{{ formatTitle(item?.subtitle) }}</div>
        <div class="text-base font-semibold text-gray-900 dark:text-white">{{ calculateValue(item?.value) }}</div>
      </div>
    </div>
  </div>
</template>
