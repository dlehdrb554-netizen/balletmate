import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Android edge-to-edge/modal fallback plus caller-provided breathing room. */
export function useBottomPadding(extra = 16): number {
  const insets = useSafeAreaInsets();
  const androidNavigationInset = Platform.OS === "android" ? 24 : 0;
  return Math.max(insets.bottom, androidNavigationInset) + extra;
}
