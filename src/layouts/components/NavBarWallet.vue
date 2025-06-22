<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useBaseStore, useBlockchain, useWalletStore } from '@/stores';
import { Icon } from '@iconify/vue';
import { ref, computed } from 'vue';

const route = useRoute();
const walletStore = useWalletStore();
const chainStore = useBlockchain();
const baseStore = useBaseStore();
// walletStore.$subscribe((m, s) => {
//   console.log(m, s);
// });
function walletStateChange(res: any) {
  walletStore.setConnectedWallet(res.detail?.value);
}
let showCopyToast = ref(0);
async function copyAdress(address: string) {
  try {
    await navigator.clipboard.writeText(address);
    showCopyToast.value = 1;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  } catch (err) {
    showCopyToast.value = 2;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  }
}
const tipMsg = computed(() => {
  return showCopyToast.value === 2
    ? { class: 'error', msg: 'Copy Error!' }
    : { class: 'success', msg: 'Copy Success!' };
});

const params = computed(() => {
  if (chainStore.chainName == 'side') {
    return JSON.stringify({
      wallet: ['okex', 'unisat'],
   });
  }
  return "";
});

</script>

<template>
  <div class="dropdown dropdown-hover dropdown-end">
    <label tabindex="0" class="modern-button inline-flex items-center cursor-pointer">
      <Icon icon="mdi:wallet" class="text-lg" />
      <span class="ml-2 hidden md:block">
        {{ walletStore.shortAddress || 'Connect Wallet' }}</span>
    </label>
    <div tabindex="0" class="dropdown-content menu shadow-modern-lg p-4 modern-card rounded-xl w-64 md:!w-72 overflow-auto mt-2">
      <label v-if="!walletStore?.currentAddress" for="PingConnectWallet" class="modern-button w-full cursor-pointer mb-4 flex items-center justify-center">
        <Icon icon="mdi:wallet" class="text-xl mr-2" /><span>Connect Wallet</span>
      </label>
      <div class="px-2 mb-3 text-gray-600 dark:text-gray-400 font-semibold text-sm">
        {{ walletStore.connectedWallet?.wallet }}
      </div>
      <div class="space-y-2">
        <a v-if="walletStore.currentAddress"
          class="block py-3 px-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer transition-colors duration-200 text-sm font-mono bg-gray-50 dark:bg-gray-800"
          style="overflow-wrap: anywhere" @click="copyAdress(walletStore.currentAddress)">
          {{ walletStore.currentAddress }}
        </a>
        <div v-if="walletStore.currentAddress" class="border-t border-gray-200 dark:border-gray-700 my-3"></div>
        <RouterLink to="/wallet/accounts">
          <div class="flex items-center py-3 px-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer transition-colors duration-200 text-sm font-medium">
            <div class="w-8 h-8 rounded-lg bg-epix-primary/10 flex items-center justify-center mr-3">
              <Icon icon="mdi:account-multiple" class="text-lg text-epix-primary" />
            </div>
            Accounts
          </div>
        </RouterLink>
        <RouterLink to="/wallet/portfolio">
          <div class="flex items-center py-3 px-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer transition-colors duration-200 text-sm font-medium">
            <div class="w-8 h-8 rounded-lg bg-epix-primary/10 flex items-center justify-center mr-3">
              <Icon icon="mdi:chart-pie" class="text-lg text-epix-primary" />
            </div>
            Portfolio
          </div>
        </RouterLink>
        <div v-if="walletStore.currentAddress" class="border-t border-gray-200 dark:border-gray-700 my-3"></div>
        <a v-if="walletStore.currentAddress"
          class="flex items-center py-3 px-3 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg cursor-pointer transition-colors duration-200 text-sm font-medium text-red-600 dark:text-red-400"
          @click="walletStore.disconnect()">
          <div class="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center mr-3">
            <Icon icon="mdi:logout" class="text-lg text-red-600 dark:text-red-400" />
          </div>
          Disconnect
        </a>
      </div>
    </div>
    <div class="toast" v-show="showCopyToast === 1">
      <div class="modern-card bg-green-500 text-white shadow-lg">
        <div class="text-sm font-medium p-4">
          <Icon icon="mdi:check-circle" class="mr-2" />
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
    <div class="toast" v-show="showCopyToast === 2">
      <div class="modern-card bg-red-500 text-white shadow-lg">
        <div class="text-sm font-medium p-4">
          <Icon icon="mdi:alert-circle" class="mr-2" />
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <ping-connect-wallet
      :chain-id="baseStore.currentChainId || 'cosmoshub-4'"
      :hd-path="chainStore.defaultHDPath"
      :addr-prefix="chainStore.current?.bech32Prefix || 'cosmos'"
      @connect="walletStateChange"
      @keplr-config="walletStore.suggestChain()"
      :params="params">
    </ping-connect-wallet>
  </Teleport>
</template>

<style>
.ping-connect-btn,
.ping-connect-dropdown {
  display: none !important;
}
</style>
