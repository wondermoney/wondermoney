import type { AxiosError } from "axios";

/** Rank: owner > admin > member > viewer. `lib/household/permissions.ts` holds the rules. */
export type HouseholdRole = "admin" | "member" | "owner" | "viewer";

/** Every role but owner: what an invite or a role change can grant. Ownership moves by transfer. */
export type GrantableHouseholdRole = Exclude<HouseholdRole, "owner">;

export interface HouseholdMember {
  appuserKey: number;
  emailAddress: string;
  firstName?: null | string;
  role: HouseholdRole;
}

export interface HouseholdPendingInvite {
  email: string;
  expiresAt: string;
  householdInviteKey: number;
  role: GrantableHouseholdRole;
}

/** `GET /v1/household` as the API sends it; older servers send only some of it. */
export interface HouseholdResponse {
  maxMembers?: number;
  members: HouseholdMember[];
  /** Deprecated single invite (no `role`), kept by the API for older clients. */
  pendingInvite?: (Omit<HouseholdPendingInvite, "role"> & { role?: GrantableHouseholdRole }) | null;
  pendingInvites?: HouseholdPendingInvite[];
  /** The caller's own appuserKey. */
  viewerAppuserKey?: number;
}

/** The household as the app uses it, with the optional fields resolved (`normalizeHousehold`). */
export interface Household {
  maxMembers: number;
  members: HouseholdMember[];
  pendingInvites: HouseholdPendingInvite[];
  viewerAppuserKey: null | number;
}

export interface HouseholdInviteSummary {
  email: string;
  expiresAt: string;
  householdInviteKey: number;
  role?: GrantableHouseholdRole;
  status: string;
}

export interface CreateHouseholdInviteInput {
  email: string;
  role: GrantableHouseholdRole;
}

export interface CreateHouseholdInviteResponse {
  invite: HouseholdInviteSummary;
}

export interface UpdateHouseholdMemberRoleInput {
  appuserKey: number;
  role: GrantableHouseholdRole;
}

export interface UpdateHouseholdMemberRoleResponse {
  member: HouseholdMember;
}

export interface HouseholdErrorBody {
  code?: string;
  message?: string;
}

export type HouseholdApiError = AxiosError<HouseholdErrorBody>;
