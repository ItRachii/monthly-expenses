import { resolveContext } from "./resolveContext";
import { getUsedCategories } from "./expenses";
import { SPLIT_EQUAL, mergeCategories } from "./constants";

interface Opt {
  value: string;
  label: string;
}

/** Everything the Add Expense form needs for one context. Client-safe: opaque member keys only. */
export interface AddSetup {
  ctx: string;
  isPersonal: boolean;
  /** "Personal" or the group's name. */
  name: string;
  categories: string[];
  payerOptions: Opt[];
  splitOptions: Opt[];
  defaultPayer: string;
  memberCount: number;
}

/**
 * Resolves a context the user may add to. Shared by the /add page and the
 * add-expense overlay's server action, so both build the form identically.
 */
export async function buildAddSetup(
  email: string,
  ctxParam: string,
): Promise<{ setup: AddSetup } | { error: string }> {
  const r = await resolveContext(email, ctxParam);
  if (r.error) return { error: r.error };
  const categories = mergeCategories(await getUsedCategories(r.context));
  const payerOptions = r.wire.members.map((m) => ({ value: m.key, label: m.displayName }));
  const splitOptions = [
    { value: SPLIT_EQUAL, label: "Equal Split" },
    ...r.wire.members.map((m) => ({ value: m.key, label: m.displayName })),
  ];
  return {
    setup: {
      ctx: r.ctxValue,
      isPersonal: r.isPersonal,
      name: r.isPersonal ? "Personal" : r.options.find((o) => o.value === r.ctxValue)?.label ?? "Group",
      categories,
      payerOptions,
      splitOptions,
      defaultPayer: r.wire.members.find((m) => m.isSelf)?.key ?? payerOptions[0]?.value ?? "",
      memberCount: r.wire.members.length,
    },
  };
}
