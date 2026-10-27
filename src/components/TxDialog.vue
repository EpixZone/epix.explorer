<script lang="ts" setup>
import { onBeforeUnmount, watch } from 'vue';
import { useTxDialog, useBlockchain, useWalletStore } from '@/stores';
const store = useTxDialog();
const chainStore = useBlockchain();
const wallet = useWalletStore();
onBeforeUnmount(() => { store.openRequest = 0; store.closed(); });
watch(() => [wallet.currentAddress, chainStore.endpoint?.address, chainStore.current?.chainId], () => {
  if (store.type === 'autocompound' || store.type === 'autocompound_revoke') {
    // Clearing the signer invalidates the widget's pending confirmation.
    store.sender = '';
  }
});
// The widget keeps a hidden modal-toggle checkbox in light DOM for label
// consumers; a toggle to unchecked is also a close, which covers widget
// builds that predate the `closed` event.
function onChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (target && target.type === 'checkbox' && target.classList.contains('modal-toggle') && !target.checked) {
    store.closed();
  }
}
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
    @submited="store.submitted"
    @confirmed="store.confirmed"
    @closed="store.closed"
    @change="onChange"
  ></ping-tx-dialog>
</template>
