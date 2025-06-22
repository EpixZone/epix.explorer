<script lang="ts" setup>
import { useDashboard } from '@/stores/useDashboard';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
});

const dashboardStore = useDashboard();
const conf = computed(() => dashboardStore.chains[props.name] || {});

const addFavor = (e: Event) => {
  e.stopPropagation();
  e.preventDefault();
  dashboardStore.favoriteMap[props.name] =
    !dashboardStore?.favoriteMap?.[props.name];
  window.localStorage.setItem(
    'favoriteMap',
    JSON.stringify(dashboardStore.favoriteMap)
  );
};
</script>
<template>
  <RouterLink
    :to="`/${name}`"
    class="modern-card hover-lift group flex items-center px-5 py-4 cursor-pointer transition-all duration-300"
  >
    <div class="w-10 h-10 rounded-full overflow-hidden ring-2 ring-gray-200 dark:ring-gray-700 group-hover:ring-epix-primary transition-all duration-300">
      <img :src="conf.logo" alt="Chain logo" class="w-full h-full object-cover" />
    </div>
    <div class="font-semibold ml-4 text-base flex-1 truncate capitalize text-gray-900 dark:text-white group-hover:text-epix-primary transition-colors duration-300">
      {{ conf?.prettyName || props.name }}
    </div>
    <div
      @click="addFavor"
      class="pl-4 text-xl transition-all duration-300 hover:scale-110"
      :class="{
        'text-yellow-500': dashboardStore?.favoriteMap?.[props.name],
        'text-gray-300 dark:text-gray-500 hover:text-yellow-400':
          !dashboardStore?.favoriteMap?.[props.name],
      }"
    >
      <Icon icon="mdi-star" />
    </div>
  </RouterLink>
</template>
