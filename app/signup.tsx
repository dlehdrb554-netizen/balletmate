import React, {useMemo, useState} from "react";
import { getUserErrorMessage } from "../lib/error-utils";
import {themeStyles} from "../lib/theme";
import {Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import {MaterialCommunityIcons} from "@expo/vector-icons";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {supabase} from "../lib/supabase";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#625E70",purple:"#653BB7",line:"#EAE7F0",pale:"#F3F0FF"};
export default function Signup(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const [email,setEmail]=useState("");
 const [display,setDisplay]=useState("");
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState("");
 const [showPassword,setShowPassword]=useState(false);
 const [showConfirm,setShowConfirm]=useState(false);
 const [busy,setBusy]=useState(false);
 const valid=password.length>=8&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/[0-9]/.test(password)&&/[^A-Za-z0-9]/.test(password);
 const emailValid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
 const usernameValid=/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase());
 const displayValid=display.trim().length>=2&&display.trim().length<=20;
 const confirmValid=confirm.length>0&&password===confirm;
 const submit=async()=>{
  if(!supabase)return;
  const em=email.trim().toLowerCase(),un=username.trim().toLowerCase(),dn=display.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){Alert.alert("이메일 확인","인증 메일을 받을 이메일 주소를 입력해 주세요.");return;}
  if(!/^[a-z0-9_]{3,24}$/.test(un)){Alert.alert("계정 확인","계정은 영문 소문자, 숫자, 밑줄로 3~24자 입력해 주세요.");return;}
  if(dn.length<2||dn.length>20){Alert.alert("닉네임 확인","닉네임은 2~20자로 입력해 주세요.");return;}
  if(!valid){Alert.alert("비밀번호 확인","비밀번호 조건을 확인해 주세요.");return;}
  if(password!==confirm){Alert.alert("비밀번호 확인","비밀번호가 일치하지 않습니다.");return;}
  setBusy(true);
  try{
   const check=await supabase.rpc("is_username_available",{candidate:un});
   if(check.error)throw check.error;
   if(!check.data)throw new Error("이미 사용 중인 계정입니다.");
   const result=await supabase.auth.signUp({email:em,password,options:{data:{username:un,display_name:dn},emailRedirectTo:"balletmate://auth/callback"}});
   if(result.error)throw result.error;
   if(result.data.session)Alert.alert("가입 완료","회원가입이 완료되었습니다.",[{text:"확인",onPress:()=>router.replace("/") }]);
   else Alert.alert("이메일 인증 필요","입력한 이메일로 인증 링크를 보냈습니다. 메일을 확인한 뒤 로그인해 주세요.",[{text:"확인",onPress:()=>router.replace("/account")}]);
  }catch(e:any){Alert.alert("회원가입 실패",getUserErrorMessage(e,"가입을 완료하지 못했습니다."));}
  finally{setBusy(false);}
 };
 const passwordInput=(value:string,setter:(value:string)=>void,visible:boolean,toggle:()=>void,confirmField=false)=>(
  <View style={s.passwordWrap}>
   <TextInput style={s.passwordInput} value={value} onChangeText={setter} placeholder={confirmField?"비밀번호 다시 입력":"영문·숫자·특수문자 조합"} placeholderTextColor={isDark?"#A1A1AA":"#8A8695"} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="newPassword" returnKeyType={confirmField?"done":"next"} onSubmitEditing={confirmField?submit:undefined}/>
   <Pressable style={s.eyeButton} onPress={toggle} hitSlop={8} accessibilityRole="button" accessibilityLabel={visible?"비밀번호 숨기기":"비밀번호 표시"} accessibilityState={{selected:visible}}>
    <MaterialCommunityIcons name={visible?"eye-off-outline":"eye-outline"} size={21} color={isDark?"#D4D4D8":C.muted}/>
   </Pressable>
  </View>
 );
 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="뒤로가기"><Text style={s.back}>‹ 돌아가기</Text></Pressable>
   <Text style={s.title}>회원가입</Text>
  </View>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}>
   <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Text style={s.desc}>발레메이트 계정을 만들고 학원 정보를 저장해 보세요.</Text>
    <Text style={s.requiredHint}>모든 항목을 입력해 주세요.</Text>
    <Text style={s.label}>이메일</Text>
    <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="인증 메일을 받을 이메일" placeholderTextColor={isDark?"#A1A1AA":"#8A8695"} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" maxLength={254} returnKeyType="next"/>
    {email.length>0&&!emailValid&&<Text style={s.fieldHint}>이메일 주소 형식을 확인해 주세요.</Text>}
    <Text style={s.label}>닉네임</Text>
    <TextInput style={s.input} value={display} onChangeText={setDisplay} placeholder="2~20자" placeholderTextColor={isDark?"#A1A1AA":"#8A8695"} maxLength={20} autoCapitalize="none" autoCorrect={false} returnKeyType="next"/>
    {display.length>0&&!displayValid&&<Text style={s.fieldHint}>닉네임은 2~20자로 입력해 주세요.</Text>}
    <Text style={s.label}>계정</Text>
    <TextInput style={s.input} value={username} onChangeText={value=>setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="영문 소문자·숫자·밑줄 3~24자" placeholderTextColor={isDark?"#A1A1AA":"#8A8695"} maxLength={24} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" returnKeyType="next"/>
    {username.length>0&&!usernameValid&&<Text style={s.fieldHint}>영문 소문자·숫자·밑줄로 3~24자 입력해 주세요.</Text>}
    <Text style={s.label}>비밀번호</Text>
    {passwordInput(password,setPassword,showPassword,()=>setShowPassword(v=>!v))}
    <View style={s.guide}>
     <Text style={s.guideTitle}>비밀번호 조건</Text>
     <Text style={s.guideText}>8자 이상 · 영문 대문자 · 영문 소문자 · 숫자 · 특수문자 포함</Text>
     <Text style={[s.validationText,valid?s.validText:s.pendingText]}>{valid?"✓ 비밀번호 조건을 충족했어요.":"조건을 모두 충족하면 가입할 수 있어요."}</Text>
    </View>
    <Text style={s.label}>비밀번호 확인</Text>
    {passwordInput(confirm,setConfirm,showConfirm,()=>setShowConfirm(v=>!v),true)}
    {confirm.length>0&&<Text style={[s.matchText,confirmValid?s.validText:s.errorText]}>{confirmValid?"✓ 비밀번호가 일치합니다.":"비밀번호가 일치하지 않습니다."}</Text>}
    <Pressable style={[s.button,busy&&s.buttonDisabled]} disabled={busy} onPress={submit} accessibilityRole="button" accessibilityState={{disabled:busy}}>
     <Text style={s.buttonText}>{busy?"가입 처리 중…":"이메일 인증 후 가입"}</Text>
    </Pressable>
    <Text style={s.footerNote}>가입 버튼을 누르면 이메일 인증 링크가 발송됩니다.</Text>
   </ScrollView>
  </KeyboardAvoidingView>
 </SafeAreaView>;
}
const createS=(dark:boolean)=>StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:C.bg},
 header:{paddingHorizontal:20,paddingTop:12,paddingBottom:16,borderBottomWidth:1,borderColor:C.line},
 back:{fontSize:13,color:C.purple,fontWeight:"800",paddingVertical:6},
 title:{fontSize:24,fontWeight:"900",letterSpacing:-0.5,color:C.ink,marginTop:12},
 body:{paddingHorizontal:20,paddingTop:20,paddingBottom:48},
 desc:{fontSize:13,color:C.muted,lineHeight:20},
 requiredHint:{fontSize:11,color:C.muted,marginTop:7},
 label:{fontSize:13,fontWeight:"800",color:C.ink,marginTop:19,marginBottom:8},
 input:{height:52,borderWidth:1,borderColor:C.line,borderRadius:13,paddingHorizontal:14,backgroundColor:dark?"#242429":"#FFFFFF",fontSize:14,color:dark?"#FFFFFF":C.ink},
 fieldHint:{fontSize:11,color:"#D34B55",marginTop:6},
 passwordWrap:{height:52,flexDirection:"row",alignItems:"center",borderWidth:1,borderColor:C.line,borderRadius:13,backgroundColor:dark?"#242429":"#FFFFFF",paddingLeft:14,paddingRight:5},
 passwordInput:{flex:1,height:"100%",fontSize:14,color:dark?"#FFFFFF":C.ink,padding:0},
 eyeButton:{width:44,height:44,alignItems:"center",justifyContent:"center"},
 guide:{backgroundColor:C.pale,padding:14,borderRadius:14,marginTop:12},
 guideTitle:{fontSize:12,fontWeight:"900",color:C.purple},
 guideText:{fontSize:11,color:C.muted,marginTop:6,lineHeight:18},
 validationText:{fontSize:11,fontWeight:"700",marginTop:8},
 pendingText:{color:C.muted},
 validText:{color:"#18875B"},
 errorText:{color:"#D34B55"},
 matchText:{fontSize:11,fontWeight:"700",marginTop:7},
 button:{height:52,backgroundColor:C.purple,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:26},
 buttonDisabled:{opacity:0.55},
 buttonText:{fontSize:14,fontWeight:"900",color:"#FFFFFF"},
 footerNote:{fontSize:11,color:C.muted,textAlign:"center",lineHeight:17,marginTop:13}
},dark));
