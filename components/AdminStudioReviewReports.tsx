import React, { useCallback, useEffect, useState , useMemo, useColorScheme} from "react";
import { themeStyles } from "../lib/theme";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

type ReviewReport = {
  id:number; review_id:string; studio_id:string; studio_name:string|null;
  reviewer_id:string; review_content:string; reason:string; details:string;
  status:"pending"|"actioned"|"dismissed"; created_at:string;
};

export default function AdminStudioReviewReports(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
  const [rows,setRows]=useState<ReviewReport[]>([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState<number|null>(null);
  const load=useCallback(async()=>{
    if(!supabase){setLoading(false);return;}
    setLoading(true);
    try{
      const {data,error}=await supabase.rpc("admin_list_studio_review_reports");
      if(error)throw error;
      setRows((Array.isArray(data)?data:[]) as ReviewReport[]);
    }catch(e:any){Alert.alert("리뷰 신고 조회 실패",e?.message||"신고 목록을 불러오지 못했습니다.");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const resolve=async(row:ReviewReport,action:"hide"|"restore"|"dismiss")=>{
    if(!supabase)return;
    setBusyId(row.id);
    try{
      const {error}=await supabase.rpc("admin_resolve_studio_review_report",{
        p_report_id:row.id,p_action:action,p_admin_note:null
      });
      if(error)throw error;
      setRows(current=>current.map(item=>item.id===row.id?{
        ...item,status:action==="dismiss"?"dismissed":"actioned"
      }:item));
    }catch(e:any){Alert.alert("리뷰 신고 처리 실패",e?.message||"신고를 처리하지 못했습니다.");}
    finally{setBusyId(null);}
  };
  const confirm=(row:ReviewReport,action:"hide"|"restore"|"dismiss")=>{
    const title=action==="hide"?"리뷰 숨김":action==="restore"?"리뷰 복구":"신고 반려";
    const message=action==="hide"?"해당 리뷰를 다른 사용자에게 숨길까요?":action==="restore"?"해당 리뷰를 다시 공개할까요?":"신고를 반려하고 리뷰를 공개 상태로 전환할까요?";
    Alert.alert(title,message,[
      {text:"취소",style:"cancel"},
      {text:"확인",style:action==="hide"?"destructive":"default",onPress:()=>{void resolve(row,action);}}
    ]);
  };
  return <View style={s.wrap}>
    <View style={s.head}><Text style={s.title}>학원 리뷰 신고 관리</Text><Pressable onPress={()=>{void load();}} disabled={loading}><Text style={s.refresh}>새로고침</Text></Pressable></View>
    {loading?<ActivityIndicator color="#653BB7" style={{margin:24}}/>:!rows.length?<Text style={s.empty}>접수된 리뷰 신고가 없습니다.</Text>:rows.map(row=><View key={row.id} style={s.card}>
      <Text style={s.meta}>#{row.id} · {row.studio_name||"학원 정보 없음"} · {row.reason}</Text>
      <Text style={s.body}>{row.review_content}</Text>
      {!!row.details&&<Text style={s.meta}>신고 내용: {row.details}</Text>}
      <Text style={s.meta}>리뷰 작성자: {row.reviewer_id}</Text>
      <Text style={s.meta}>접수: {new Date(row.created_at).toLocaleString("ko-KR")} · 상태: {row.status}</Text>
      <View style={s.actions}>
        <Pressable disabled={busyId===row.id} onPress={()=>confirm(row,"hide")}><Text style={[s.action,{color:"#B33A45"}]}>숨김</Text></Pressable>
        <Pressable disabled={busyId===row.id} onPress={()=>confirm(row,"restore")}><Text style={s.action}>복구</Text></Pressable>
        <Pressable disabled={busyId===row.id} onPress={()=>confirm(row,"dismiss")}><Text style={s.action}>신고 반려</Text></Pressable>
      </View>
    </View>)}
  </View>;
}
const createS = (dark:boolean) => StyleSheet.create(themeStyles({wrap:{flex:1},head:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},title:{fontSize:16,fontWeight:"900",color:"#252238"},refresh:{fontSize:12,fontWeight:"800",color:"#653BB7"},empty:{padding:24,textAlign:"center",color:"#8B879A"},card:{backgroundColor:"#fff",borderColor:"#E9E2F2",borderWidth:1,borderRadius:12,padding:12,marginBottom:10},meta:{fontSize:10,color:"#8B879A",marginBottom:6},body:{fontSize:12,color:"#252238",marginBottom:8},actions:{flexDirection:"row",gap:22,justifyContent:"flex-end",marginTop:8},action:{fontSize:11,fontWeight:"800",color:"#653BB7"}},dark));;
