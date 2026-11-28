import React, {useEffect, useState, useMemo} from "react";
import { getUserErrorMessage } from "../lib/error-utils";
import {themeStyles } from "../lib/theme";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F3F0FF",line:"#EAE7F0",green:"#18875B",yellow:"#FEE500"};
const OAUTH_REDIRECT_URL="balletmate://auth/callback";

export default function Account(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const routeParams=useLocalSearchParams<{returnTo?:string;studioId?:string;studioName?:string;consentProvider?:string}>();
 const [name,setName]=useState("");
 const [pw,setPw]=useState("");
 const [showPassword,setShowPassword]=useState(false);
 const [loading,setLoading]=useState(false);
 const [loadingProvider,setLoadingProvider]=useState<"google"|"kakao"|null>(null);
 const [session,setSession]=useState<any>(null);
 const [display,setDisplay]=useState("");
 const [adminRole,setAdminRole]=useState<boolean|null>(null);

 useEffect(()=>{
  if(!supabase)return;
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,nextSession)=>setSession(nextSession));
  return()=>subscription.unsubscribe();
 },[]);

 useEffect(()=>{if(session&&routeParams.returnTo){if(routeParams.returnTo==="studio-manager"&&routeParams.studioId){router.replace({pathname:"/studio-manager",params:{studioId:routeParams.studioId,studioName:routeParams.studioName||"선택한 학원"}});return;}router.replace(routeParams.returnTo==="mypage-settings"?"/mypage?open=settings":"/mypage");}},[session,routeParams.returnTo,routeParams.studioId,routeParams.studioName,router]);

 useEffect(()=>{
  let active=true;
  if(session?.user&&supabase){
   Promise.all([
    supabase.from("user_profiles").select("username, display_name").eq("user_id",session.user.id).maybeSingle(),
    supabase.rpc("is_balletmate_admin")
   ]).then(([profile,role])=>{
    if(!active)return;
    const metadata=session.user.user_metadata||{};
    const username=profile.data?.username||"";
    const displayName=profile.data?.display_name||"";
    const isAdmin=!role.error&&role.data===true;
    // Keep the internal social_* username private; show only the app display name.
    setDisplay(isAdmin?"관리자":displayName||(username.startsWith("social_")?"발레메이트 회원":username)||"회원");
    setAdminRole(isAdmin);
   });
  }else {setDisplay("");setAdminRole(null);}
  return()=>{active=false;};
 },[session]);

 const signInSocial=async(provider:"google"|"kakao")=>{
  if(!supabase){Alert.alert("설정 확인","Supabase 설정을 확인하세요.");return;}
  // 최초 가입 전 필수 동의. 이미 이 기기에서 동의한 사용자는 기존 소셜 로그인을 계속 이용할 수 있습니다.
  let consentValid=false;
  try{
   const raw=await AsyncStorage.getItem("balletmate.signupConsent.v1");
   if(raw){
    const consent=JSON.parse(raw);
    consentValid=!!(consent?.termsVersion&&consent?.privacyVersion&&consent?.acceptedAt&&consent?.age14Confirmed===true);
   }
  }catch{}
  if(!consentValid){
   router.push({pathname:"/signup-consent",params:{next:provider}});
   return;
  }
  setLoadingProvider(provider);
  try{
   if(routeParams.returnTo)await AsyncStorage.setItem("balletmate.auth.returnTo",routeParams.returnTo);
   const {data,error}=await supabase.auth.signInWithOAuth({
    provider,
    options:{
     redirectTo:OAUTH_REDIRECT_URL,
     skipBrowserRedirect:true,
    }
   });
   if(error)throw error;
   if(!data.url)throw new Error("로그인 주소를 만들지 못했습니다. Supabase 제공자 설정을 확인하세요.");
   await Linking.openURL(data.url);
  }catch(error:any){
   Alert.alert("소셜 로그인 실패",getUserErrorMessage(error,"잠시 후 다시 시도해 주세요."));
  }finally{setLoadingProvider(null);}
 };

 useEffect(()=>{
  const next=routeParams.consentProvider;
  if(next==="email"){router.replace("/signup");return;}
  if(next==="google"||next==="kakao")void signInSocial(next);
 },[routeParams.consentProvider]);

 const linkSocial=async(provider:"google"|"kakao")=>{
  if(!supabase)return;
  setLoadingProvider(provider);
  try{
   const {data,error}=await supabase.auth.linkIdentity({
    provider,
    options:{
     redirectTo:OAUTH_REDIRECT_URL,
     skipBrowserRedirect:true,
    }
   });
   if(error)throw error;
   if(!data.url)throw new Error("연결 주소를 만들지 못했습니다.");
   await Linking.openURL(data.url);
  }catch(error:any){
   Alert.alert("계정 연결 실패",getUserErrorMessage(error,"잠시 후 다시 시도해 주세요."));
  }finally{setLoadingProvider(null);}
 };

 const submitLegacyLogin=async()=>{
  if(!supabase){Alert.alert("설정 확인","Supabase 설정을 확인하세요.");return;}
  const username=name.trim().toLowerCase();
  if((username.includes("@")?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username):!/^[a-z0-9_]{3,24}$/.test(username))||!pw){Alert.alert("입력 확인","아이디 또는 이메일과 비밀번호를 입력해 주세요.");return;}
  setLoading(true);
  try{
   if(username.includes("@")){
    const {error}=await supabase.auth.signInWithPassword({email:username,password:pw});
    if(error)throw error;
   }else{
    const {data,error}=await supabase.functions.invoke("username-login",{body:{username,password:pw}});
    if(error){let detail=error.message;try{const response=(error as any).context;const payload=response?.clone?await response.clone().json():null;if(payload?.error)detail=String(payload.error);}catch{}throw new Error(detail);}
    if(!data?.session?.access_token||!data?.session?.refresh_token)throw new Error(data?.error||"로그인 정보를 확인할 수 없습니다.");
    const {error:setSessionError}=await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
    if(setSessionError)throw setSessionError;
   }
  }catch(error:any){
   Alert.alert("로그인 실패",getUserErrorMessage(error,"아이디와 비밀번호를 확인해 주세요."));
  }finally{setLoading(false);}
 };

 const logout=async()=>{
  if(!supabase)return;
  const {error}=await supabase.auth.signOut();
  if(error)Alert.alert("로그아웃 실패",getUserErrorMessage(error));
 };
 const deleteAccount=()=>{
  const client=supabase;
  if(!client)return;
  Alert.alert(
   "회원 탈퇴",
   "계정을 영구 삭제합니다. 프로필·즐겨찾기·작성한 리뷰·커뮤니티 글과 댓글·사진·알림 정보 및 학원 관리 신청 정보가 삭제되고 학원 관리자 권한도 해제됩니다. 공개 학원 정보와 학원에 등록된 가격표·시간표 등은 학원 자료로 남을 수 있으며, Google·카카오 계정 자체는 삭제되지 않습니다. 되돌릴 수 없습니다. 계속할까요?",
   [
    {text:"취소",style:"cancel"},
    {text:"영구 탈퇴",style:"destructive",onPress:async()=>{
     setLoading(true);
     try{
      const {data,error}=await client.functions.invoke("delete-account",{body:{confirm:true}});
      if(error)throw error;
      if(!data?.success)throw new Error(data?.error||"계정 삭제 결과를 확인할 수 없습니다.");
      await client.auth.signOut({scope:"local"});
      setSession(null);
      Alert.alert("탈퇴 완료","회원 계정 삭제가 완료되었습니다.");
     }catch(error:any){
      Alert.alert("탈퇴 실패",getUserErrorMessage(error,"계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."));
     }finally{setLoading(false);}
    }}
   ]
  );
 };
 const identities=(session?.user?.identities||[]) as Array<{provider?:string}>;
 const connected=(provider:string)=>identities.some(identity=>identity.provider===provider);

 return <SafeAreaView style={s.safe}>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}>
   <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Pressable onPress={()=>router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="뒤로가기"><Text style={s.back}>‹ 돌아가기</Text></Pressable>
    <Text style={s.brand}>Balletmate<Text style={{color:C.purple}}>.</Text></Text>
    <Text style={s.title}>{session?"내 계정":"간편하게 시작하기"}</Text>
    <Text style={s.sub}>{session?"로그인 정보와 연결된 계정을 관리할 수 있어요." :"소셜 계정으로 간편하게 시작하거나 기존 계정으로 로그인하세요."}</Text>
    {session?
     <View style={s.card}>
      <View style={s.avatar}><MaterialCommunityIcons name="human-female-dance" size={30} color={C.purple} /></View>
      <Text style={s.name}>{display||"회원"}</Text>
      <Text style={s.sub}>{adminRole===true?"관리자 계정 · 관리자 권한 확인됨":adminRole===false?"일반 회원 계정":"계정 권한 확인 중"}</Text>
{adminRole===true&&<Pressable style={s.primary} onPress={()=>router.push("/admin")}><Text style={s.primaryText}>관리자 페이지</Text></Pressable>}
      <View style={s.connectedBox}>
       <Text style={s.connectedTitle}>소셜 계정 연결</Text>
       <View style={s.socialRow}>
        <Pressable style={[s.googleConnectButton,isDark&&s.googleLoginButtonDark]} disabled={!!loadingProvider||connected("google")} onPress={()=>linkSocial("google")} accessibilityRole="button" accessibilityLabel="Google 계정 연결">
         <View style={s.googleLogoWrap}><Image source={{uri:"https://developers.google.com/static/identity/images/g-logo.png"}} contentFit="contain" style={s.googleLogo}/></View>
         <Text style={[s.googleLoginText,isDark&&s.googleLoginTextDark]}>{connected("google")?"Google 연결됨":loadingProvider==="google"?"연결 중…":"Google 계정 연결"}</Text>
        </Pressable>
        <Pressable style={s.kakaoConnectButton} disabled={!!loadingProvider||connected("kakao")} onPress={()=>linkSocial("kakao")} accessibilityRole="button" accessibilityLabel="카카오 계정 연결">
         <Text style={s.kakaoConnectText}>{connected("kakao")?"카카오 계정 연결됨":loadingProvider==="kakao"?"연결 중…":"카카오 계정 연결"}</Text>
        </Pressable>
       </View>
      </View>
      <Pressable style={s.primary} disabled={loading} onPress={logout}><Text style={s.primaryText}>로그아웃</Text></Pressable>
      <Pressable style={s.deleteAccount} disabled={loading} onPress={deleteAccount}><Text style={s.deleteAccountText}>{loading?"처리 중…":"회원 탈퇴"}</Text></Pressable>
     </View>
     :
     <View style={s.card}>
      <>
       <Text style={s.legacyTitle}>소셜 계정으로 계속하기</Text>
       <View style={s.socialRow}>
        <Pressable style={[s.googleLoginButton,isDark&&s.googleLoginButtonDark]} disabled={!!loadingProvider} onPress={()=>signInSocial("google")} accessibilityRole="button" accessibilityLabel="Google 계정으로 계속">
         <View style={s.googleLogoWrap}><Image source={{uri:"https://developers.google.com/static/identity/images/g-logo.png"}} contentFit="contain" style={s.googleLogo}/></View>
         <Text style={[s.googleLoginText,isDark&&s.googleLoginTextDark]}>{loadingProvider==="google"?"연결 중…":"Google 계정으로 계속"}</Text>
        </Pressable>
        <Pressable style={s.kakaoLoginButton} disabled={!!loadingProvider} onPress={()=>signInSocial("kakao")} accessibilityRole="button" accessibilityLabel={loadingProvider==="kakao"?"카카오 계정 연결 중":"카카오 계정으로 계속"}>
         <Image source={{uri:"https://developers.kakao.com/tool/images/resource/preview/login-complete-ko.svg"}} contentFit="contain" style={s.kakaoLoginImage}/>
         {loadingProvider==="kakao"&&<Text style={s.kakaoLoading}>연결 중…</Text>}
        </Pressable>
       </View>
       <View style={s.separator}><View style={s.separatorLine}/><Text style={s.separatorText}>또는 이메일로 계속하기</Text><View style={s.separatorLine}/></View>
       <Text style={s.label}>아이디 또는 이메일</Text>
       <TextInput style={s.input} value={name} onChangeText={setName} placeholder="아이디 또는 이메일" autoCapitalize="none" autoCorrect={false} maxLength={254} returnKeyType="next"/>
       <Text style={s.label}>비밀번호</Text>
       <View style={[s.input,{flexDirection:"row",alignItems:"center"}]}><TextInput style={{flex:1,height:"100%",padding:0,color:isDark?"#FFFFFF":C.ink}} value={pw} onChangeText={setPw} placeholder="비밀번호" placeholderTextColor={C.muted} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} onSubmitEditing={submitLegacyLogin} returnKeyType="go"/><Pressable onPress={()=>setShowPassword(value=>!value)} hitSlop={8} accessibilityRole="button" accessibilityLabel={showPassword?"비밀번호 숨기기":"비밀번호 표시"} accessibilityState={{selected:showPassword}} style={{width:40,height:44,alignItems:"center",justifyContent:"center"}}><MaterialCommunityIcons name={showPassword?"eye-off-outline":"eye-outline"} size={21} color={isDark?"#D0D0D0":C.muted}/></Pressable></View>
       <Pressable style={[s.primary,loading&&{opacity:.55}]} disabled={loading} onPress={submitLegacyLogin}><Text style={s.primaryText}>{loading?"로그인 중…":"로그인"}</Text></Pressable>
       <Pressable style={s.legacyLink} onPress={async()=>{const consent=await AsyncStorage.getItem("balletmate.signupConsent.v1");router.push(consent?"/signup":{pathname:"/signup-consent",params:{next:"email"}});}}><Text style={s.legacyLinkText}>이메일로 회원가입</Text></Pressable>
       <Text style={s.note}>카카오·Google은 해당 계정으로 인증하므로 별도 이메일 인증 없이 가입·로그인할 수 있습니다. 이메일 가입은 인증 링크 확인이 필요합니다.</Text>
      </>
     </View>
    }
    <View style={s.info}>
     <Text style={s.infoTitle}>계정 사용 안내</Text>
     <Text style={s.note}>• 로그인하면 찜 목록을 기기 간 동기화할 수 있습니다.</Text>
     <Text style={s.note}>• 학원 탐색은 로그인 없이 계속 이용할 수 있습니다.</Text>
     <Text style={s.note}>• 기존 아이디 계정도 계속 로그인할 수 있습니다.</Text>
    </View>
   </ScrollView>
  </KeyboardAvoidingView>
 </SafeAreaView>;
}

const createS = (dark:boolean) => StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:C.bg},
 content:{paddingHorizontal:20,paddingTop:12,paddingBottom:36},
 back:{color:C.muted,paddingVertical:12,fontSize:13,fontWeight:"700"},
 brand:{fontSize:24,fontWeight:"900",letterSpacing:-0.6,color:C.ink,marginTop:22},
 title:{fontSize:26,fontWeight:"900",letterSpacing:-0.8,color:C.ink,marginTop:18},
 sub:{fontSize:13,color:C.muted,marginTop:9,lineHeight:20},
 card:{backgroundColor:"#FFFFFF",borderRadius:22,borderWidth:1,borderColor:C.line,padding:20,marginTop:24},
 socialRow:{flexDirection:"column",alignItems:"stretch",justifyContent:"center",gap:12,marginTop:16,marginBottom:6},
 socialItem:{minWidth:52,alignItems:"center",gap:7},
 googleLoginButton:{width:"100%",height:52,minHeight:52,maxHeight:52,paddingHorizontal:14,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#747775",borderRadius:12},
 googleConnectButton:{width:"100%",height:52,minHeight:52,maxHeight:52,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#747775",borderRadius:12},
 googleLoginButtonDark:{backgroundColor:"#131314",borderColor:"#8E918F"},
 googleLogoWrap:{width:24,height:24,borderRadius:12,backgroundColor:"#FFFFFF",alignItems:"center",justifyContent:"center"},
 googleLogo:{width:20,height:20},
 googleLoginText:{flexShrink:1,fontSize:14,lineHeight:20,fontWeight:"600",color:"#1F1F1F",textAlign:"center"},
 googleLoginTextDark:{color:"#E3E3E3"},
 kakaoLoginButton:{width:"100%",height:52,minHeight:52,maxHeight:52,justifyContent:"center",alignItems:"center",backgroundColor:"#FEE500",borderRadius:12,overflow:"hidden"},
 kakaoLoginImage:{width:"100%",height:54},
 kakaoLoading:{position:"absolute",fontSize:12,fontWeight:"800",color:"#000000",backgroundColor:"#FEE500",paddingHorizontal:10,paddingVertical:5,borderRadius:7},
 kakaoConnectButton:{width:"100%",height:52,minHeight:52,maxHeight:52,paddingHorizontal:12,alignItems:"center",justifyContent:"center",backgroundColor:"#FEE500",borderRadius:12},
 kakaoConnectText:{fontSize:13,fontWeight:"800",color:"#000000"},
 socialIconButton:{width:52,height:52,borderRadius:26,alignItems:"center",justifyContent:"center",borderWidth:1},
 googleIconCircle:{backgroundColor:"#FFFFFF",borderColor:"#DADCE0"},
 googleMark:{fontSize:23,fontWeight:"900",color:"#4285F4"},
 socialLabel:{fontSize:12,fontWeight:"700",color:dark?"#A1A1AA":C.muted},
 note:{fontSize:11,color:C.muted,lineHeight:18,marginTop:13},
 separator:{flexDirection:"row",alignItems:"center",gap:10,marginTop:24,marginBottom:4},
 separatorLine:{height:1,backgroundColor:C.line,flex:1},
 separatorText:{fontSize:11,color:C.muted,fontWeight:"600"},
 legacyLink:{alignItems:"center",paddingVertical:15},
 legacyLinkText:{fontSize:13,fontWeight:"800",color:C.purple},
 legacyTitle:{fontSize:16,fontWeight:"900",color:C.ink,marginBottom:4},
 label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:15,marginBottom:8},
 input:{height:50,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:14,fontSize:14,color:C.ink,backgroundColor:dark?"#242429":"#FFFFFF"},
 primary:{backgroundColor:C.purple,height:50,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:20},
 primaryText:{color:"#FFFFFF",fontSize:14,fontWeight:"900"},
 avatar:{height:58,width:58,borderRadius:19,backgroundColor:C.pale,alignItems:"center",justifyContent:"center",alignSelf:"center"},
 name:{fontSize:20,color:C.ink,fontWeight:"900",textAlign:"center",marginTop:12},
 connectedBox:{backgroundColor:C.pale,padding:14,borderRadius:16,marginTop:20},
 connectedTitle:{fontSize:13,fontWeight:"900",color:C.purple,marginBottom:4},
 info:{backgroundColor:C.pale,padding:15,borderRadius:16,marginTop:20},
 infoTitle:{fontWeight:"900",color:C.purple,marginBottom:6},
 deleteAccount:{alignItems:"center",paddingVertical:14,marginTop:8},
 deleteAccountText:{fontSize:12,color:"#B33A45",fontWeight:"800"},
 legalLinks:{flexDirection:"row",justifyContent:"center",alignItems:"center",gap:10,marginTop:20},
 legalLink:{fontSize:12,color:C.purple,fontWeight:"800"}
},dark));
