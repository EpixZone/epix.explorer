<script lang="ts" setup>
import { watch } from 'vue';
import { useTxDialog, useBlockchain, useWalletStore } from '@/stores';
const store = useTxDialog();
const chainStore = useBlockchain();
const wallet = useWalletStore();
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
    :sender="store.sender"
    :endpoint="store.endpoint"
    :params="store.params"
    :hd-path="store.hdPaths"
    :registry-name="chainStore.chainName"
    @view="store.view"
    @confirmed="store.confirmed"
  ></ping-tx-dialog>
</template>
