import type {
  AccountOwnershipMember,
  AccountOwnershipResponse,
  UpdateAccountOwnershipRequest,
} from "@/lib/api/account/useAccountOwnership";

/** 100% in basis points. */
const WHOLE = 10_000;
const PERCENT = /^\d{1,3}(?:[.,]\d{1,2})?$/;

/**
 * The ownership control: whether the account is split between members for net worth, and the
 * percentage typed for each (`appuserKey` → text, so a half-typed value survives).
 */
export interface OwnershipState {
  split: boolean;
  percents: Record<number, string>;
}

export type OwnershipError = "invalid" | "total";

export type OwnershipCheck =
  | { ok: true; body: UpdateAccountOwnershipRequest }
  | { ok: false; error: OwnershipError };

/** The members the control lists: those who can see the account, the only ones a share may name. */
export function ownershipMembers(
  members: readonly AccountOwnershipMember[],
): AccountOwnershipMember[] {
  return members.filter((member) => member.canSee);
}

/** A typed percentage in basis points; null when it is not 0 to 100 with at most two decimals. Empty is 0. */
export function basisPointsOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!PERCENT.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.replace(",", ".").split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return basisPoints <= WHOLE ? basisPoints : null;
}

const percentText = (basisPoints: number) => String(basisPoints / 100);

/**
 * Where the control starts. A split account shows each member's share. One that is not split
 * offers, once switched on, an even split for a joint account and 100% for its owner otherwise.
 */
export function initialOwnershipState(
  response: Pick<AccountOwnershipResponse, "isJoint" | "isSplit" | "members">,
): OwnershipState {
  const members = ownershipMembers(response.members);
  const percents: Record<number, string> = {};
  if (response.isSplit) {
    for (const member of members)
      percents[member.appuserKey] = String(member.percent);
    return { percents, split: true };
  }
  if (response.isJoint && members.length > 0) {
    const even = Math.floor(WHOLE / members.length);
    members.forEach((member, index) => {
      percents[member.appuserKey] = percentText(
        even + (index < WHOLE - even * members.length ? 1 : 0),
      );
    });
  } else {
    for (const member of members)
      percents[member.appuserKey] = member.isAccountOwner ? "100" : "0";
  }
  return { percents, split: false };
}

/** The basis points typed so far, counting what cannot be read as nothing. */
export function ownershipTotal(
  members: readonly AccountOwnershipMember[],
  state: OwnershipState,
): number {
  return ownershipMembers(members).reduce(
    (total, member) =>
      total + (basisPointsOf(state.percents[member.appuserKey] ?? "") ?? 0),
    0,
  );
}

/**
 * The `PUT /v1/account/:accountId/ownership` body, or why there is none: a share that is not a
 * percentage with up to two decimals, or shares that do not add up to 100%. Not split sends an
 * empty list; a member at 0% is left out.
 */
export function ownershipRequest(
  members: readonly AccountOwnershipMember[],
  state: OwnershipState,
): OwnershipCheck {
  if (!state.split) return { body: [], ok: true };
  const body: UpdateAccountOwnershipRequest = [];
  let total = 0;
  for (const member of ownershipMembers(members)) {
    const basisPoints = basisPointsOf(state.percents[member.appuserKey] ?? "");
    if (basisPoints === null) return { error: "invalid", ok: false };
    total += basisPoints;
    if (basisPoints > 0)
      body.push({ appuserKey: member.appuserKey, percent: basisPoints / 100 });
  }
  if (total !== WHOLE) return { error: "total", ok: false };
  return { body, ok: true };
}

/** Whether the control moved from where it started, so saving has something to send. */
export function ownershipChanged(
  members: readonly AccountOwnershipMember[],
  initial: OwnershipState,
  current: OwnershipState,
): boolean {
  if (initial.split !== current.split) return true;
  if (!current.split) return false;
  return ownershipMembers(members).some(
    (member) =>
      basisPointsOf(initial.percents[member.appuserKey] ?? "") !==
      basisPointsOf(current.percents[member.appuserKey] ?? ""),
  );
}
