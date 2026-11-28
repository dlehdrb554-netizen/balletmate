import React,{useCallback,useState} from "react";
import {ActivityIndicator,Alert,FlatList,Pressable,StyleSheet,Text,View,useColorScheme} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import {useFocusEffect,useRouter} from "expo-router";
import {supabase} from "../lib/supabase";

type NotificationItem={id:string;title:string;body:string;kind:string;data:Record<string,any>;read_at:string|null;created_at:string};
export default function NotificationsScreen(){
  const router=useRouter();
  const dark=useColorScheme()==="dark";
  const [items,setItems]=useState<NotificationItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [loadError,setLoadError]=useState("");
  const colors={bg:dark?"#101010":"#FAF9FC",card:dark?"#19171F":"#FFFFFF",text:dark?"#FFFFFF":"#252238",muted:dark?"#B8B2C3":"#777184",line:dark?"#383342":"#EAE7F0"};
  const load=useCallback(async()=>{
    if(!supabase){setLoading(false);setLoadError("서버 연결을 확인할 수 없습니다.");return;}
    setLoading(true);setLoadError("");
    const {data,error}=await supabase.from("user_notifications").select("id,title,body,kind,data,read_at,created_at").order("created_at",{ascending:false}).limit(100);
    if(error){setLoadError(error.message.includes("user_notifications")?"알림함 데이터베이스 설정이 필요합니다. 관리자에게 문의해 주세요.":"알림을 불러오지 못했습니다.");}
    else {
      setItems((data||[]) as NotificationItem[]);
      const {count}=await supabase.from("user_notifications").select("id",{count:"exact",head:true}).is("read_at",null);
      await Notifications.setBadgeCountAsync(count||0).catch(()=>{});
    }
    setLoading(false);
  },[]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  const unread=items.filter(x=>!x.read_at).length;
  const markAll=async()=>{
    if(!supabase||busy||unread===0)return;
    setBusy(true);
    const {error}=await supabase.from("user_notifications").update({read_at:new Date().toISOString()}).is("read_at",null);
    setBusy(false);
    if(error)Alert.alert("읽음 처리 실패","알림을 읽음 처리하지 못했습니다.");
    else await load();
  };
  const openItem=async(item:NotificationItem)=>{
    if(!supabase||busy)return;
    setBusy(true);
    if(!item.read_at){
      const {error}=await supabase.from("user_notifications").update({read_at:new Date().toISOString()}).eq("id",item.id);
      if(error){setBusy(false);Alert.alert("읽음 처리 실패","알림 상태를 저장하지 못했습니다.");return;}
      setItems(current=>current.map(x=>x.id===item.id?{...x,read_at:new Date().toISOString()}:x));
    }
    setBusy(false);
    const data=item.data||{};
    if(data.studioId)router.push({pathname:"/",params:{studioId:String(data.studioId)}});
    else if(data.postId)router.push({pathname:"/community",params:{postId:String(data.postId)}});
    else if(data.noticeId)router.push("/mypage?open=notices");
  };
  const formatDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});};
  return <SafeAreaView edges={["top","bottom"]} style={[s.safe,{backgroundColor:colors.bg}]}>
    <View style={[s.header,{borderBottomColor:colors.line}]}>
      <Pressable onPress={()=>router.back()} hitSlop={12} accessibilityLabel="뒤로가기"><Ionicons name="chevron-back" size={25} color={colors.text}/></Pressable>
      <Text style={[s.heading,{color:colors.text}]}>알림</Text>
      <Pressable onPress={()=>void markAll()} disabled={busy||unread===0}><Text style={[s.readAll,{color:unread? "#653BB7":colors.muted}]}>모두 읽음</Text></Pressable>
    </View>
    {loading?<View style={s.center}><ActivityIndicator color="#653BB7"/></View>
    :loadError?<View style={s.center}><Ionicons name="alert-circle-outline" size={30} color={colors.muted}/><Text style={[s.emptyText,{color:colors.muted}]}>{loadError}</Text><Pressable onPress={()=>void load()}><Text style={s.retry}>다시 시도</Text></Pressable></View>
    :<FlatList data={items} keyExtractor={x=>x.id} contentContainerStyle={items.length?{padding:14,paddingBottom:28}:{flexGrow:1,justifyContent:"center"}} ListEmptyComponent={<View style={s.center}><Ionicons name="notifications-off-outline" size={34} color={colors.muted}/><Text style={[s.emptyText,{color:colors.muted}]}>새로운 알림이 없습니다.</Text></View>} renderItem={({item})=><Pressable onPress={()=>void openItem(item)} style={[s.item,{backgroundColor:colors.card,borderColor:colors.line},!item.read_at&&{borderColor:"#D9C9F5"}]}>
      <View style={s.itemTop}><View style={s.titleWrap}><View style={[s.dot,{backgroundColor:item.read_at?"transparent":"#E64B72"}]}/><Text style={[s.itemTitle,{color:colors.text}]} numberOfLines={2}>{item.title}</Text></View><Text style={[s.date,{color:colors.muted}]}>{formatDate(item.created_at)}</Text></View>
      {!!item.body&&<Text style={[s.body,{color:colors.muted}]}>{item.body}</Text>}
      {!item.read_at&&<Text style={s.unreadLabel}>읽지 않음</Text>}
    </Pressable>}/>}
  </SafeAreaView>;
}
const s=StyleSheet.create({
 safe:{flex:1},header:{height:56,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1},
 heading:{fontSize:18,fontWeight:"900"},readAll:{fontSize:12,fontWeight:"800"},center:{flex:1,alignItems:"center",justifyContent:"center",gap:10,padding:24},
 emptyText:{fontSize:13,fontWeight:"600",textAlign:"center"},retry:{color:"#653BB7",fontSize:13,fontWeight:"800"},
 item:{borderWidth:1,borderRadius:14,padding:14,marginBottom:10},itemTop:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:8},
 titleWrap:{flex:1,flexDirection:"row",alignItems:"flex-start",gap:7},dot:{width:7,height:7,borderRadius:4,marginTop:6},
 itemTitle:{fontSize:14,fontWeight:"900",flex:1},date:{fontSize:10,marginTop:2},body:{fontSize:12,lineHeight:18,marginTop:8},
 unreadLabel:{fontSize:10,fontWeight:"800",color:"#653BB7",marginTop:8}
});
