import React, { useEffect, useState } from "react";
import { Stack, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { View, Text, Pressable, StyleSheet, Appearance, Image, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";


function BottomNavigation(){
  const router=useRouter();
  const pathname=usePathname();
  const params=useGlobalSearchParams<{view?:string;compareCount?:string}>();
  const insets=useSafeAreaInsets();
  const dark=useColorScheme()==="dark";
  const [compareCount,setCompareCount]=useState(0);
  useEffect(()=>{
    AsyncStorage.getItem("balletmate.compare.v1").then(raw=>{
      if(!raw)return;
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed?.ids))setCompareCount(Math.min(3,parsed.ids.length));
    }).catch(()=>{});
  },[]);
  useEffect(()=>{
    const count=Number(params.compareCount);
    if(Number.isFinite(count)&&count>=0)setCompareCount(Math.min(3,count));
  },[params.compareCount]);
  const items=[
    {key:"map",label:"지도",icon:"map-outline" as const,active:pathname==="/"&&params.view!=="favorites",onPress:()=>router.replace("/?view=map")},
    {key:"favorites",label:"찜",icon:"heart-outline" as const,active:pathname==="/"&&params.view==="favorites",onPress:()=>router.replace("/?view=favorites")},
    {key:"compare",label:"비교",icon:"swap-horizontal-outline" as const,active:false,onPress:()=>router.push("/?openCompare=1")},
    {key:"community",label:"커뮤니티",icon:"chatbubbles-outline" as const,active:pathname==="/community",onPress:()=>router.push("/community")},
    {key:"mypage",label:"마이페이지",icon:"person-circle-outline" as const,active:pathname==="/mypage",onPress:()=>router.push("/mypage")},
  ];
  return <View style={{backgroundColor:dark?"#17151D":"#FFFFFF",paddingBottom:insets.bottom,borderTopWidth:1,borderTopColor:dark?"#393342":"#EAE7F0"}}>
    <View style={styles.bottomNav}>
      {items.map(item=><Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected:item.active}} onPress={item.onPress} style={styles.navItem}>
        <View style={styles.navIconWrap}>
          <Ionicons name={item.active?(item.key==="favorites"?"heart":"map") as any:item.icon} size={21} color={item.active?"#653BB7":dark?"#AAA3B5":"#8F899B"}/>
          {item.key==="compare"&&compareCount>0&&<View style={styles.navBadge}><Text style={styles.navBadgeText}>{compareCount}</Text></View>}
        </View>
        <Text style={[styles.navLabel,{color:item.active?"#653BB7":dark?"#AAA3B5":"#8F899B"},item.active&&{fontWeight:"900"}]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

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
    <GestureHandlerRootView style={{flex:1}}>
    <SafeAreaProvider>
      <StatusBar style={showSplash || colorScheme === "dark" ? "light" : "dark"} />
      <View style={{flex:1}}><Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: colorScheme === "dark" ? "#101010" : "#FAF9FC" } }}><Stack.Screen name="studio-manager" options={{animation:"slide_from_bottom",presentation:"modal",contentStyle:{backgroundColor:colorScheme==="dark"?"#101010":"#FAF9FC"}}} /></Stack><BottomNavigation /></View>
      {showSplash&&<View style={styles.splash}><Image source={require("../assets/icon.png")} style={styles.splashLogo} resizeMode="contain"/><Text style={styles.splashTagline}>발레 생활을 더 편리하게</Text><Text style={styles.splashBrand}>Balletmate</Text></View>}
    </SafeAreaProvider>
    </GestureHandlerRootView>
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
  bottomNav:{height:62,flexDirection:"row",alignItems:"center",justifyContent:"space-around"},
  navItem:{flex:1,height:58,alignItems:"center",justifyContent:"center",gap:3},
  navIconWrap:{width:30,height:26,alignItems:"center",justifyContent:"center"},
  navLabel:{fontSize:10,fontWeight:"700"},
  navBadge:{position:"absolute",top:-4,right:-7,minWidth:16,height:16,paddingHorizontal:4,borderRadius:9,backgroundColor:"#E64B72",alignItems:"center",justifyContent:"center",borderWidth:1.5,borderColor:"#FFFFFF"},
  navBadgeText:{fontSize:9,fontWeight:"900",color:"#FFFFFF"},
  splash:{...StyleSheet.absoluteFillObject,backgroundColor:"#641B4D",alignItems:"center",justifyContent:"center",zIndex:100,elevation:100},
  splashLogo:{width:112,height:112,marginBottom:24},
  splashTagline:{fontSize:15,fontWeight:"600",color:"#F5EAF2",letterSpacing:0.3},
  splashBrand:{fontSize:30,fontWeight:"900",color:"#FFFFFF",letterSpacing:1.2,marginTop:8},
  crashFallback: { flex: 1, backgroundColor: "#FAF9FC", justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 20, fontWeight: "800", color: "#252238" },
  message: { fontSize: 13, color: "#625E70" },
  button: { backgroundColor: "#653BB7", borderRadius: 12, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "800" },
});
