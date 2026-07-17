import { api } from "@/lib/api";
import type { AuthUser } from "@/store/authStore";

interface AuthResponse {
  token: string;
  user: AuthUser;
}

interface MeResponse {
  user: AuthUser;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", { email, password });
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
  return data;
}

export async function me(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>("/auth/me");
  return data;
}

export async function updateProfile(displayName: string): Promise<MeResponse> {
  const { data } = await api.patch<MeResponse>("/auth/profile", { displayName });
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true }> {
  const { data } = await api.post<{ ok: true }>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
  return data;
}
