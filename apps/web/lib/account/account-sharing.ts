import type {
  AccountShareMember,
  AccountSharesResponse,
  UpdateAccountSharesRequest,
} from "@/lib/api/account/useAccountShares";

/** What the sharing control offers each member other than the account owner. */
export type SharingChoice = "hidden" | "read" | "write";

/** Per member (`appuserKey`), what they get. */
export type SharingChoices = Record<number, SharingChoice>;

/**
 * The control's state: one choice per other member, plus the plain "Private" toggle a
 * household with nobody else to share with falls back to.
 */
export interface SharingState {
  choices: SharingChoices;
  isPrivate: boolean;
}

/** The members the control lists: everyone but the account owner. */
export function shareableMembers(
  members: readonly AccountShareMember[],
): AccountShareMember[] {
  return members.filter((member) => !member.isAccountOwner);
}

/** A household viewer only ever reads, so "Can edit" is not on offer for them. */
export function choicesFor(
  member: Pick<AccountShareMember, "role">,
): SharingChoice[] {
  return member.role === "viewer"
    ? ["hidden", "read"]
    : ["hidden", "read", "write"];
}

/** The most a member can get: what sharing with the whole household gives them. */
export function maximumChoice(
  member: Pick<AccountShareMember, "role">,
): SharingChoice {
  return member.role === "viewer" ? "read" : "write";
}

/**
 * The control as the API describes the account. A shared account gives everyone their
 * maximum; a private one gives each member their stored share, or Hidden without one. A
 * `write` share on a viewer reads as Can view, which is all it gives them.
 */
export function initialSharingState(
  response: Pick<AccountSharesResponse, "isPrivate" | "members">,
): SharingState {
  const choices: SharingChoices = {};
  for (const member of shareableMembers(response.members)) {
    if (!response.isPrivate) {
      choices[member.appuserKey] = maximumChoice(member);
      continue;
    }
    const share = member.share ?? "hidden";
    choices[member.appuserKey] =
      share === "write" && member.role === "viewer" ? "read" : share;
  }
  return { choices, isPrivate: response.isPrivate };
}

/**
 * The `PUT /v1/account/:accountId/shares` body for the control's state.
 *
 * Everyone at their maximum is the same as sharing with the household, which is also what
 * people who join later get. Anything less makes the account private, with a share for each
 * member who can view or edit it; Hidden members are left out. A household with nobody else in
 * it has only the toggle.
 */
export function sharesRequest(
  members: readonly AccountShareMember[],
  state: SharingState,
): UpdateAccountSharesRequest {
  const others = shareableMembers(members);
  if (others.length === 0) {
    return { isPrivate: state.isPrivate, shares: [] };
  }
  const choiceOf = (member: AccountShareMember) =>
    state.choices[member.appuserKey] ?? "hidden";
  if (others.every((member) => choiceOf(member) === maximumChoice(member))) {
    return { isPrivate: false, shares: [] };
  }
  return {
    isPrivate: true,
    shares: others.flatMap((member) => {
      const choice = choiceOf(member);
      return choice === "hidden"
        ? []
        : [{ appuserKey: member.appuserKey, access: choice }];
    }),
  };
}

/** Whether the control moved from where it started, so saving has something to send. */
export function sharingChanged(
  members: readonly AccountShareMember[],
  initial: SharingState,
  current: SharingState,
): boolean {
  const others = shareableMembers(members);
  if (others.length === 0) return initial.isPrivate !== current.isPrivate;
  return others.some(
    (member) =>
      (initial.choices[member.appuserKey] ?? "hidden") !==
      (current.choices[member.appuserKey] ?? "hidden"),
  );
}
