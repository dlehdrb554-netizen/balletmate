import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Public client credentials only. Database access must remain protected by RLS.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "https://ykxvcqgdvifogahbbbwr.supabase.co";
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || "sb_publishable_-wvNm1sapw3c1oSdMFLvTQ_BxOm2ADd";

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url!, anonKey!, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
}) : null;
