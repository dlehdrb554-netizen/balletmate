import React, {useMemo} from "react";
import {themeStyles} from "../lib/theme";
import {Pressable, ScrollView, StyleSheet, Text, View, useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
const packages=[
 ["React","19.1.0","MIT","https://github.com/facebook/react"],
 ["React Native","0.81.5","MIT","https://github.com/facebook/react-native"],
 ["Expo SDK","54","MIT","https://github.com/expo/expo"],
 ["Expo Router","6","MIT","https://github.com/expo/expo"],
 ["Expo Location","19","MIT","https://github.com/expo/expo"],
 ["Expo Image Picker","17","MIT","https://github.com/expo/expo"],
 ["Expo Image Manipulator","14","MIT","https://github.com/expo/expo"],
 ["Expo File System","19","MIT","https://github.com/expo/expo"],
 ["Expo Notifications","0.32","MIT","https://github.com/expo/expo"],
 ["Expo Constants / Linking / Font / Status Bar","Expo SDK 54","MIT","https://github.com/expo/expo"],
 ["Supabase JavaScript Client","2","MIT","https://github.com/supabase/supabase-js"],
 ["Async Storage","2","MIT","https://github.com/react-native-async-storage/async-storage"],
 ["React Native Safe Area Context","5","MIT","https://github.com/th3rdwave/react-native-safe-area-context"],
 ["React Native Screens","4","MIT","https://github.com/software-mansion/react-native-screens"],
 ["React Native WebView","13","MIT","https://github.com/react-native-webview/react-native-webview"],
 ["Expo Vector Icons / Ionicons","15","MIT","https://github.com/expo/vector-icons"]
] as const;
export default function Licenses(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);const router=useRouter();return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>오픈소스 라이선스</Text></View><ScrollView contentContainerStyle={s.body}><Text style={s.intro}>발레메이트에서 직접 사용하는 주요 런타임 오픈소스 패키지입니다. 각 패키지는 MIT 라이선스 조건에 따라 사용됩니다. 패키지별 저작권 고지와 전문은 연결된 공식 저장소에서 확인할 수 있습니다.</Text>{packages.map(([name,version,license,url])=><View key={name} style={s.row}><View style={{flex:1}}><Text style={s.name}>{name}</Text><Text style={s.version}>버전 {version}</Text><Text style={s.url}>{url}</Text></View><Text style={s.license}>{license}</Text></View>)}<Text style={s.licenseTitle}>MIT License 주요 조건</Text><Text selectable style={s.licenseText}>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.</Text><Text style={s.note}>이 화면은 package.json에 명시된 직접 런타임 의존성 기준입니다. 배포 전에는 lockfile을 생성하고 전체 전이 의존성의 라이선스 고지도 함께 산출해야 합니다.</Text></ScrollView></SafeAreaView>}
const createS=(dark:boolean)=>StyleSheet.create(themeStyles({safe:{flex:1,backgroundColor:"#FAF9FC"},header:{padding:16,borderBottomWidth:1,borderColor:"#EAE7F0"},back:{fontSize:12,color:"#653BB7",fontWeight:"800"},title:{fontSize:19,fontWeight:"900",color:"#252238",marginTop:10},body:{padding:16},intro:{fontSize:12,color:"#625E70",lineHeight:19,marginBottom:14},row:{backgroundColor:"#fff",borderBottomWidth:1,borderColor:"#EAE7F0",padding:12,flexDirection:"row",alignItems:"center",gap:10},name:{fontSize:13,fontWeight:"800",color:"#252238"},version:{fontSize:10,color:"#625E70",marginTop:3},url:{fontSize:9,color:"#653BB7",marginTop:3},license:{fontSize:12,color:"#653BB7",fontWeight:"800"},licenseTitle:{fontSize:14,fontWeight:"900",color:"#252238",marginTop:20,marginBottom:8},licenseText:{fontSize:10,color:"#625E70",lineHeight:17,backgroundColor:"#fff",padding:12,borderRadius:10},note:{fontSize:11,color:"#625E70",lineHeight:18,marginTop:16}},dark));;
