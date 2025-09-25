export interface TopHolder {
  address: string;
  liquid_balance: string;
  bonded_balance: string;
  unbonding_balance: string;
  total_balance: string;
  rank: number;
  module_tag: string;
}

export interface TopHoldersResponse {
  holders: TopHolder[];
  pagination: {
    next_key?: string;
    total?: string;
  };
  last_updated: number;
  block_height: number;
  total_count: number;
}

export interface CacheStatusResponse {
  is_cached: boolean;
  last_updated: number;
  block_height: number;
  total_count: number;
  cache_duration_seconds: number;
}
