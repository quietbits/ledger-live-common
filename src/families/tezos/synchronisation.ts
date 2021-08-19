// @flow
import invariant from "invariant";
import { BigNumber } from "bignumber.js";
import { log } from "@ledgerhq/logs";
import { mergeOps } from "../../bridge/jsHelpers";
import type { GetAccountShape } from "../../bridge/jsHelpers";
import { encodeOperationId } from "../../operation";
import { areAllOperationsLoaded } from "../../account";
import type { Operation, Account } from "../../types";
import api from "./api/tzkt";
import type { APIOperation } from "./api/tzkt";
import { DerivationType } from "@taquito/ledger-signer";
import { compressPublicKey } from "@taquito/ledger-signer/dist/lib/utils";
import { b58cencode, prefix, Prefix } from "@taquito/utils";

export const getAccountShape: GetAccountShape = async (infoInput) => {
  let { address, initialAccount, rest } = infoInput;
  // FIXME: rest is NOT in the type and also is ONLY provided by scanAccounts! so we must refine this as you may have to retrieve it from initalAccount in the sync case

  const initialStableOperations = initialAccount
    ? initialAccount.operations
    : [];

  // fetch transactions, incrementally if possible
  const mostRecentStableOperation = initialStableOperations[0];

  let lastId =
    initialAccount &&
    areAllOperationsLoaded(initialAccount) &&
    mostRecentStableOperation
      ? mostRecentStableOperation.extra.id || undefined
      : undefined;

  const apiAccountPromise = api.getAccountByAddress(address);
  const blocksCountPromise = api.getBlockCount();

  const [apiAccount, blockHeight] = await Promise.all([
    apiAccountPromise,
    blocksCountPromise,
  ]);

  if (apiAccount.type === "empty") {
    return {
      blockHeight,
      lastSyncDate: new Date(),
    };
  }
  invariant(
    apiAccount.type === "user",
    "unsupported account of type ",
    apiAccount.type
  );

  // TODO paginate with lastId

  const apiOperations = await fetchAllTransactions(address, lastId);

  const { revealed, counter } = apiAccount;

  const tezosResources = {
    revealed,
    publicKey: b58cencode(
      compressPublicKey(
        Buffer.from(rest.publicKey, "hex"),
        DerivationType.ED25519
      ),
      prefix[Prefix.EDPK]
    ),
    counter,
  };

  const balance = new BigNumber(apiAccount.balance);
  const subAccounts = [];

  const newOps: any[] = apiOperations.map(txToOp(infoInput)).filter(Boolean);

  const operations = mergeOps(initialStableOperations, newOps);

  const accountShape = {
    operations,
    balance,
    subAccounts,
    spendableBalance: balance,
    blockHeight,
    lastSyncDate: new Date(),
    tezosResources,
  };

  return accountShape;
};

const txToOp = ({ address, id: accountId }) => (
  tx: APIOperation
): Operation | null | undefined => {
  let type;
  let maybeValue;
  let senders: string[] = [];
  let recipients: string[] = [];
  const hasFailed = tx.status ? tx.status !== "applied" : false;

  switch (tx.type) {
    case "transaction": {
      const initiator = tx.initiator?.address;
      const from = tx.sender?.address;
      const to = tx.target?.address;
      if (from !== address && to !== address && initiator !== address) {
        // failsafe for a case that shouldn't happen.
        console.warn("found tx is unrelated to account! " + tx.hash);
        return null;
      }
      senders = [from || initiator || ""];
      recipients = [to || ""];
      if (
        (from === address && to === address) || // self tx
        (from !== address && to !== address) // initiator but not in from/to
      ) {
        // we just pay fees in that case
        type = "FEES";
      } else {
        type = to === address ? "IN" : "OUT";
        if (!hasFailed) {
          maybeValue = new BigNumber(tx.amount || 0);
          if (maybeValue.eq(0)) {
            type = "FEES";
          }
        }
      }
      break;
    }
    case "delegation":
      type = tx.newDelegate ? "DELEGATE" : "UNDELEGATE";
      senders = [address];
      // convention was to use recipient for the new delegation address or "" if undelegation
      recipients = [tx.newDelegate ? tx.newDelegate.address : ""];
      break;
    case "reveal":
      type = "REVEAL";
      senders = [address];
      recipients = [address];
      break;
    case "migration":
      type = tx.balanceChange < 0 ? "OUT" : "IN";
      maybeValue = new BigNumber(Math.abs(tx.balanceChange || 0));
      senders = [address];
      recipients = [address];
      break;
    case "origination":
      type = "CREATE";
      maybeValue = new BigNumber(tx.contractBalance || 0);
      senders = [address];
      recipients = [tx.originatedContract.address];
      break;
    case "activation":
      type = "IN";
      senders = [address];
      recipients = [address];
      maybeValue = new BigNumber(tx.balance || 0);
      break;
    // TODO more type of tx
    default:
      console.warn("unsupported tx:", tx);
      return null;
  }

  let {
    id,
    hash,
    allocationFee,
    bakerFee,
    storageFee,
    level: blockHeight,
    block: blockHash,
    timestamp,
  } = tx;

  if (!hash) {
    // in migration case, there is no hash...
    hash = "";
  }

  let value = maybeValue || new BigNumber(0);
  if (type === "IN" && value.eq(0)) {
    return; // not interesting op
  }

  let fee = new BigNumber(bakerFee || 0);

  if (!hasFailed) {
    fee = fee.plus(allocationFee || 0).plus(storageFee || 0);
  }

  if (type !== "IN") {
    value = value.plus(fee);
  }

  return {
    id: encodeOperationId(accountId, hash, type),
    hash,
    type,
    value,
    fee,
    senders,
    recipients,
    blockHeight,
    blockHash,
    accountId,
    date: new Date(timestamp),
    extra: {
      id,
    },
    hasFailed,
  };
};

const fetchAllTransactions = async (
  address: string,
  lastId?: number
): Promise<APIOperation[]> => {
  let txs: APIOperation[] = [];
  let maxIteration = 20; // safe limit
  do {
    // FIXME not sure what is going on here
    const r = await api.getAccountOperations(address, { lastId, sort: 0 });
    if (r.length === 0) return txs;
    txs = txs.concat(r);
    const last = txs[txs.length - 1];
    if (!last) return txs;
    lastId = last.id;
    if (!lastId) {
      log("tezos", "id missing!");
      return txs;
    }
  } while (--maxIteration);
  return txs;
};