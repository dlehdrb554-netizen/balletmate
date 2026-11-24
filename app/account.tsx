import React, { useEffect, useState } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",green:"#18875B",yellow:"#FEE500"};
const OAUTH_REDIRECT_URL="balletmate://auth/callback";

export default function Account(){
 const router=useRouter();
 const [legacyLogin,setLegacyLogin]=useState(false);
 const [name,setName]=useState("");
 const [pw,setPw]=useState("");
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
  setLoadingProvider(provider);
  try{
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
   Alert.alert("소셜 로그인 실패",error?.message||"잠시 후 다시 시도해 주세요.");
  }finally{setLoadingProvider(null);}
 };

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
   Alert.alert("계정 연결 실패",error?.message||"잠시 후 다시 시도해 주세요.");
  }finally{setLoadingProvider(null);}
 };

 const submitLegacyLogin=async()=>{
  if(!supabase){Alert.alert("설정 확인","Supabase 설정을 확인하세요.");return;}
  const username=name.trim().toLowerCase();
  if(!/^[a-z0-9_]{3,24}$/.test(username)||!pw){Alert.alert("입력 확인","기존 계정 아이디와 비밀번호를 입력해 주세요.");return;}
  setLoading(true);
  try{
   const {error}=await supabase.auth.signInWithPassword({email:username+"@balletmate.app",password:pw});
   if(error)throw error;
  }catch(error:any){
   Alert.alert("로그인 실패",error?.message||"아이디와 비밀번호를 확인해 주세요.");
  }finally{setLoading(false);}
 };

 const logout=async()=>{
  if(!supabase)return;
  const {error}=await supabase.auth.signOut();
  if(error)Alert.alert("로그아웃 실패",error.message);
 };
 const deleteAccount=()=>{
  const client=supabase;
  if(!client)return;
  Alert.alert(
   "회원 탈퇴",
   "계정을 영구 삭제합니다. 연결된 회원 프로필과 즐겨찾기 등 계정 데이터도 삭제되며 되돌릴 수 없습니다. 계속할까요?",
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
      Alert.alert("탈퇴 실패",error?.message||"계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
     }finally{setLoading(false);}
    }}
   ]
  );
 };
 const identities=(session?.user?.identities||[]) as Array<{provider?:string}>;
 const connected=(provider:string)=>identities.some(identity=>identity.provider===provider);

 return <SafeAreaView style={s.safe}>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}>
   <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
    <Text style={s.brand}>Balletmate<Text style={{color:C.purple}}>.</Text></Text>
    <Text style={s.title}>{session?"내 계정":"간편하게 시작하기"}</Text>
    <Text style={s.sub}>{session?"로그인 정보와 연결된 계정을 관리할 수 있어요.":"Google 또는 Kakao 계정으로 빠르게 가입하고 로그인하세요."}</Text>
    {session?
     <View style={s.card}>
      <View style={s.avatar}><MaterialCommunityIcons name="human-female-dance" size={30} color={C.purple} /></View>
      <Text style={s.name}>{display||"회원"}</Text>
      <Text style={s.sub}>{adminRole===true?"관리자 계정 · 관리자 권한 확인됨":adminRole===false?"일반 회원 계정":"계정 권한 확인 중"}</Text>
      <View style={s.connectedBox}>
       <Text style={s.connectedTitle}>소셜 계정 연결</Text>
       <Pressable style={s.googleButton} disabled={!!loadingProvider||connected("google")} onPress={()=>linkSocial("google")}>
        <Text style={s.googleText}>{connected("google")?"✓ Google 연결됨":loadingProvider==="google"?"연결 중…":"Google 계정 연결"}</Text>
       </Pressable>
       <Pressable style={s.kakaoButton} disabled={!!loadingProvider||connected("kakao")} onPress={()=>linkSocial("kakao")}>
        <Text style={s.kakaoText}>{connected("kakao")?"✓ Kakao 연결됨":loadingProvider==="kakao"?"연결 중…":"카카오 계정 연결"}</Text>
       </Pressable>
      </View>
      <Pressable style={s.primary} disabled={loading} onPress={logout}><Text style={s.primaryText}>로그아웃</Text></Pressable>
      <Pressable style={s.deleteAccount} disabled={loading} onPress={deleteAccount}><Text style={s.deleteAccountText}>{loading?"처리 중…":"회원 탈퇴"}</Text></Pressable>
     </View>
     :
     <View style={s.card}>
      {!legacyLogin?
       <>
        <Pressable style={s.googleButton} disabled={!!loadingProvider} onPress={()=>signInSocial("google")}>
         <Text style={s.googleMark}>G</Text>
         <Text style={s.googleText}>{loadingProvider==="google"?"Google 연결 중…":"Google로 계속하기"}</Text>
        </Pressable>
        <Pressable style={s.kakaoButton} disabled={!!loadingProvider} onPress={()=>signInSocial("kakao")}>
         <MaterialCommunityIcons name="chat" size={19} color="#191600"/>
         <Text style={s.kakaoText}>{loadingProvider==="kakao"?"카카오 연결 중…":"카카오로 계속하기"}</Text>
        </Pressable>
        <Text style={s.note}>처음 이용하면 자동으로 회원가입되고, 이미 가입한 계정이면 로그인됩니다.</Text>
        <View style={s.separator}><View style={s.separatorLine}/><Text style={s.separatorText}>또는</Text><View style={s.separatorLine}/></View>
        <Pressable style={s.legacyLink} onPress={()=>setLegacyLogin(true)}><Text style={s.legacyLinkText}>기존 아이디 계정으로 로그인</Text></Pressable>
       </>
       :
       <>
        <Text style={s.legacyTitle}>기존 계정 로그인</Text>
        <Text style={s.label}>아이디</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="기존 아이디" autoCapitalize="none" autoCorrect={false} maxLength={24}/>
        <Text style={s.label}>비밀번호</Text>
        <TextInput style={s.input} value={pw} onChangeText={setPw} placeholder="비밀번호" secureTextEntry autoCapitalize="none"/>
        <Pressable style={[s.primary,loading&&{opacity:.55}]} disabled={loading} onPress={submitLegacyLogin}><Text style={s.primaryText}>{loading?"로그인 중…":"로그인"}</Text></Pressable>
        <Pressable style={s.legacyLink} onPress={()=>setLegacyLogin(false)}><Text style={s.legacyLinkText}>‹ 소셜 로그인으로 돌아가기</Text></Pressable>
       </>
      }
     </View>
    }
    <View style={s.legalLinks}>
     <Pressable onPress={()=>router.push("/privacy")}><Text style={s.legalLink}>개인정보처리방침</Text></Pressable>
     <Text style={s.note}>·</Text>
     <Pressable onPress={()=>router.push("/terms")}><Text style={s.legalLink}>서비스 이용약관</Text></Pressable>
    </View>
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

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},content:{paddingHorizontal:16,paddingTop:8,paddingBottom:24},back:{color:C.muted,paddingVertical:10,fontWeight:"700"},
 brand:{fontSize:22,fontWeight:"900",color:C.ink,marginTop:18},title:{fontSize:22,fontWeight:"900",color:C.ink,marginTop:14},
 sub:{fontSize:13,color:C.muted,marginTop:8,lineHeight:19},card:{backgroundColor:"#fff",borderRadius:18,borderWidth:1,borderColor:C.line,padding:16,marginTop:20},
 googleButton:{height:50,borderWidth:1,borderColor:C.line,borderRadius:13,backgroundColor:"#fff",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,marginTop:10},
 googleMark:{fontSize:19,fontWeight:"900",color:"#4285F4"},googleText:{fontSize:14,fontWeight:"800",color:C.ink},
 kakaoButton:{height:50,borderRadius:13,backgroundColor:C.yellow,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,marginTop:10},
 kakaoText:{fontSize:14,fontWeight:"900",color:"#191600"},
 note:{fontSize:11,color:C.muted,lineHeight:17,marginTop:12},separator:{flexDirection:"row",alignItems:"center",gap:10,marginTop:22},
 separatorLine:{height:1,backgroundColor:C.line,flex:1},separatorText:{fontSize:11,color:C.muted},
 legacyLink:{alignItems:"center",paddingVertical:13},legacyLinkText:{fontSize:12,fontWeight:"800",color:C.purple},
 legacyTitle:{fontSize:17,fontWeight:"900",color:C.ink,marginBottom:8},
 label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:12,marginBottom:7},
 input:{height:46,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:12,fontSize:14,color:C.ink},
 primary:{backgroundColor:C.purple,height:46,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:20},primaryText:{color:"#fff",fontWeight:"900"},
 avatar:{height:58,width:58,borderRadius:19,backgroundColor:C.pale,alignItems:"center",justifyContent:"center",alignSelf:"center"},
 name:{fontSize:20,color:C.ink,fontWeight:"900",textAlign:"center",marginTop:12},
 connectedBox:{backgroundColor:C.pale,padding:12,borderRadius:14,marginTop:20},connectedTitle:{fontSize:13,fontWeight:"900",color:C.purple,marginBottom:4},
 info:{backgroundColor:C.pale,padding:13,borderRadius:14,marginTop:18},infoTitle:{fontWeight:"900",color:C.purple,marginBottom:6},
 deleteAccount:{alignItems:"center",paddingVertical:14,marginTop:8},deleteAccountText:{fontSize:12,color:"#B33A45",fontWeight:"800"},
 legalLinks:{flexDirection:"row",justifyContent:"center",alignItems:"center",gap:10,marginTop:20},legalLink:{fontSize:12,color:C.purple,fontWeight:"800"}
});
