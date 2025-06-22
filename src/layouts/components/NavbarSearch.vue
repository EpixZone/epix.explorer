<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useBlockchain } from '@/stores';
const vueRouters = useRouter();
const blockStore = useBlockchain();
let searchModalShow = ref(false);
let searchQuery = ref('');
let errorMessage = ref('');
onMounted(() => {});

function closeSearchModal() {
  searchModalShow.value = false;
}
function openSearchModal() {
  searchModalShow.value = true;
}

function preventClick(event: any) {
  event.preventDefault();
  event.stopPropagation();
}
function confirm() {
  errorMessage.value = '';
  const key = searchQuery.value;
  if (!key) {
    errorMessage.value = 'Please enter a value!';
    return;
  }
  const height = /^\d+$/;
  const txhash = /^[A-Z\d]{64}$/;
  const addr = /^[a-z\d]+1[a-z\d]{38,58}$/;

  const current = blockStore?.current?.chainName || '';
  const routeParams = vueRouters?.currentRoute?.value;

  if (!Object.values(routeParams?.params).includes(key)) {
    if (height.test(key)) {
      vueRouters.push({ path: `/${current}/block/${key}` });
      setTimeout(() => {
        closeSearchModal();
      }, 1000);
    } else if (txhash.test(key)) {
      vueRouters.push({ path: `/${current}/tx/${key}` });
      setTimeout(() => {
        closeSearchModal();
      }, 1000);
      //     this.$router.push({ name: 'transaction', params: { chain: c.chain_name, hash: key } })
    } else if (addr.test(key)) {
      vueRouters.push({ path: `/${current}/account/${key}` });
      setTimeout(() => {
        closeSearchModal();
      }, 1000);
    } else {
      errorMessage.value = 'The input not recognized';
    }
  }
}
</script>
<template>
  <div>
    <button
      class="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover-lift"
      @click="openSearchModal"
    >
      <Icon
        icon="mdi:magnify"
        class="text-xl text-gray-600 dark:text-gray-400 hover:text-epix-primary transition-colors duration-200"
      />
    </button>

    <!-- modal -->
    <div
      v-if="searchModalShow"
      class="cursor-pointer modal !pointer-events-auto !opacity-100 !visible bg-black/50 backdrop-blur-sm"
      @click="closeSearchModal"
    >
      <div
        class="relative modern-card max-w-lg w-full mx-4 cursor-default"
        @click="(event) => preventClick(event)"
      >
        <!-- header -->
        <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div
            class="text-xl font-bold flex flex-col md:!flex-row justify-between items-baseline"
          >
            <span class="mr-2 text-gray-900 dark:text-white">Search</span>
            <span class="text-sm text-gray-600 dark:text-gray-400 font-normal"
              >Height/Transaction/Account Address</span
            >
          </div>
          <button
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors duration-200"
            @click="closeSearchModal"
          >
            <Icon
              icon="mdi:close"
              class="text-xl text-gray-500 dark:text-gray-400"
            />
          </button>
        </div>
        <!-- body -->
        <div class="p-6">
          <div class="">
            <input
              class="modern-input w-full px-4 py-3 text-base"
              v-model="searchQuery"
              placeholder="Enter height, transaction hash, or account address"
            />
            <div
              class="mt-3 text-right text-sm text-red-500 font-medium"
              v-show="errorMessage"
            >
              {{ errorMessage }}
            </div>
          </div>
        </div>
        <!-- foot -->
        <div class="p-6 pt-0">
          <button class="modern-button w-full px-6 py-3" @click="confirm">
            Search
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
