import React, {useMemo} from "react";
import {themeStyles} from "../lib/theme";
import { SafeAreaView, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme} from "react-native";

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
 const isDark=useColorScheme()==="dark";
 const styles=useMemo(()=>createStyles(isDark),[isDark]);
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}><Text style={styles.iconText}>!</Text></View>
        <Text style={styles.title}>화면을 불러오지 못했어요</Text>
        <Text style={styles.description}>일시적인 오류일 수 있습니다. 다시 시도하거나 앱을 재실행해 주세요.</Text>
        <Pressable onPress={retry} style={styles.button}><Text style={styles.buttonText}>다시 시도</Text></Pressable>
        <Text style={styles.detailsTitle}>오류 정보</Text>
        <Text selectable style={styles.details}>{error?.stack || error?.message || "알 수 없는 오류"}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles=(dark:boolean)=>StyleSheet.create(themeStyles({
  safe: { flex: 1, backgroundColor: "#FAF9FC" },
  content: { flexGrow: 1, justifyContent: "center", padding: 28 },
  icon: { width: 54, height: 54, borderRadius: 18, backgroundColor: "#F3F0FF", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 18 },
  iconText: { color: "#653BB7", fontSize: 30, fontWeight: "900" },
  title: { fontSize: 20, fontWeight: "900", color: "#252238", textAlign: "center" },
  description: { fontSize: 13, color: "#625E70", textAlign: "center", lineHeight: 20, marginTop: 9 },
  button: { backgroundColor: "#653BB7", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 24 },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  detailsTitle: { fontSize: 12, fontWeight: "800", color: "#252238", marginTop: 24, marginBottom: 8 },
  details: { fontSize: 11, color: "#625E70", backgroundColor: "#F1EEF5", padding: 12, borderRadius: 10 },
},dark));;
