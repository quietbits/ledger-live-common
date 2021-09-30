import memoize from "lodash/memoize";
import { useEffect, useState } from "react";
import { apiForCurrency, NFTMetadataOutput } from "../api/Ethereum";
import { CryptoCurrency, NFT, NFTWithMetadata } from "../types";

export const hydrateNfts = async (
  nfts: NFT[] = [],
  currency: CryptoCurrency
): Promise<NFTWithMetadata[]> => {
  const api = apiForCurrency(currency);

  const NFTMetadata: NFTMetadataOutput = await api.getNFTMetadata(
    nfts.map(({ collection: { contract }, tokenId }) => ({
      contract,
      tokenId,
    }))
  );

  return (nfts || []).map((nft: NFT) => {
    const md = NFTMetadata?.[nft.collection.contract]?.[nft.tokenId] ?? {};

    return {
      id: nft.id,
      tokenId: nft.tokenId,
      amount: nft.amount,
      nftName: md.nftName,
      picture: md.picture,
      description: md.description,
      properties: md.properties,
      collection: {
        contract: nft.collection.contract,
        standard: nft.collection.standard,
        tokenName: md.tokenName,
      },
    } as NFTWithMetadata;
  });
};

const memoizedHydateNfts = memoize(hydrateNfts);

export const useNfts = (
  nfts: NFT[],
  currency: CryptoCurrency
): NFTWithMetadata[] => {
  const [hydratedNfts, setHydratedNfts] = useState<NFTWithMetadata[]>([]);

  useEffect(() => {
    memoizedHydateNfts(nfts, currency).then(setHydratedNfts);
  }, [nfts, currency]);

  return hydratedNfts;
};
