<script lang="ts" setup>
import { useParamStore } from '@/stores';
import { ref, onMounted } from 'vue';
import CardParameter from '@/components/CardParameter.vue';
import ArrayObjectElement from '@/components/dynamic/ArrayObjectElement.vue';
const store = useParamStore();
const chain = ref(store.chain);
onMounted(() => {
  // fetch the data
  store.initial();
});
</script>
<template>
  <div class="overflow-hidden">
    <!-- Chain ID -->
    <div class="modern-card px-4 pt-3 pb-4 shadow-modern">
      <div class="text-base mb-3 text-gray-900 dark:text-white">{{ chain.title }}</div>
      <div
        class="grid grid-cols-2 md:!grid-cols-4 lg:!grid-cols-5 2xl:!grid-cols-6 gap-4"
      >
        <div
          v-for="(item, index) of chain.items"
          :key="index"
          class="rounded-lg bg-gray-50 dark:bg-epix-gray px-4 py-2 border border-gray-200 dark:border-gray-700"
        >
          <div class="text-xs mb-2 text-gray-600 dark:text-gray-400">{{ item.subtitle }}</div>
          <div class="text-base text-gray-900 dark:text-white">{{ item.value }}</div>
        </div>
      </div>
    </div>
    <!-- minting Parameters  -->
    <CardParameter :cardItem="store.mint" />
    <!-- Staking Parameters  -->
    <CardParameter :cardItem="store.staking" />
    <!-- Governance Parameters -->
    <CardParameter :cardItem="store.gov" />
    <!-- Distribution Parameters -->
    <CardParameter :cardItem="store.distribution" />
    <!-- Slashing Parameters -->
    <CardParameter :cardItem="store.slashing" />
    <!-- Application Version -->
    <div class="modern-card px-6 pt-4 pb-5 mt-6 shadow-modern">
      <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">{{ store.appVersion?.title }}</div>
      <ArrayObjectElement :value="store.appVersion?.items" :thead="false" />
    </div>

    <!-- Node Information -->
    <div class="modern-card px-6 pt-4 pb-5 mt-6 shadow-modern">
      <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">{{ store.nodeVersion?.title }}</div>
      <ArrayObjectElement :value="store.nodeVersion?.items" :thead="false" />
    </div>
  </div>
</template>

<route>
{
  meta: {
    i18n: 'parameters',
    order: 50
  }
}
</route>
