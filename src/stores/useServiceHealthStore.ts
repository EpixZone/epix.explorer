import { defineStore } from 'pinia';
import {
  activityHealth, loadActivityPage, loadOperatorList, serviceIndicator,
  type CompoundOperator, type ServiceCheck, type ServiceIndicator,
} from '@/libs/autocompound';

// Which validators advertise an auto-compound service and whether that service
// is observed running (latest transactions of its service account). Shared by
// the staking list; results are cached for five minutes per endpoint.
const FRESH_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;
const PAGE_SIZE = 10;

let controller: AbortController | undefined;
let generation = 0;

type StoredCheck = ServiceCheck & { checkedAt: number };

export const useServiceHealthStore = defineStore('serviceHealthStore', {
  state: () => ({
    operators: {} as Record<string, CompoundOperator>, // keyed by validator operator address
    checks: {} as Record<string, StoredCheck>, // keyed by service account (grantee)
    source: '' as '' | 'directory' | 'bundled',
    endpoint: '',
    loadedAt: 0,
    loading: false,
    error: '',
    now: Date.now(),
  }),
  getters: {
    offeredCount(state): number {
      return Object.keys(state.operators).length;
    },
    indicator(state) {
      return (validator: string): ServiceIndicator | null => {
        const operator = state.operators[validator];
        if (!operator) return null;
        return serviceIndicator(operator, state.checks[operator.grantee], state.now);
      };
    },
  },
  actions: {
    async ensureLoaded(endpoint: string) {
      if (!endpoint) return;
      this.now = Date.now();
      if (this.endpoint === endpoint && this.loadedAt && Date.now() - this.loadedAt < FRESH_MS) return;
      if (this.loading && this.endpoint === endpoint) return;
      await this.refresh(endpoint);
    },
    async refresh(endpoint: string) {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const run = ++generation;
      this.loading = true;
      this.error = '';
      this.endpoint = endpoint;
      try {
        const baseURI = typeof document !== 'undefined' ? document.baseURI : 'https://localhost/';
        const list = await loadOperatorList(baseURI, request.signal);
        if (run !== generation) return;
        const operators: Record<string, CompoundOperator> = {};
        for (const operator of list.operators) operators[operator.validator] = operator;
        this.operators = operators;
        this.source = list.source;
        this.loadedAt = Date.now();
        const queue = list.operators.filter(operator => {
          const check = this.checks[operator.grantee];
          return !check || check.state === 'loading' || check.state === 'unknown' || Date.now() - check.checkedAt >= FRESH_MS;
        });
        for (const operator of queue) this.checks[operator.grantee] = { state: 'loading', lastRun: null, txCount: null, checkedAt: 0 };
        const worker = async () => {
          while (queue.length) {
            const operator = queue.shift();
            if (!operator) return;
            try {
              const page = await loadActivityPage(endpoint, operator, request.signal, '', PAGE_SIZE);
              if (run !== generation) return;
              const lastRun = page.activity?.timestamp ?? null;
              const health = activityHealth(lastRun, page.txCount, operator.schedule, Date.now());
              this.checks[operator.grantee] = { state: health.state, lastRun, txCount: page.txCount, checkedAt: Date.now() };
            } catch {
              if (run !== generation) return;
              this.checks[operator.grantee] = { state: 'unknown', lastRun: null, txCount: null, checkedAt: Date.now() };
            }
            this.now = Date.now();
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      } catch (error) {
        if (run === generation) this.error = error instanceof Error ? error.message : 'Registry unavailable';
      } finally {
        if (run === generation) {
          this.loading = false;
          this.now = Date.now();
        }
      }
    },
  },
});
