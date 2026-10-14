import type { AvatarId } from "@paiyouju/shared";
import { create } from "zustand";

import { apiRequest, postJson, readableError, type PublicUser } from "../api/client.js";
import { tableSocket } from "../realtime/table-socket.js";

interface AuthState {
  readonly error: string | null;
  readonly status: "booting" | "authenticated" | "guest" | "working";
  readonly user: PublicUser | null;
  clearError(): void;
  login(input: { readonly identifier: string; readonly password: string }): Promise<void>;
  logout(): Promise<void>;
  register(input: { readonly nickname: string; readonly password: string; readonly phoneNumber: string }): Promise<void>;
  restore(): Promise<void>;
  updateProfile(avatarId: AvatarId, nickname: string, walletBalance: number): void;
  updatePhone(phoneMasked: string): void;
  updateWalletBalance(balance: number): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  clearError: () => set({ error: null }),
  error: null,
  login: async (input) => {
    set({ error: null, status: "working" });
    try {
      const result = await postJson<{ readonly user: PublicUser }>("/api/auth/login", input);
      set({ status: "authenticated", user: result.user });
    } catch (error: unknown) {
      set({ error: readableError(error), status: "guest", user: null });
      throw error;
    }
  },
  logout: async () => {
    try { await postJson<{ readonly loggedOut: boolean }>("/api/auth/logout"); } finally {
      tableSocket.disconnect();
      set({ error: null, status: "guest", user: null });
    }
  },
  register: async (input) => {
    set({ error: null, status: "working" });
    try {
      const result = await postJson<{ readonly user: PublicUser }>("/api/auth/register", input);
      set({ status: "authenticated", user: result.user });
    } catch (error: unknown) {
      set({ error: readableError(error), status: "guest", user: null });
      throw error;
    }
  },
  restore: async () => {
    set({ status: "booting" });
    try {
      const user = await apiRequest<PublicUser>("/api/me");
      set({ error: null, status: "authenticated", user });
    } catch {
      set({ error: null, status: "guest", user: null });
    }
  },
  status: "booting",
  updateProfile: (avatarId, nickname, walletBalance) => set((state) => ({
    user: state.user ? { ...state.user, avatarId, nickname, walletBalance } : null,
  })),
  updatePhone: (phoneMasked) => set((state) => ({
    user: state.user ? { ...state.user, hasPhoneNumber: true, phoneMasked } : null,
  })),
  updateWalletBalance: (balance) => set((state) => ({
    user: state.user ? { ...state.user, walletBalance: balance } : null,
  })),
  user: null,
}));
