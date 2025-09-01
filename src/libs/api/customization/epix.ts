import { adapter, type RequestRegistry } from '../registry';
import { CosmosRestClient } from '@/libs/client';
import { useBlockchain } from '@/stores';
import type {
  GovProposal,
  PaginatedProposals,
} from '@/types/';

// which registry is store
export const store = 'name' // name or version
// Blockchain Name
export const name = 'epix';

function proposalAdapter(p: any): GovProposal {
  if(p) {
      // EPIX has a different structure - title/summary at root level, messages array
      p.proposal_id = p.id;

      // Handle content - EPIX uses messages array instead of content
      if(p.messages && p.messages.length >= 1) {
        p.content = p.messages[0];
        // Also preserve title/summary from root level
        if (!p.content.title && p.title) p.content.title = p.title;
        if (!p.content.description && p.summary) p.content.description = p.summary;
      } else {
        // Fallback - create content from root level title/summary
        p.content = {
          '@type': 'unknown',
          title: p.title,
          description: p.summary
        };
      }

      // Handle tally result - EPIX uses different field names
      p.final_tally_result = {
          yes: p.final_tally_result?.yes_count || p.final_tally_result?.yes || '0',
          no: p.final_tally_result?.no_count || p.final_tally_result?.no || '0',
          no_with_veto: p.final_tally_result?.no_with_veto_count || p.final_tally_result?.no_with_veto || '0',
          abstain: p.final_tally_result?.abstain_count || p.final_tally_result?.abstain || '0',
      };
  }
  return p;
}

// EPIX custom request
export const requests: Partial<RequestRegistry> = {
  mint_inflation: {
    url: '/epix/mint/v1beta1/annual_provisions',
    adapter: async (data: any): Promise<{ inflation: string }> => {
      try {
        // Calculate inflation rate as annual_mint_amount / current_supply
        const annualProvisions = Number(data.annual_provisions || 0);

        // Fetch current supply from the new endpoint
        const client = CosmosRestClient.newDefault(useBlockchain().endpoint.address);
        const supplyResponse = await client.request({
          url: '/epix/mint/v1beta1/current_supply',
          adapter: (data: any) => data
        }, {}) as any;

        const currentSupply = Number(supplyResponse.current_supply || 0);

        if (currentSupply === 0) {
          console.warn('[EPIX Adapter] Current supply is 0, cannot calculate inflation');
          return { inflation: '0' };
        }

        // Calculate inflation rate as decimal (annual provisions / current supply)
        const inflationRate = annualProvisions / currentSupply;

        return { inflation: inflationRate.toString() };
      } catch (error) {
        console.error('[EPIX Adapter] Error calculating inflation:', error);
        return { inflation: '0' };
      }
    },
  },
  gov_params_voting: { url: '/cosmos/gov/v1/params/voting', adapter },
  gov_params_tally: { url: '/cosmos/gov/v1/params/tallying', adapter },
  gov_params_deposit: { url: '/cosmos/gov/v1/params/deposit', adapter },
  gov_proposals: {
    url: '/cosmos/gov/v1/proposals',
    adapter: async (source: any): Promise<PaginatedProposals> => {
      console.log('EPIX Gov Proposals API Response:', source);
      const proposals = source.proposals ? source.proposals.map((p:any) => proposalAdapter(p)) : [];
      console.log('EPIX Gov Proposals After Adapter:', proposals);
      return {
          proposals,
          pagination: source.pagination
      }
    }
  },
  gov_proposals_proposal_id: {
    url: '/cosmos/gov/v1/proposals/{proposal_id}',
    adapter: async (source: any): Promise<{proposal: GovProposal}> => {
        console.log('EPIX Single Proposal API Response:', source);
        const proposal = proposalAdapter(source.proposal);
        console.log('EPIX Single Proposal After Adapter:', proposal);
        return {
            proposal
        }
    },
  },
  gov_proposals_deposits: {
    url: '/cosmos/gov/v1/proposals/{proposal_id}/deposits',
    adapter,
  },
  gov_proposals_tally: {
    url: '/cosmos/gov/v1/proposals/{proposal_id}/tally',
    adapter,
  },
  gov_proposals_votes: {
    url: '/cosmos/gov/v1/proposals/{proposal_id}/votes',
    adapter,
  },
  gov_proposals_votes_voter: {
    url: '/cosmos/gov/v1/proposals/{proposal_id}/votes/{voter}',
    adapter,
  },
};
