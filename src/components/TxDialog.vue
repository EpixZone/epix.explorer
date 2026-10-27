<script lang="ts" setup>
import { onBeforeUnmount, watch } from 'vue';
import { useTxDialog, useBlockchain, useWalletStore } from '@/stores';
const store = useTxDialog();
const chainStore = useBlockchain();
const wallet = useWalletStore();
onBeforeUnmount(() => { store.openRequest = 0; });
watch(() => [wallet.currentAddress, chainStore.endpoint?.address, chainStore.current?.chainId], () => {
  if (store.type === 'autocompound' || store.type === 'autocompound_revoke') {
    // Clearing the signer invalidates the widget's pending confirmation.
    store.sender = '';
  }
});
</script>
<template>
  <ping-tx-dialog
    :type="store.type"
    :open-request="store.openRequest"
    :sender="store.sender"
    :endpoint="store.endpoint"
    :params="store.params"
    :hd-path="store.hdPaths"
    :registry-name="chainStore.chainName"
    @view="store.view"
    @confirmed="store.confirmed"
  ></ping-tx-dialog>
</template>
