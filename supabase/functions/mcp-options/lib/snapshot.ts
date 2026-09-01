import type {
  OptionContract,
} from "./put-pressure.ts";

export type SnapshotContract =
  OptionContract;

export type PreviousOiRow = {
  contract_code: string;
  open_interest: number | null;
};

export type ContractSnapshotRow = {
  snapshot_id: string;
  underlying: string;
  expiry: string;

  contract_code: string;
  side: "call" | "put";

  strike: number;

  volume: number | null;
  open_interest: number | null;
  iv: number | null;

  bid: number | null;
  ask: number | null;
  last: number | null;
};

export function previousOpenInterestFromRows(
  rows: PreviousOiRow[],
): Record<string, number> {
  const out: Record<string, number> = {};

  for (const row of rows) {
    if (
      typeof row.open_interest !== "number" ||
      !Number.isFinite(row.open_interest)
    ) {
      continue;
    }

    out[row.contract_code] =
      row.open_interest;
  }

  return out;
}

export function toContractSnapshotRows(
  snapshotId: string,
  underlying: string,
  expiry: string,
  contracts: SnapshotContract[],
): ContractSnapshotRow[] {
  return contracts.map((contract) => ({
    snapshot_id: snapshotId,
    underlying,
    expiry,

    contract_code: contract.code,
    side: contract.side,

    strike: contract.strike,

    volume: contract.volume,
    open_interest: contract.openInterest,
    iv: contract.iv,

    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    last: contract.last ?? null,
  }));
}
