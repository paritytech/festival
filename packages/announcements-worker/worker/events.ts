/**
 * Festival `Revive.ContractEmitted` topic constants + a pure classifier.
 *
 * `topics[0]` is keccak256("<name>(<argTypes>)") — static, so we hardcode it
 * like chain.ts hardcodes the 4-byte selectors. The watcher only needs to know
 * WHICH event fired (to decide what to refresh) and re-reads the on-chain
 * pointer for the value; it never decodes the payload. That keeps the worker
 * free of viem/descriptors.
 *
 * Regenerate with keccak_256 over the signature (e.g. `@noble/hashes/sha3`).
 */

export const EVENT_TOPIC = {
  /** ChannelMetadataUpdated(bytes32) — a new announcement was published. */
  channelMetadataUpdated: "0x6d8f038fc40f4e221a7ccc4c3c8d75ea5e9974ac3e5807526511c1a1341e5085",
  /** MetadataUpdated(bytes32) — festival metadata (schedule/venue) changed. */
  metadataUpdated: "0x6e27af24ead46b4b469e383b46b4b75487fcf1ffce54d216add332f9de2120c5",
  /** SessionCreated(address,address,bytes32). */
  sessionCreated: "0xfbcd545747e721f9b8e8ef52e598c4c6f414f6ef65ef21896d02ea7354849ffe",
  /** SessionCancelledByFlagging(address,address,uint256). */
  sessionCancelled: "0xdd92429c72c3d018373fa7da80659b3692b4ed03fc39da998eddee86670438b3",
} as const;

/** What a watched event invalidates: the announcement feed, talks, or sessions. */
export type EventKind = "channel" | "festival" | "sessions";

/** Map a `topics[0]` hex string to the snapshot slice it invalidates, or null. */
export function classifyTopic(topic0: string): EventKind | null {
  switch (topic0.toLowerCase()) {
    case EVENT_TOPIC.channelMetadataUpdated:
      return "channel";
    case EVENT_TOPIC.metadataUpdated:
      return "festival";
    case EVENT_TOPIC.sessionCreated:
    case EVENT_TOPIC.sessionCancelled:
      return "sessions";
    default:
      return null;
  }
}
