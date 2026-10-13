import type { ProfileDto } from './self-contracts'

export type ProfileViewModel = Readonly<ProfileDto>

export const mapProfile = (profile: ProfileDto): ProfileViewModel => ({ ...profile })
