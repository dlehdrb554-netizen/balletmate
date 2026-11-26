import React, { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { View, Text, Pressable, StyleSheet, Appearance, Image } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [showSplash,setShowSplash]=useState(true);
  useEffect(()=>{const timer=setTimeout(()=>setShowSplash(false),1600);return()=>clearTimeout(timer);},[]);
  useEffect(() => {
    AsyncStorage.getItem("balletmate.screen_lock").then(enabled => {
      if (enabled === "1" && supabase) return supabase.auth.signOut({ scope: "local" });
      return undefined;
    }).catch(() => {});
    AsyncStorage.getItem("balletmate.theme.mode").then(mode => {
      Appearance.setColorScheme(mode === "dark" ? "dark" : mode === "light" ? "light" : null);
    }).catch(() => {});
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style={showSplash || colorScheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: colorScheme === "dark" ? "#101010" : "#FAF9FC" } }} />
      {showSplash&&<View style={styles.splash}><Image source={require("../assets/icon.png")} style={styles.splashLogo} resizeMode="contain"/><Text style={styles.splashTagline}>발레 생활을 더 편리하게</Text><Text style={styles.splashBrand}>Balletmate</Text></View>}
    </SafeAreaProvider>
  );
}
export function ErrorBoundary({ error, retry }: any) {
  const dark = useColorScheme() === "dark";
  return (
    <View style={[styles.crashFallback,dark&&{backgroundColor:"#101010"}]}>
      <Text style={[styles.title,dark&&{color:"#FFFFFF"}]}>앱 화면을 불러오지 못했습니다</Text>
      <Text style={[styles.message,dark&&{color:"#C2BDCC"}]}>{String(error?.message || error || "알 수 없는 오류")}</Text>
      <Pressable style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  splash:{...StyleSheet.absoluteFillObject,backgroundColor:"#641B4D",alignItems:"center",justifyContent:"center",zIndex:100,elevation:100},
  splashLogo:{width:112,height:112,marginBottom:24},
  splashTagline:{fontSize:15,fontWeight:"600",color:"#F5EAF2",letterSpacing:0.3},
  splashBrand:{fontSize:30,fontWeight:"900",color:"#FFFFFF",letterSpacing:1.2,marginTop:8},
  crashFallback: { flex: 1, backgroundColor: "#FAF9FC", justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 20, fontWeight: "800", color: "#252238" },
  message: { fontSize: 13, color: "#8B879A" },
  button: { backgroundColor: "#7661D8", borderRadius: 12, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "800" },
});
