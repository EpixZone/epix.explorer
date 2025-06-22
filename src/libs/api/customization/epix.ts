import { adapter, type RequestRegistry } from '../registry';

// which registry is store
export const store = 'name' // name or version
// Blockchain Name
export const name = 'epix';

// EPIX custom request
export const requests: Partial<RequestRegistry> = {
  mint_inflation: {
    url: '/epix/inflation/v1/inflation_rate',
    adapter: async (data: any): Promise<{ inflation: string }> => {
      try {
        // EPIX uses a custom inflation module with period/epoch-based inflation
        // The inflation_rate value is returned as a percentage (e.g., "12.06" for 12.06%)
        // Convert to decimal format by dividing by 100 (e.g., "12.06" -> "0.1206")
        const inflationRate = Number(data.inflation_rate || 0) / 100;
        return { inflation: inflationRate.toString() };
      } catch (error) {
        console.error('[EPIX Adapter] Error fetching inflation:', error);
        return { inflation: '0' };
      }
    },
  },
};
