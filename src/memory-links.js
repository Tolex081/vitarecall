// Walrus Scan indexes blob metadata; this opens the full mainnet blob ID,
// not the relayer job ID and not a transaction digest.
export const blobExplorerUrl = id => `https://walruscan.com/mainnet/blob/${encodeURIComponent(id)}`;
