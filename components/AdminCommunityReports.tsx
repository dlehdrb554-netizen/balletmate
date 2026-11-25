import React, { useCallback, useEffect, useState , useMemo, useColorScheme} from "react";
import { themeStyles } from "../lib/theme";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

type Report={id:number;reporter_id:string;target_user_id:string|null;content_type:"post"|"comment";content_id:string;reason:string;details:string;status:string;created_at:string;content_preview?:string;target_author?:string};

export default function AdminCommunityReports(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const [rows,setRows]=useState<Report[]>([]);
 const [loading,setLoading]=useState(true);
 const [busyId,setBusyId]=useState<number|null>(null);
 const load=useCallback(async()=>{
  if(!supabase){setLoading(false);return;}
  setLoading(true);
  try{
   const {data,error}=await supabase.rpc("admin_list_community_reports");
   if(error)throw error;
   setRows((Array.isArray(data)?data:[]) as Report[]);
  }catch(e:any){Alert.alert("커뮤니티 신고 조회 실패",e?.message||"신고 목록을 불러오지 못했습니다.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{load();},[load]);
 const removeContent=(row:Report)=>{
  if(!supabase)return;
  Alert.alert("신고 콘텐츠 삭제","해당 게시글 또는 댓글을 삭제할까요? 이 작업은 되돌릴 수 없습니다.",[
   {text:"취소",style:"cancel"},
   {text:"삭제",style:"destructive",onPress:async()=>{
    setBusyId(row.id);
    try{
     const {error}=await supabase!.rpc("admin_remove_community_content",{p_content_type:row.content_type,p_content_id:row.content_id,p_report_id:row.id});
     if(error)throw error;
     setRows(current=>current.map(item=>item.id===row.id?{...item,status:"actioned"}:item));
    }catch(e:any){Alert.alert("콘텐츠 삭제 실패",e?.message||"삭제하지 못했습니다.");}
    finally{setBusyId(null);}
   }}
  ]);
 };
 const update=async(row:Report,status:"in_review"|"actioned"|"dismissed")=>{
  if(!supabase)return;
  setBusyId(row.id);
  try{
   const {error}=await supabase.rpc("admin_update_community_report",{p_report_id:row.id,p_status:status,p_admin_note:null});
   if(error)throw error;
   setRows(current=>current.map(item=>item.id===row.id?{...item,status}:item));
  }catch(e:any){Alert.alert("신고 처리 실패",e?.message||"상태를 변경하지 못했습니다.");}
  finally{setBusyId(null);}
 };
 return <View style={s.wrap}>
  <View style={s.head}><Text style={s.title}>커뮤니티 신고 관리</Text><Pressable onPress={load} disabled={loading}><Text style={s.refresh}>새로고침</Text></Pressable></View>
  {loading?<ActivityIndicator color="#653BB7" style={{margin:24}}/>:!rows.length?<Text style={s.empty}>접수된 커뮤니티 신고가 없습니다.</Text>:rows.map(row=><View key={row.id} style={s.card}>
   <Text style={s.meta}>#{row.id} · {row.content_type==="post"?"게시글":"댓글"} · {row.reason}</Text>
   <Text style={s.body}>{row.content_preview||"콘텐츠 미리보기를 불러오지 못했습니다."}</Text>
   <Text style={s.meta}>콘텐츠 ID: {row.content_id}</Text>
   <Text style={s.meta}>신고자: {row.reporter_id} · 작성자: {row.target_user_id||"확인 불가"}</Text>
   <Text style={s.meta}>접수: {new Date(row.created_at).toLocaleString("ko-KR")} · 상태: {row.status}</Text>
   <View style={s.actions}>
    <Pressable disabled={busyId===row.id} onPress={()=>update(row,"in_review")}><Text style={s.action}>검토 중</Text></Pressable>
    <Pressable disabled={busyId===row.id} onPress={()=>Alert.alert("조치 완료","신고 콘텐츠에 대한 운영 조치를 완료했습니까?",[{text:"취소",style:"cancel"},{text:"완료",onPress:()=>update(row,"actioned")}])}><Text style={s.action}>조치 완료</Text></Pressable>
    <Pressable disabled={busyId===row.id} onPress={()=>update(row,"dismissed")}><Text style={s.action}>반려</Text></Pressable>
    <Pressable disabled={busyId===row.id||row.status==="actioned"} onPress={()=>removeContent(row)}><Text style={[s.action,{color:"#B33A45"}]}>콘텐츠 삭제</Text></Pressable>
   </View>
  </View>)}
 </View>;
}
const createS = (dark:boolean) => StyleSheet.create(themeStyles({wrap:{flex:1},head:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},title:{fontSize:16,fontWeight:"900",color:"#252238"},refresh:{fontSize:12,fontWeight:"800",color:"#653BB7"},empty:{padding:24,textAlign:"center",color:"#8B879A"},card:{backgroundColor:"#fff",borderColor:"#E9E2F2",borderWidth:1,borderRadius:12,padding:12,marginBottom:10},meta:{fontSize:10,color:"#8B879A",marginBottom:6},body:{fontSize:12,color:"#252238",marginBottom:8},actions:{flexDirection:"row",gap:18,justifyContent:"flex-end",marginTop:8},action:{fontSize:11,fontWeight:"800",color:"#653BB7"}},dark));;
