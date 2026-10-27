import { defineStore } from 'pinia';
import { useWalletStore } from './useWalletStore';
import { useBlockchain } from './useBlockchain';
import router from '@/router';

let CALLBACK: any = null;
let OPEN_REQUEST = 0;

interface TxEvent {
  detail?: {
    eventType?: string;
    hash?: string;
  };
}

function phaseOf(phase: 'submitted' | 'confirmed', tx: TxEvent | undefined) {
  return { phase, hash: tx?.detail?.hash || '', eventType: tx?.detail?.eventType || '' };
}

export const useTxDialog = defineStore('txDialogStore', {
  state: () => {
    return {
      sender: '',
      type: 'send',
      endpoint: '',
      params: '',
      openRequest: 0,
      // True from openAndShow until the widget reports closed, view or confirmed.
      dialogOpen: false,
    };
  },
  getters: {
    walletAddress() {
      return useWalletStore().currentAddress;
    },
    currentEndpoint() {
      return useBlockchain().endpoint?.address;
    },
    blockchain() {
      return useBlockchain();
    },
    hdPaths() {
      return useBlockchain().defaultHDPath;
    },
  },
  actions: {
    setParams(param: any) {
      this.params = JSON.stringify(param);
    },
    openWithArgument(
      type: string,
      sender: string,
      endpoint: string,
      param: any
    ) {
      this.openRequest = 0;
      this.type = type;
      this.sender = sender;
      this.endpoint = endpoint;
      this.params = JSON.stringify(param);
    },
    open(type: string, param: any, callback?: Function) {
      this.openRequest = 0;
      this.type = type;
      this.sender = this.walletAddress;
      this.endpoint = this.currentEndpoint || '';
      this.params = JSON.stringify(param);
      if (callback) {
        CALLBACK = callback;
      } else {
        CALLBACK = undefined;
      }
    },
    openAndShow(type: string, param: any, callback?: Function) {
      this.open(type, param, callback);
      this.dialogOpen = true;
      // The widget opens after rendering these props, including its new type.
      this.openRequest = ++OPEN_REQUEST;
    },
    view(tx: {
      detail: {
        eventType: string;
        hash: string;
      };
    }) {
      console.log(tx.detail);
      this.dialogOpen = false;
      if (tx.detail && tx.detail.hash) router.push({ path: `/tx/${tx.detail.hash}` });
    },
    // The widget's `submited` event: the transaction was broadcast and is
    // awaiting confirmation. The callback receives the phase so pages can
    // show a pending state even if the dialog is closed early.
    submitted(tx: TxEvent) {
      if (CALLBACK) {
        CALLBACK(phaseOf('submitted', tx));
      }
    },
    confirmed(tx: TxEvent) {
      console.log('confirmed:', tx);
      this.dialogOpen = false;
      if (CALLBACK) {
        CALLBACK(phaseOf('confirmed', tx));
      }
    },
    closed() {
      this.dialogOpen = false;
    },
  },
});
