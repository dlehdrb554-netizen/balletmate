import { Stack } from "expo-router";
import { FaceDetectionProvider } from "@infinitered/react-native-mlkit-face-detection";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { View, Text, Pressable, StyleSheet } from "react-native";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <FaceDetectionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
      </FaceDetectionProvider>
    </SafeAreaProvider>
  );
}
export function ErrorBoundary({ error, retry }: any) {
  return (
    <View style={styles.crashFallback}>
      <Text style={styles.title}>앱 화면을 불러오지 못했습니다</Text>
      <Text style={styles.message}>{String(error?.message || error || "알 수 없는 오류")}</Text>
      <Pressable style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  crashFallback: { flex: 1, backgroundColor: "#FAF9FC", justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 20, fontWeight: "800", color: "#252238" },
  message: { fontSize: 13, color: "#8B879A" },
  button: { backgroundColor: "#7661D8", borderRadius: 12, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "800" },
});
