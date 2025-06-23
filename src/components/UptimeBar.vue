<script lang="ts" setup>
import type { PropType } from 'vue';

const props = defineProps({
  blocks: { type: Array as PropType<{height:string, color: string}[]> },
});

// Convert old color classes to matrix-style colors
function getMatrixColor(color: string) {
  switch (color) {
    case 'bg-green-500':
      return 'matrix-committed';
    case 'bg-yellow-500':
      return 'matrix-precommitted';
    case 'bg-red-500':
      return 'matrix-missed';
    default:
      return 'matrix-missed';
  }
}

</script>
<template>
  <div class="flex gap-px w-full justify-center overflow-hidden">
    <div class="cursor-default" v-for="(item, index) in blocks" :key="index">
      <div class="tooltip matrix-block"
          :data-tip="`Block ${item.height}`"
          :class="getMatrixColor(item.color)"
      >
        &nbsp;
      </div>
    </div>
  </div>
</template>

<style scoped>
.matrix-block {
  width: 6px;
  height: 26px;
  border-radius: 0;
  position: relative;
}

/* Mobile responsive adjustments for blocks */
@media (max-width: 640px) {
  .matrix-block {
    width: 6px;
    height: 24px;
  }
}

@media (max-width: 480px) {
  .matrix-block {
    width: 5px;
    height: 22px;
  }
}

.matrix-committed {
  background: #10b981;
  border: 1px solid #059669;
}

.matrix-precommitted {
  background: #f59e0b;
  border: 1px solid #d97706;
}

.matrix-missed {
  background: #ef4444;
  border: 1px solid #dc2626;
}

/* Dark mode - modern matrix blocks */
.dark .matrix-committed {
  background: #34d399;
  border: 1px solid #10b981;
}

.dark .matrix-precommitted {
  background: #fbbf24;
  border: 1px solid #f59e0b;
}

.dark .matrix-missed {
  background: #f87171;
  border: 1px solid #ef4444;
}


</style>
