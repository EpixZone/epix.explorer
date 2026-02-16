<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { controlledComputed } from '@vueuse/core';

interface Props {
  title: string;
  color?: string;
  icon: string;
  stats: string;
  change?: number;
  subtitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
});

const isPositive = controlledComputed(
  () => props.change,
  () => Math.sign(props.change || 0) === 1
);
</script>

<template>
  <div class="modern-card p-6 hover-lift group">
    <div class="flex items-center justify-between mb-4">
      <div
        v-if="props.icon"
        class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center bg-epix-primary"
      >
        <Icon :icon="props.icon" size="24" class="text-white" />
      </div>

      <div
        v-if="props.change"
        :class="isPositive ? 'text-green-500 bg-green-50 dark:bg-green-900/20' : 'text-red-500 bg-red-50 dark:bg-red-900/20'"
        class="flex items-center text-sm font-semibold px-3 py-1 rounded-full"
      >
        <Icon :icon="isPositive ? 'mdi-trending-up' : 'mdi-trending-down'" class="mr-1" />
        <span>{{ isPositive ? `+${props.change}` : props.change }}%</span>
      </div>
    </div>

    <div class="space-y-2">
      <h6 class="text-2xl font-bold text-gray-900 dark:text-white group-hover:gradient-text transition-all duration-300">
        {{ props.stats || '-' }}
      </h6>
      <p class="text-sm text-gray-600 dark:text-gray-400 font-medium">
        {{ props.title }}
      </p>

      <div v-if="props.subtitle" class="text-xs text-gray-500 dark:text-gray-500 font-medium">
        <span class="truncate">{{ props.subtitle }}</span>
      </div>
    </div>
  </div>
</template>
