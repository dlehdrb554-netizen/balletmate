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
   else {const {data:{user}}=await supabase.auth.getUser();if(user){const consentRaw=await AsyncStorage.getItem("balletmate.signupConsent.v1");if(consentRaw){try{const consent=JSON.parse(consentRaw);if(consent?.age14Confirmed&&consent?.termsVersion&&consent?.privacyVersion&&consent?.acceptedAt&&!user.user_metadata?.legal_terms_version){const {error:consentError}=await supabase.auth.updateUser({data:{legal_terms_version:consent.termsVersion,privacy_policy_version:consent.privacyVersion,legal_accepted_at:consent.acceptedAt,age_14_confirmed:true}});if(consentError)throw consentError;}}catch(error){setFailed(true);setMessage("필수 약관 동의 정보를 저장하지 못했습니다.");return;}}const [profile,admin]=await Promise.all([supabase.from("user_profiles").select("username,display_name").eq("user_id",user.id).maybeSingle(),supabase.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle()]);if(admin.error){setFailed(true);setMessage("관리자 계정 권한을 확인하지 못했습니다: "+admin.error.message);return;}const isAdmin=!!admin.data?.user_id;if(!isAdmin&&(profile.error||!profile.data||!profile.data.display_name)){setNextRoute("/onboarding");}else{const destination=await AsyncStorage.getItem("balletmate.auth.returnTo");if(destination==="mypage")setNextRoute("/mypage");else if(destination==="mypage-settings")setNextRoute("/mypage?open=settings");}await AsyncStorage.removeItem("balletmate.auth.returnTo");}setMessage("로그인이 완료되었습니다.");}
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
   {!failed&&message!=="로그인이 완료되었습니다."?<ActivityIndicator size="large" color="#653BB7"/>:null}
   <Text style={styles.title}>{failed?"로그인에 실패했습니다":message==="로그인이 완료되었습니다."?"로그인 완료":"인증 처리 중"}</Text>
   <Text style={styles.message}>{message}</Text>
   <Pressable style={styles.button} onPress={()=>router.replace(failed?"/account":nextRoute as any)}><Text style={styles.buttonText}>{failed?"계정 화면으로 돌아가기":"계속하기"}</Text></Pressable>
  </View>
 </SafeAreaView>;
}
const createStyles=(dark:boolean)=>StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:"#FAF9FC"},content:{flex:1,alignItems:"center",justifyContent:"center",padding:28},
 title:{fontSize:20,fontWeight:"900",color:"#252238",marginTop:18},message:{fontSize:13,color:"#625E70",textAlign:"center",lineHeight:20,marginTop:10},
 button:{backgroundColor:"#653BB7",borderRadius:13,paddingVertical:14,paddingHorizontal:28,marginTop:26},buttonText:{color:"#fff",fontWeight:"900"}
},dark));;
