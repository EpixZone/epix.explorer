<script lang="ts" setup>
import { computed } from 'vue';
import DynamicComponent from './DynamicComponent.vue';

const props = defineProps({
  value: { type: null as any },
  thead: {
    type: Boolean,
    default: true,
  },
});

const header = computed(() => {
  if (props.value && props.value.length > 0) {
    return Object.keys(props.value[0]);
  }
  return [];
});
</script>
<template>
  <div class="overflow-auto max-h-96">
    <table class="table table-xs table-compact table-pin-rows w-full text-gray-900 dark:text-white">
      <thead v-if="thead">
        <tr>
          <th
            v-for="(item, index) in header"
            :key="index"
            class="text-left capitalize text-gray-600 dark:text-gray-400 font-medium"
          >
            {{ item.replace(/_/g, ' ') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in value" :key="index" class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-200">
          <td v-for="(el, key) in header" :key="key" class="text-sm">
            <DynamicComponent :value="item[el]" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
