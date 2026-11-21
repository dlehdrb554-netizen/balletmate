import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

type StudioRow = {
  id:string; name:string; latitude:number; longitude:number; district:string|null;
  address:string|null; phone:string|null; price_per_class:number|null;
  adult_classes:boolean; kids_classes:boolean; is_active:boolean;
};

const blank = {name:"",latitude:"",longitude:"",district:"",address:"",phone:"",price_per_class:"",adult_classes:true,kids_classes:false,is_active:false};
const c = {ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",white:"#FFFFFF",bg:"#FAF9FC"};

export default function Admin() {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [session,setSession]=useState<any>(null);
  const [authorized,setAuthorized]=useState(false);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [rows,setRows]=useState<StudioRow[]>([]);
  const [form,setForm]=useState({...blank});
  const [editing,setEditing]=useState<string|null>(null);

  const checkAdmin=useCallback(async(s:any)=>{
    if(!s){setAuthorized(false);setChecking(false);return;}
    setChecking(true);
    const {data,error}=await supabase!.rpc("is_balletmate_admin");
    setAuthorized(!error&&data===true);
    setChecking(false);
  },[]);

  useEffect(()=>{
    if(!supabase){setChecking(false);return;}
    supabase.auth.getSession().then(({data})=>{setSession(data.session);checkAdmin(data.session);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);checkAdmin(s);});
    return ()=>subscription.unsubscribe();
  },[checkAdmin]);

  const load=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setBusy(true);
    const {data,error}=await supabase.from("studios").select("id,name,latitude,longitude,district,address,phone,price_per_class,adult_classes,kids_classes,is_active").order("name").limit(500);
    if(error)Alert.alert("조회 실패",error.message);else setRows(data||[]);
    setBusy(false);
  },[authorized]);
  useEffect(()=>{load();},[load]);

  const login=async()=>{
    if(!supabase)return;
    setBusy(true);
    const normalized=username.trim().toLowerCase();\n    if(!/^[a-z0-9_]{3,24}$/.test(normalized)){Alert.alert("아이디 확인","아이디는 영문 소문자, 숫자, 밑줄로 3~24자 입력하세요.");setBusy(false);return;}\n    const {data,error}=await supabase.auth.signInWithPassword({email:normalized+"@balletmate.app",password});
    if(error)Alert.alert("로그인 실패",error.message);else {setSession(data.session);await checkAdmin(data.session);}
    setBusy(false);
  };
  const logout=async()=>{await supabase?.auth.signOut();setSession(null);setAuthorized(false);};
  const startEdit=(r:StudioRow)=>{
    setEditing(r.id);setForm({name:r.name,latitude:String(r.latitude),longitude:String(r.longitude),district:r.district||"",address:r.address||"",phone:r.phone||"",price_per_class:r.price_per_class==null?"":String(r.price_per_class),adult_classes:r.adult_classes,kids_classes:r.kids_classes,is_active:r.is_active});
  };
  const reset=()=>{setEditing(null);setForm({...blank});};
  const save=async()=>{
    if(!supabase)return;
    if(!form.name.trim()||!form.latitude.trim()||!form.longitude.trim()){Alert.alert("필수 정보","학원명과 위도/경도를 입력하세요.");return;}
    const lat=Number(form.latitude),lng=Number(form.longitude),price=form.price_per_class.trim()?Number(form.price_per_class):null;
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lng)||lng < -180||lng > 180|| (price!==null&&(!Number.isFinite(price)||price<0))){Alert.alert("입력 확인","좌표 또는 가격이 올바르지 않습니다.");return;}
    const payload={name:form.name.trim(),latitude:lat,longitude:lng,district:form.district.trim()||null,address:form.address.trim()||null,phone:form.phone.trim()||null,price_per_class:price,adult_classes:form.adult_classes,kids_classes:form.kids_classes,is_active:form.is_active,updated_at:new Date().toISOString()};
    setBusy(true);
    const q=editing?supabase.from("studios").update(payload).eq("id",editing):supabase.from("studios").insert(payload);
    const {error}=await q;
    if(error)Alert.alert("저장 실패",error.message);else{Alert.alert("저장 완료",form.is_active?"앱 공개 목록에 반영됩니다.":"비공개 상태로 저장했습니다.");reset();await load();}
    setBusy(false);
  };
  const remove=(id:string,name:string)=>Alert.alert("학원 삭제",name+" 정보를 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{setBusy(true);const {error}=await supabase!.from("studios").delete().eq("id",id);if(error)Alert.alert("삭제 실패",error.message);else await load();setBusy(false);}}]);
  const field=(label:string,key:keyof typeof blank,keyboard:any="default")=><View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={String(form[key])} onChangeText={v=>setForm(f=>({...f,[key]:v}))} keyboardType={keyboard} placeholder={label}/></View>;
  const toggle=(label:string,key:"adult_classes"|"kids_classes"|"is_active")=><Pressable onPress={()=>setForm(f=>({...f,[key]:!f[key]}))} style={styles.toggle}><Text style={[styles.toggleText,form[key]&&styles.toggleOn]}>{form[key]?"✓ ":"○ "}{label}</Text></Pressable>;

  if(checking)return <SafeAreaView style={styles.safe}><ActivityIndicator style={{marginTop:50}} color={c.purple}/></SafeAreaView>;
  if(!session)return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>Balletmate 관리자</Text><Text style={styles.hint}>관리자 계정으로 로그인하세요.</Text><TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="관리자 아이디" autoCapitalize="none"/><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="비밀번호" secureTextEntry/><Pressable style={styles.button} onPress={login} disabled={busy}><Text style={styles.buttonText}>{busy?"처리 중…":"로그인"}</Text></Pressable></View></SafeAreaView>;
  if(!authorized)return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 권한 없음</Text><Text style={styles.hint}>이 계정은 Balletmate 관리자 목록에 등록되지 않았습니다.</Text><Pressable style={styles.button} onPress={logout}><Text style={styles.buttonText}>로그아웃</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><View><Text style={styles.brand}>Balletmate 관리자</Text><Text style={styles.hint}>학원 데이터 관리 · {rows.length}개</Text></View><Pressable onPress={logout}><Text style={styles.logout}>로그아웃</Text></Pressable></View>
    <View style={styles.panel}><Text style={styles.heading}>{editing?"학원 정보 수정":"학원 등록"}</Text>{field("학원명 *","name")}{field("위도 *","latitude","decimal-pad")}{field("경도 *","longitude","decimal-pad")}{field("지역/구","district")}{field("주소","address")}{field("전화번호","phone","phone-pad")}{field("1회 수업 가격 (원)","price_per_class","numeric")}
      <View style={styles.toggles}>{toggle("성인 수업","adult_classes")}{toggle("키즈 수업","kids_classes")}{toggle("앱에 공개","is_active")}</View>
      <View style={styles.buttons}>{editing&&<Pressable style={styles.secondary} onPress={reset}><Text style={styles.secondaryText}>취소</Text></Pressable>}<Pressable style={styles.button} onPress={save} disabled={busy}><Text style={styles.buttonText}>{busy?"저장 중…":editing?"수정 저장":"학원 등록"}</Text></Pressable></View>
    </View>
    <View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>등록 학원</Text><Pressable onPress={load}><Text style={styles.refresh}>새로고침</Text></Pressable></View>{busy&&<ActivityIndicator color={c.purple}/>}
      {rows.map(r=><View key={r.id} style={styles.row}><View style={{flex:1}}><Text style={styles.rowName}>{r.name}</Text><Text style={styles.rowMeta}>{r.district||"지역 미입력"} · {r.is_active?"공개":"비공개"}</Text></View><Pressable onPress={()=>startEdit(r)}><Text style={styles.action}>수정</Text></Pressable><Pressable onPress={()=>remove(r.id,r.name)}><Text style={[styles.action,{color:"#B95764"}]}>삭제</Text></Pressable></View>)}
      {!rows.length&&!busy&&<Text style={styles.hint}>등록된 학원이 없습니다.</Text>}
    </View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:c.bg},login:{flex:1,justifyContent:"center",padding:24,gap:12},content:{padding:16,paddingBottom:36,gap:14},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:23,fontWeight:"900",color:c.ink},hint:{fontSize:12,color:c.muted,marginTop:5},logout:{color:c.purple,fontWeight:"700"},panel:{backgroundColor:"#fff",padding:16,borderRadius:18,borderWidth:1,borderColor:c.line,gap:10},heading:{fontSize:17,fontWeight:"800",color:c.ink},field:{gap:5},label:{fontSize:12,color:c.muted},input:{borderWidth:1,borderColor:c.line,borderRadius:11,paddingHorizontal:12,paddingVertical:10,color:c.ink,backgroundColor:"#fff"},toggles:{flexDirection:"row",flexWrap:"wrap",gap:8},toggle:{borderWidth:1,borderColor:c.line,borderRadius:10,padding:9},toggleText:{fontSize:12,color:c.muted},toggleOn:{color:c.purple,fontWeight:"800"},buttons:{flexDirection:"row",gap:8},button:{backgroundColor:c.purple,padding:13,borderRadius:12,alignItems:"center",flex:1},buttonText:{color:"#fff",fontWeight:"800"},secondary:{padding:13,borderWidth:1,borderColor:c.line,borderRadius:12,alignItems:"center"},secondaryText:{color:c.ink},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},refresh:{color:c.purple,fontWeight:"700"},row:{flexDirection:"row",alignItems:"center",gap:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line},rowName:{fontSize:13,fontWeight:"800",color:c.ink},rowMeta:{fontSize:11,color:c.muted,marginTop:3},action:{fontSize:12,color:c.purple,fontWeight:"700"}});
