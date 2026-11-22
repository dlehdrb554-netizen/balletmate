import React, { useState } from "react";
import { SafeAreaView, View, Text, Pressable, StyleSheet } from "react-native";

/**
 * Temporary minimal launch diagnostic.
 * This deliberately avoids Supabase, AsyncStorage, location, maps, image,
 * OCR, filesystem, and all application feature modules.
 * Restore the full home screen after identifying the native startup failure.
 */
export default function Home() {
  const [count, setCount] = useState(0);
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>발레메이트 실행 진단</Text>
        <Text style={styles.body}>최소 화면이 정상적으로 표시되고 있습니다.</Text>
        <Text style={styles.body}>이 화면이 보이면 기본 Android 앱 실행과 React Native 화면 렌더링은 통과한 것입니다.</Text>
        <Pressable style={styles.button} onPress={() => setCount((value) => value + 1)}>
          <Text style={styles.buttonText}>화면 동작 테스트 · {count}</Text>
        </Pressable>
        <Text style={styles.note}>진단용 임시 화면이며 학원 검색 등 기존 기능은 이 빌드에서 사용할 수 없습니다.</Text>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF9FC", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, gap: 16 },
  title: { color: "#252238", fontSize: 22, fontWeight: "800" },
  body: { color: "#5D586B", fontSize: 15, lineHeight: 23 },
  button: { backgroundColor: "#7661D8", borderRadius: 12, padding: 15, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  note: { color: "#8B879A", fontSize: 12, lineHeight: 18 }
});
