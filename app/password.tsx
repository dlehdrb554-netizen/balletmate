import React, {useState, useMemo} from "react";
import {themeStyles } from "../lib/theme";
import {Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {supabase} from "../lib/supabase";
const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",line:"#EAE7F0",pale:"#F3F0FF"};
export default function PasswordChange(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();const [current,setCurrent]=useState(""),[next,setNext]=useState(""),[confirm,setConfirm]=useState(""),[loading,setLoading]=useState(false),[requiresCurrent,setRequiresCurrent]=useState(true);
 React.useEffect(()=>{let active=true;(async()=>{if(!supabase)return;const {data:{user}}=await supabase.auth.getUser();if(!active)return;const identities=(user?.identities||[]) as Array<{provider?:string}>;setRequiresCurrent(identities.some(identity=>identity.provider==="email"));})();return()=>{active=false;};},[]);
 const valid=next.length>=8&&/[A-Z]/.test(next)&&/[a-z]/.test(next)&&/[0-9]/.test(next)&&/[^A-Za-z0-9]/.test(next);
 const submit=async()=>{if(!supabase)return;const {data:{user}}=await supabase.auth.getUser();if(!user?.email){Alert.alert("계정 확인","로그인 계정 이메일을 확인할 수 없습니다.");return;}if(requiresCurrent&&!current){Alert.alert("입력 확인","현재 비밀번호를 입력해 주세요.");return;}if(!valid){Alert.alert("비밀번호 조건","새 비밀번호 조건을 확인해 주세요.");return;}if(next!==confirm){Alert.alert("비밀번호 확인","새 비밀번호가 일치하지 않습니다.");return;}setLoading(true);try{if(requiresCurrent){const reauth=await supabase.auth.signInWithPassword({email:user.email,password:current});if(reauth.error)throw new Error("현재 비밀번호가 올바르지 않습니다.");}const changed=await supabase.auth.updateUser({password:next});if(changed.error)throw changed.error;setCurrent("");setNext("");setConfirm("");Alert.alert("변경 완료","비밀번호가 변경되었습니다.",[{text:"확인",onPress:()=>router.back()}]);}catch(e:any){Alert.alert("변경 실패",e?.message||"비밀번호를 변경하지 못했습니다.");}finally{setLoading(false);}};
 return <SafeAreaView style={s.safe}><View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable><Text style={s.title}>{requiresCurrent?"발레메이트 비밀번호 변경":"발레메이트 비밀번호 설정"}</Text></View><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
 {requiresCurrent&&<><Text style={s.label}>현재 발레메이트 비밀번호</Text><TextInput style={s.input} value={current} onChangeText={setCurrent} secureTextEntry placeholder="현재 비밀번호"/></> }
 <Text style={s.label}>새 발레메이트 비밀번호</Text><TextInput style={s.input} value={next} onChangeText={setNext} secureTextEntry placeholder="새 비밀번호"/>
 <Text style={s.label}>새 비밀번호 확인</Text><TextInput style={s.input} value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="새 비밀번호 다시 입력"/>
 <View style={s.guide}><Text style={s.guideTitle}>비밀번호 설정 조건</Text><Text style={s.guideText}>{requiresCurrent?"Google·카카오 로그인 비밀번호가 아닌 발레메이트 계정 비밀번호입니다.":"소셜 로그인 회원은 현재 로그인 세션을 확인한 뒤 발레메이트 비밀번호를 설정합니다."}</Text><Text style={s.guideText}>• 8자 이상</Text><Text style={s.guideText}>• 영문 대문자 1개 이상</Text><Text style={s.guideText}>• 영문 소문자 1개 이상</Text><Text style={s.guideText}>• 숫자 1개 이상</Text><Text style={s.guideText}>• 특수문자 1개 이상</Text></View>
 <Pressable disabled={loading} style={[s.button,loading&&{opacity:.5}]} onPress={submit}><Text style={s.buttonText}>{loading?"저장 중…":requiresCurrent?"비밀번호 변경":"비밀번호 설정"}</Text></Pressable>
 </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const createS = (dark:boolean) => StyleSheet.create(themeStyles({safe:{flex:1,backgroundColor:C.bg},header:{padding:16,borderBottomWidth:1,borderColor:C.line},back:{fontSize:12,color:C.purple,fontWeight:"800"},title:{fontSize:19,fontWeight:"900",color:C.ink,marginTop:10},body:{padding:18},label:{fontSize:13,fontWeight:"800",color:C.ink,marginTop:16,marginBottom:7},input:{height:48,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:13,backgroundColor:"#fff",fontSize:14,color:C.ink},guide:{backgroundColor:C.pale,padding:14,borderRadius:13,marginTop:20,gap:5},guideTitle:{fontSize:13,fontWeight:"900",color:C.purple,marginBottom:4},guideText:{fontSize:12,color:C.muted,lineHeight:18},button:{height:49,backgroundColor:C.purple,borderRadius:13,alignItems:"center",justifyContent:"center",marginTop:22},buttonText:{fontSize:14,fontWeight:"900",color:"#fff"}},dark));
