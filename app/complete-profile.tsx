import React,{useEffect,useState} from "react";
import {ActivityIndicator,Alert,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {useRouter} from "expo-router";
import {SafeAreaView} from "react-native-safe-area-context";
import {supabase} from "../lib/supabase";

const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0"};
export default function CompleteProfile(){
 const router=useRouter();
 const [username,setUsername]=useState("");
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
  if(!supabase)return;
  setSaving(true);
  try{
   const {data:available,error:checkError}=await supabase.rpc("is_username_available",{candidate:value});
   if(checkError)throw checkError;
   if(available!==true)throw new Error("이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.");
   const {error:updateError}=await supabase.auth.updateUser({data:{username:value}});
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
     <Text style={s.label}>사용할 아이디</Text>
     <TextInput style={s.input} value={username} onChangeText={setUsername} placeholder="영문 소문자, 숫자, 밑줄" autoCapitalize="none" autoCorrect={false} maxLength={24}/>
     <Text style={s.hint}>3~24자 · 영문 소문자, 숫자, 밑줄(_) 사용 가능</Text>
     <Pressable style={[s.button,saving&&{opacity:.6}]} disabled={saving} onPress={submit}><Text style={s.buttonText}>{saving?"저장 중…":"가입 완료"}</Text></Pressable>
     <Pressable style={s.logout} onPress={async()=>{await supabase?.auth.signOut();router.replace("/account");}}><Text style={s.logoutText}>다른 계정으로 로그인</Text></Pressable>
    </View>
   </ScrollView>
  </KeyboardAvoidingView>
 </SafeAreaView>;
}
const s=StyleSheet.create({
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
});