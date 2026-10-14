import type { Profile, ProfileUpdateInput } from "@paiyouju/shared";

import { apiRequest, patchJson } from "./client.js";

export const getProfile = () => apiRequest<Profile>("/api/profile");
export const updateProfile = (input: ProfileUpdateInput) => patchJson<Profile>("/api/profile", input);
