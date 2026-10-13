import type { AxiosError } from "axios";

export type HouseholdRole = "member" | "owner";

export interface HouseholdMember {
  appuserKey: number;
  emailAddress: string;
  firstName?: string;
  role: HouseholdRole;
}

export interface HouseholdPendingInvite {
  email: string;
  expiresAt: string;
  householdInviteKey: number;
}

export interface HouseholdResponse {
  members: HouseholdMember[];
  pendingInvite: HouseholdPendingInvite | null;
}

export interface HouseholdInviteSummary {
  email: string;
  expiresAt: string;
  householdInviteKey: number;
  status: string;
}

export interface CreateHouseholdInviteInput {
  email: string;
}

export interface CreateHouseholdInviteResponse {
  invite: HouseholdInviteSummary;
}

export interface HouseholdErrorBody {
  code?: string;
  message?: string;
}

export type HouseholdApiError = AxiosError<HouseholdErrorBody>;
