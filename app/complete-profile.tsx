import React, {useEffect, useState, useMemo} from "react";
import {themeStyles} from "../lib/theme";
import {ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import {useRouter} from "expo-router";
import {SafeAreaView} from "react-native-safe-area-context";
import {supabase} from "../lib/supabase";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F3F0FF",line:"#EAE7F0"};
export default function CompleteProfile(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [confirmPassword,setConfirmPassword]=useState("");
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [signedIn,setSignedIn]=useState(false);

 useEffect(()=>{
  let active=true;
  const load=async()=>{
   if(!supabase){if(active)setLoading(false);return;}
   const {data:{session},error}=await supabase.auth.getSession();
   if(!active)return;
   if(error||!session){setSignedIn(false);setLoading(false);return;}
   setSignedIn(true);
   const {data:profile}=await supabase.from("user_profiles").select("username").eq("user_id",session.user.id).maybeSingle();
   if(!active)return;
   if(profile?.username&&!profile.username.startsWith("social_")){
    router.replace("/account");
    return;
   }
   const meta=session.user.user_metadata||{};
   const suggested=String(meta.full_name||meta.name||meta.nickname||"").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
   if(suggested.length>=3)setUsername(suggested);
   setLoading(false);
  };
  void load();
  return()=>{active=false;};
 },[]);

 const submit=async()=>{
  const value=username.trim().toLowerCase();
  if(!/^[a-z0-9_]{3,24}$/.test(value)){
   Alert.alert("아이디 확인","영문 소문자, 숫자, 밑줄(_)을 사용해 3~24자로 입력해 주세요.");
   return;
  }
  const passwordValid=password.length>=8&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/[0-9]/.test(password)&&/[^A-Za-z0-9]/.test(password);
  if(!passwordValid){Alert.alert("비밀번호 확인","8자 이상이며 영문 대문자·소문자·숫자·특수문자를 각각 포함해 주세요.");return;}
  if(password!==confirmPassword){Alert.alert("비밀번호 확인","비밀번호가 일치하지 않습니다.");return;}
  if(!supabase)return;
  setSaving(true);
  try{
   const {data:available,error:checkError}=await supabase.rpc("is_username_available",{candidate:value});
   if(checkError)throw checkError;
   if(available!==true)throw new Error("이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.");
   const {error:updateError}=await supabase.auth.updateUser({password,data:{username:value}});
   if(updateError)throw updateError;
   const {data:{user}}=await supabase.auth.getUser();
   if(!user)throw new Error("로그인 정보를 확인할 수 없습니다.");
   const {data:profile,error:profileError}=await supabase.from("user_profiles").select("username").eq("user_id",user.id).maybeSingle();
   if(profileError)throw profileError;
   if(profile?.username!==value)throw new Error("계정 정보 저장을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
   router.replace("/account");
  }catch(error:any){
   Alert.alert("계정 생성 실패",error?.message||"잠시 후 다시 시도해 주세요.");
  }finally{setSaving(false);}
 };

 if(loading)return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator size="large" color={C.purple}/><Text style={s.muted}>가입 정보를 확인하고 있어요.</Text></View></SafeAreaView>;
 if(!signedIn)return <SafeAreaView style={s.safe}><View style={s.center}><Text style={s.title}>로그인이 필요해요</Text><Pressable style={s.button} onPress={()=>router.replace("/account")}><Text style={s.buttonText}>로그인 화면으로</Text></Pressable></View></SafeAreaView>;

 return <SafeAreaView style={s.safe}>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}>
   <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.brand}>Balletmate<Text style={{color:C.purple}}>.</Text></Text>
    <View style={s.card}>
     <View style={s.icon}><Text style={{fontSize:27}}>🩰</Text></View>
     <Text style={s.title}>발레메이트 가입을 완료해 주세요</Text>
     <Text style={s.desc}>소셜 인증이 완료되었습니다. 서비스에서 사용할 내부 계정 아이디를 정하면 가입이 끝나요.</Text>
     <View style={{backgroundColor:isDark?"#2A2418":"#FFF7E8",borderRadius:12,padding:12,marginBottom:18}}>
      <Text style={{fontSize:12,lineHeight:19,color:isDark?"#E8D6A8":"#805B24"}}>이미 발레메이트 계정이 있거나 관리자 계정이라면 새 아이디를 만들지 마세요. 로그아웃 후 기존 아이디로 로그인한 다음 내 계정에서 Google 또는 카카오를 연결해야 기존 권한과 데이터가 유지됩니다. 현재 소셜 계정은 별도 계정일 수 있습니다.</Text>
     </View>
     <Text style={s.label}>사용할 아이디</Text>
     <TextInput style={s.input} value={username} onChangeText={setUsername} placeholder="영문 소문자, 숫자, 밑줄" autoCapitalize="none" autoCorrect={false} maxLength={24}/>
     <Text style={s.hint}>3~24자 · 영문 소문자, 숫자, 밑줄(_) 사용 가능</Text>
     <Text style={[s.label,{marginTop:18}]}>발레메이트 비밀번호 설정</Text>
     <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="발레메이트 비밀번호" secureTextEntry autoCapitalize="none" autoCorrect={false}/>
     <Text style={[s.label,{marginTop:14}]}>비밀번호 확인</Text>
     <TextInput style={s.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="비밀번호 다시 입력" secureTextEntry autoCapitalize="none" autoCorrect={false}/>
     <Text style={s.hint}>8자 이상 · 영문 대문자 · 영문 소문자 · 숫자 · 특수문자 포함</Text>
     <Pressable style={[s.button,saving&&{opacity:.6}]} disabled={saving} onPress={submit}><Text style={s.buttonText}>{saving?"저장 중…":"가입 완료"}</Text></Pressable>
     <Pressable style={s.logout} onPress={async()=>{await supabase?.auth.signOut();router.replace("/account");}}><Text style={s.logoutText}>다른 계정으로 로그인</Text></Pressable>
    </View>
   </ScrollView>
  </KeyboardAvoidingView>
 </SafeAreaView>;
}
const createS=(dark:boolean)=>StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:C.bg},content:{flexGrow:1,justifyContent:"center",padding:20},
 brand:{fontSize:22,fontWeight:"900",color:C.ink,marginBottom:22},
 card:{backgroundColor:"#fff",borderWidth:1,borderColor:C.line,borderRadius:20,padding:20},
 icon:{width:58,height:58,borderRadius:18,backgroundColor:C.pale,alignItems:"center",justifyContent:"center",alignSelf:"center",marginBottom:16},
 title:{fontSize:21,fontWeight:"900",color:C.ink,textAlign:"center",lineHeight:29},
 desc:{fontSize:13,color:C.muted,textAlign:"center",lineHeight:20,marginTop:10,marginBottom:24},
 label:{fontSize:13,fontWeight:"800",color:C.ink,marginBottom:8},
 input:{height:50,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:14,fontSize:15,color:C.ink},
 hint:{fontSize:11,color:C.muted,marginTop:8},
 button:{height:50,backgroundColor:C.purple,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:22},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:14},
 logout:{alignItems:"center",paddingVertical:14},logoutText:{fontSize:12,color:C.muted,fontWeight:"700"},
 center:{flex:1,alignItems:"center",justifyContent:"center",padding:24},muted:{color:C.muted,marginTop:12}
},dark));;