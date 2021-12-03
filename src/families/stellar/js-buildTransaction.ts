import invariant from "invariant";
import StellarSdk from "stellar-sdk";
import { AmountRequired, FeeNotLoaded, NetworkDown } from "@ledgerhq/errors";
import type { Account, TokenAccount } from "../../types";
import type { Transaction } from "./types";
import {
  buildPaymentOperation,
  buildCreateAccountOperation,
  buildTransactionBuilder,
  buildChangeTrustOperation,
  loadAccount,
} from "./api";
import { addressExists } from "./logic";
import { getAmountValue } from "./getAmountValue";
import { StellarAssetRequired } from "../../errors";

/**
 * @param {Account} a
 * @param {Transaction} t
 */
export const buildTransaction = async (
  account: Account,
  transaction: Transaction
): Promise<any> => {
  const {
    recipient,
    networkInfo,
    fees,
    memoType,
    memoValue,
    operationType,
    assetCode,
    assetIssuer,
  } = transaction;

  if (!fees) {
    throw new FeeNotLoaded();
  }

  const source = await loadAccount(account.freshAddress);

  if (!source) {
    throw new NetworkDown();
  }

  invariant(networkInfo && networkInfo.family === "stellar", "stellar family");

  const transactionBuilder = buildTransactionBuilder(source, fees);
  let operation = null;

  if (operationType === "changeTrust") {
    if (!assetCode || !assetIssuer) {
      throw new StellarAssetRequired("");
    }

    operation = buildChangeTrustOperation(assetCode, assetIssuer);
  } else {
    // Payment
    const amount = getAmountValue(account, transaction, fees);

    if (!amount) {
      throw new AmountRequired();
    }

    const recipientExists = await addressExists(transaction.recipient); // TODO: use cache with checkRecipientExist instead?

    let amountMagnitude = account.unit.magnitude;

    if (transaction.subAccountId) {
      const asset = account.subAccounts?.find(
        (s) => s.id === transaction.subAccountId
      ) as TokenAccount | undefined;

      if (asset) {
        amountMagnitude = asset.token.units[0].magnitude;
      }
    }

    if (recipientExists) {
      operation = buildPaymentOperation(
        recipient,
        amount,
        assetCode,
        assetIssuer,
        amountMagnitude
      );
    } else {
      operation = buildCreateAccountOperation(recipient, amount);
    }
  }

  transactionBuilder.addOperation(operation);

  let memo = null;

  if (memoType && memoValue) {
    switch (memoType) {
      case "MEMO_TEXT":
        memo = StellarSdk.Memo.text(memoValue);
        break;

      case "MEMO_ID":
        memo = StellarSdk.Memo.id(memoValue);
        break;

      case "MEMO_HASH":
        memo = StellarSdk.Memo.hash(memoValue);
        break;

      case "MEMO_RETURN":
        memo = StellarSdk.Memo.return(memoValue);
        break;
    }
  }

  if (memo) {
    transactionBuilder.addMemo(memo);
  }

  const built = transactionBuilder.setTimeout(0).build();
  return built;
};
export default buildTransaction;
