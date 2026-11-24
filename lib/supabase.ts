import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Public client credentials only. Database access must remain protected by RLS.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url!, anonKey!, {
  auth: {
    flowType: "pkce",
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
}) : null;
