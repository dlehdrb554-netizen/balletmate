import React, {useEffect, useRef, useState, useMemo} from "react";
import {themeStyles} from "../../lib/theme";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function AuthCallback(){
 const isDark=useColorScheme()==="dark";
 const styles=useMemo(()=>createStyles(isDark),[isDark]);
 const router=useRouter();
 const params=useLocalSearchParams<{code?:string|string[];error?:string|string[];error_description?:string|string[]}>();
 const [message,setMessage]=useState("로그인 정보를 확인하고 있어요.");
 const [failed,setFailed]=useState(false);
 const [nextRoute,setNextRoute]=useState("/");
 const handled=useRef(false);

 useEffect(()=>{
  let active=true;
  const finish=async(code:string|undefined,errorText?:string)=>{
   if(handled.current||!active)return;
   if(errorText){
    handled.current=true;setFailed(true);setMessage(decodeURIComponent(errorText.replace(/\+/g," ")));return;
   }
   if(!code)return;
   handled.current=true;
   if(!supabase){setFailed(true);setMessage("Supabase 설정을 확인할 수 없습니다.");return;}
   const {error}=await supabase.auth.exchangeCodeForSession(code);
   if(!active)return;
   if(error){setFailed(true);setMessage(error.message||"로그인 인증을 완료하지 못했습니다.");}
   else {const {data:{user}}=await supabase.auth.getUser();if(user){const [profile,admin]=await Promise.all([supabase.from("user_profiles").select("username,display_name,is_admin").eq("user_id",user.id).maybeSingle(),supabase.rpc("is_balletmate_admin")]);if(admin.error){setFailed(true);setMessage("계정 권한을 확인하지 못했습니다. 잠시 후 다시 로그인해 주세요.");return;}const isAdmin=admin.data===true||profile.data?.is_admin===true;if(!isAdmin&&(profile.error||!profile.data||!profile.data.display_name)){setNextRoute("/onboarding");}else{const destination=await AsyncStorage.getItem("balletmate.auth.returnTo");if(destination==="mypage")setNextRoute("/mypage");else if(destination==="mypage-settings")setNextRoute("/mypage?open=settings");}await AsyncStorage.removeItem("balletmate.auth.returnTo");}setMessage("로그인이 완료되었습니다.");}
  };
  const codeParam=Array.isArray(params.code)?params.code[0]:params.code;
  const errorParam=Array.isArray(params.error_description)?params.error_description[0]:params.error_description;
  const errorCode=Array.isArray(params.error)?params.error[0]:params.error;
  if(codeParam)void finish(codeParam);
  else if(errorParam||errorCode)void finish(undefined,errorParam||errorCode);
  const subscription=Linking.addEventListener("url",({url})=>{
   const parsed=Linking.parse(url);
   const code=typeof parsed.queryParams?.code==="string"?parsed.queryParams.code:undefined;
   const error=typeof parsed.queryParams?.error_description==="string"?parsed.queryParams.error_description:undefined;
   void finish(code,error);
  });
  Linking.getInitialURL().then(url=>{
   if(!url||handled.current)return;
   const parsed=Linking.parse(url);
   const code=typeof parsed.queryParams?.code==="string"?parsed.queryParams.code:undefined;
   const error=typeof parsed.queryParams?.error_description==="string"?parsed.queryParams.error_description:undefined;
   void finish(code,error);
  }).catch(()=>{});
  return()=>{active=false;subscription.remove();};
 },[params.code,params.error,params.error_description]);

 return <SafeAreaView style={styles.safe}>
  <View style={styles.content}>
   {!failed&&message!=="로그인이 완료되었습니다."?<ActivityIndicator size="large" color="#7661D8"/>:null}
   <Text style={styles.title}>{failed?"로그인에 실패했습니다":message==="로그인이 완료되었습니다."?"로그인 완료":"인증 처리 중"}</Text>
   <Text style={styles.message}>{message}</Text>
   <Pressable style={styles.button} onPress={()=>router.replace(failed?"/account":nextRoute as any)}><Text style={styles.buttonText}>{failed?"계정 화면으로 돌아가기":"계속하기"}</Text></Pressable>
  </View>
 </SafeAreaView>;
}
const createStyles=(dark:boolean)=>StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:"#FAF9FC"},content:{flex:1,alignItems:"center",justifyContent:"center",padding:28},
 title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:18},message:{fontSize:13,color:"#8B879A",textAlign:"center",lineHeight:20,marginTop:10},
 button:{backgroundColor:"#7661D8",borderRadius:13,paddingVertical:14,paddingHorizontal:28,marginTop:26},buttonText:{color:"#fff",fontWeight:"900"}
},dark));;
