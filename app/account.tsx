import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",green:"#18875B",red:"#D04444"};
const valid=(s:string)=>/^[a-z0-9_]{3,24}$/.test(s);
const authEmail=(username:string)=>username+"@balletmate.app";

export default function Account(){
 const router=useRouter();
 const [mode,setMode]=useState<"login"|"signup">("login");
 const [name,setName]=useState("");
 const [pw,setPw]=useState("");
 const [confirm,setConfirm]=useState("");
 const [usernameState,setUsernameState]=useState<"idle"|"checking"|"available"|"taken"|"invalid">("idle");
 const [loading,setLoading]=useState(false);
 const [session,setSession]=useState<any>(null);
 const [display,setDisplay]=useState("");

 useEffect(()=>{
  if(!supabase)return;
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,nextSession)=>setSession(nextSession));
  return()=>subscription.unsubscribe();
 },[]);

 useEffect(()=>{
  let active=true;
  if(session?.user&&supabase){
   supabase.from("user_profiles").select("username").eq("user_id",session.user.id).maybeSingle()
    .then(({data})=>{if(active)setDisplay(data?.username||session.user.user_metadata?.username||"회원");});
  }else setDisplay("");
  return()=>{active=false;};
 },[session]);

 const changeUsername=(value:string)=>{
  setName(value.toLowerCase().replace(/[^a-z0-9_]/g,""));
  setUsernameState("idle");
 };
 const checkUsername=async()=>{
  if(!supabase){Alert.alert("설정 확인","Supabase 설정을 확인하세요.");return;}
  const username=name.trim().toLowerCase();
  if(!valid(username)){setUsernameState("invalid");return;}
  setUsernameState("checking");
  try{
   const {data,error}=await supabase.rpc("is_username_available",{candidate:username});
   if(error)throw error;
   setUsernameState(data===true?"available":"taken");
  }catch(error:any){
   setUsernameState("idle");
   Alert.alert("중복 확인 실패",error?.message||"연결 상태를 확인하고 다시 시도해 주세요.");
  }
 };

 const submit=async()=>{
  if(!supabase){Alert.alert("설정 확인","Supabase 설정을 확인하세요.");return;}
  const username=name.trim().toLowerCase();
  if(!valid(username)){Alert.alert("아이디 형식","3~24자, 영문 소문자·숫자·밑줄만 사용하세요.");return;}
  if(pw.length<8){Alert.alert("비밀번호","8자 이상 입력해 주세요.");return;}
  if(mode==="signup"){
   if(usernameState!=="available"){Alert.alert("아이디 중복 확인","먼저 아이디 중복 확인을 완료해 주세요.");return;}
   if(pw!==confirm){Alert.alert("비밀번호 확인","두 비밀번호가 일치하지 않습니다.");return;}
  }
  setLoading(true);
  try{
   if(mode==="signup"){
    const {data,error}=await supabase.auth.signUp({
     email:authEmail(username),
     password:pw,
     options:{data:{username}}
    });
    if(error)throw error;
    if(!data.user)throw new Error("가입 계정을 생성하지 못했습니다.");
    if(!data.session){
     Alert.alert("가입 요청 완료","계정은 생성됐지만 Supabase 이메일 확인 설정이 켜져 있어 바로 로그인할 수 없습니다. 관리자 설정에서 이메일 확인을 꺼야 합니다.");
     return;
    }
    Alert.alert("가입 완료","아이디와 비밀번호로 가입되었습니다.");
   }else{
    const {error}=await supabase.auth.signInWithPassword({email:authEmail(username),password:pw});
    if(error)throw error;
   }
  }catch(error:any){
   Alert.alert(mode==="signup"?"가입 실패":"로그인 실패",error?.message||"요청을 처리하지 못했습니다.");
  }finally{setLoading(false);}
 };

 const logout=async()=>{
  if(!supabase)return;
  const {error}=await supabase.auth.signOut();
  if(error)Alert.alert("로그아웃 실패",error.message);
 };
 const selectSignup=()=>{setMode("signup");setUsernameState("idle");setConfirm("");};

 return <SafeAreaView style={s.safe}>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}>
   <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
    <Text style={s.brand}>Balletmate<Text style={{color:C.purple}}>.</Text></Text>
    <Text style={s.title}>{session?"내 계정":"계정으로 더 편리하게"}</Text>
    <Text style={s.sub}>로그인 없이도 학원 탐색과 찜을 이용할 수 있어요.</Text>
    {session?
     <View style={s.card}>
      <View style={s.avatar}><Text style={{fontSize:24}}>🩰</Text></View>
      <Text style={s.name}>{display||"회원"}</Text>
      <Text style={s.sub}>로그인 중</Text>
      <Pressable style={s.primary} onPress={logout}><Text style={s.primaryText}>로그아웃</Text></Pressable>
     </View>
     :
     <View style={s.card}>
      <View style={s.tabs}>
       <Pressable style={[s.tab,mode==="login"&&s.tabOn]} onPress={()=>setMode("login")}><Text style={mode==="login"?s.tabTxtOn:s.tabTxt}>로그인</Text></Pressable>
       <Pressable style={[s.tab,mode==="signup"&&s.tabOn]} onPress={selectSignup}><Text style={mode==="signup"?s.tabTxtOn:s.tabTxt}>회원가입</Text></Pressable>
      </View>
      <Text style={s.label}>아이디</Text>
      <View style={s.row}>
       <TextInput style={[s.input,{flex:1}]} value={name} onChangeText={changeUsername} placeholder="영문 소문자·숫자·밑줄 (3~24자)" autoCapitalize="none" autoCorrect={false} maxLength={24}/>
       {mode==="signup"&&<Pressable style={[s.smallBtn,usernameState==="available"&&s.verified]} disabled={usernameState==="checking"||loading} onPress={checkUsername}><Text style={s.smallBtnText}>{usernameState==="checking"?"확인 중":"중복 확인"}</Text></Pressable>}
      </View>
      {mode==="signup"&&<Text style={[s.feedback,usernameState==="available"?{color:C.green}:usernameState==="taken"||usernameState==="invalid"?{color:C.red}:{ }]}>{usernameState==="available"?"사용 가능한 아이디입니다.":usernameState==="taken"?"이미 사용 중인 아이디입니다.":usernameState==="invalid"?"3~24자 영문 소문자·숫자·밑줄만 가능합니다.":""}</Text>}
      <Text style={s.label}>비밀번호</Text>
      <TextInput style={s.input} value={pw} onChangeText={setPw} placeholder="8자 이상" secureTextEntry autoCapitalize="none"/>
      {mode==="signup"&&<>
       <Text style={s.label}>비밀번호 확인</Text>
       <TextInput style={s.input} value={confirm} onChangeText={setConfirm} placeholder="비밀번호 다시 입력" secureTextEntry autoCapitalize="none"/>
       <Text style={[s.feedback,confirm.length>0?(pw===confirm?{color:C.green}:{color:C.red}):{}]}>{confirm.length>0?(pw===confirm?"비밀번호가 일치합니다.":"비밀번호가 일치하지 않습니다."):""}</Text>
      </>}
      <Pressable style={[s.primary,loading&&{opacity:.55}]} disabled={loading} onPress={submit}><Text style={s.primaryText}>{loading?"처리 중…":mode==="login"?"로그인":"회원가입"}</Text></Pressable>
      <Text style={s.note}>{mode==="signup"?"아이디 중복 확인과 비밀번호 확인만으로 가입할 수 있습니다. 휴대폰·이메일 입력이나 문자 인증은 없습니다.":"가입한 아이디와 비밀번호로 로그인하세요."}</Text>
     </View>
    }
    <View style={s.info}>
     <Text style={s.infoTitle}>계정 사용 안내</Text>
     <Text style={s.note}>• 로그인하면 찜 목록 동기화를 이용할 수 있습니다.</Text>
     <Text style={s.note}>• 학원 탐색은 로그인 없이 계속 이용할 수 있습니다.</Text>
     <Text style={s.note}>• 이메일 주소 대신 아이디로 가입하고 로그인합니다.</Text>
    </View>
   </ScrollView>
  </KeyboardAvoidingView>
 </SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},content:{paddingHorizontal:16,paddingTop:12,paddingBottom:24},back:{color:C.muted,paddingVertical:10,fontWeight:"700"},
 brand:{fontSize:22,fontWeight:"900",color:C.ink,marginTop:18},title:{fontSize:22,fontWeight:"900",color:C.ink,marginTop:14},
 sub:{fontSize:13,color:C.muted,marginTop:8,lineHeight:19},card:{backgroundColor:"#fff",borderRadius:18,borderWidth:1,borderColor:C.line,padding:16,marginTop:20},
 tabs:{flexDirection:"row",backgroundColor:"#F5F3F8",padding:4,borderRadius:12,marginBottom:12},tab:{flex:1,alignItems:"center",padding:10,borderRadius:9},
 tabOn:{backgroundColor:"#fff"},tabTxt:{color:C.muted,fontWeight:"700"},tabTxtOn:{color:C.purple,fontWeight:"800"},
 label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:12,marginBottom:7},input:{height:46,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:12,fontSize:14,color:C.ink},
 row:{flexDirection:"row",alignItems:"center",gap:8},smallBtn:{backgroundColor:C.purple,borderRadius:11,paddingHorizontal:12,height:46,justifyContent:"center"},
 smallBtnText:{color:"#fff",fontWeight:"800",fontSize:12},verified:{backgroundColor:C.green},feedback:{fontSize:11,fontWeight:"700",marginTop:5,minHeight:15},
 primary:{backgroundColor:C.purple,height:46,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:20},primaryText:{color:"#fff",fontWeight:"900"},
 note:{fontSize:11,color:C.muted,lineHeight:17,marginTop:12},avatar:{height:58,width:58,borderRadius:19,backgroundColor:C.pale,alignItems:"center",justifyContent:"center",alignSelf:"center"},
 name:{fontSize:20,color:C.ink,fontWeight:"900",textAlign:"center",marginTop:12},info:{backgroundColor:C.pale,padding:13,borderRadius:14,marginTop:18},
 infoTitle:{fontWeight:"900",color:C.purple,marginBottom:6}
});
