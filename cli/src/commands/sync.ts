import { map, switchMap } from "rxjs/operators";
import { accountFormatters } from "@ledgerhq/live-common/lib/account";
import { hydrateNfts } from "@ledgerhq/live-common/lib/nft";
import { scan, scanCommonOpts } from "../scan";
import type { ScanCommonOpts } from "../scan";
export default {
  description: "Synchronize accounts with blockchain",
  args: [
    ...scanCommonOpts,
    {
      name: "format",
      alias: "f",
      type: String,
      typeDesc: Object.keys(accountFormatters).join(" | "),
      desc: "how to display the data",
    },
  ],
  job: (
    opts: ScanCommonOpts & {
      format: string;
    }
  ) =>
    scan(opts)
      .pipe(
        switchMap(async (account) => ({
          ...account,
          nfts:
            account.nfts && (await hydrateNfts(account.nfts, account.currency)),
        }))
      )
      .pipe(
        map((account) =>
          (accountFormatters[opts.format] || accountFormatters.default)(account)
        )
      ),
};
