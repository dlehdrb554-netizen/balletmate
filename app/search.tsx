import React,{useCallback,useEffect,useRef,useState} from "react";
import {Alert,FlatList,Keyboard,Pressable,StyleSheet,Text,TextInput,View,useColorScheme} from "react-native";
import {SafeAreaView,useSafeAreaInsets} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {useRouter} from "expo-router";

const RECENT_KEY="recent_searches_v1";
const PENDING_KEY="balletmate.pending_search_query";
const MAX_RECENT=10;

export default function SearchScreen(){
 const router=useRouter();
 const insets=useSafeAreaInsets();
 const isDark=useColorScheme()==="dark";
 const [keyword,setKeyword]=useState("");
 const [recent,setRecent]=useState<string[]>([]);
 const inputRef=useRef<TextInput|null>(null);
 const colors={bg:isDark?"#101014":"#FAF9FC",surface:isDark?"#1D1B24":"#FFFFFF",text:isDark?"#F3EFFA":"#252238",muted:isDark?"#AAA3B8":"#777180",line:isDark?"#393342":"#E9E2F2",purple:isDark?"#C7AEFF":"#653BB7"};
 const loadRecent=useCallback(async()=>{
  try{
   const raw=await AsyncStorage.getItem(RECENT_KEY);
   const legacy=raw===null?await AsyncStorage.getItem("recent_searches"):null;
   const parsed=raw!==null?JSON.parse(raw):(legacy?JSON.parse(legacy):[]);
   if(raw===null&&Array.isArray(parsed)&&parsed.length)await AsyncStorage.setItem(RECENT_KEY,JSON.stringify(parsed.slice(0,MAX_RECENT)));
   setRecent(Array.isArray(parsed)?parsed.filter((item:any)=>typeof item==="string").slice(0,MAX_RECENT):[]);
  }catch{setRecent([]);}
 },[]);
 useEffect(()=>{void loadRecent();const timer=setTimeout(()=>inputRef.current?.focus(),220);return()=>clearTimeout(timer);},[loadRecent]);
 const saveSearch=async(value:string)=>{
  const normalized=value.trim();
  if(!normalized)return;
  const next=[normalized,...recent.filter(item=>item!==normalized)].slice(0,MAX_RECENT);
  setRecent(next);
  await AsyncStorage.setItem(RECENT_KEY,JSON.stringify(next));
 };
 const submit=async(value=keyword)=>{
  const normalized=value.trim();
  if(!normalized)return;
  Keyboard.dismiss();
  try{
   await saveSearch(normalized);
   await AsyncStorage.setItem(PENDING_KEY,normalized);
   router.back();
  }catch{Alert.alert("검색 저장 실패","검색어를 저장하지 못했습니다. 다시 시도해 주세요.");}
 };
 const deleteOne=async(value:string)=>{
  const next=recent.filter(item=>item!==value);
  setRecent(next);
  await AsyncStorage.setItem(RECENT_KEY,JSON.stringify(next)).catch(()=>{});
 };
 const deleteAll=async()=>{
  setRecent([]);
  await AsyncStorage.removeItem(RECENT_KEY).catch(()=>{});
  await AsyncStorage.removeItem("recent_searches").catch(()=>{});
 };
 return <SafeAreaView style={[styles.safe,{backgroundColor:colors.bg,paddingTop:Math.max(insets.top,0)}]}>
  <View style={[styles.header,{borderBottomColor:colors.line}]}>
   <Pressable onPress={()=>router.back()} hitSlop={10} style={styles.back}><Ionicons name="arrow-back" size={23} color={colors.text}/></Pressable>
   <View style={[styles.searchBox,{backgroundColor:colors.surface,borderColor:colors.line}]}>
    <Ionicons name="search-outline" size={19} color={colors.muted}/>
    <TextInput ref={inputRef} value={keyword} onChangeText={setKeyword} onSubmitEditing={()=>void submit()} returnKeyType="search" placeholder="학원명, 지역, 수업명 검색" placeholderTextColor={colors.muted} style={[styles.input,{color:colors.text}]} autoCorrect={false} autoCapitalize="none"/>
    {!!keyword&&<Pressable onPress={()=>setKeyword("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted}/></Pressable>}
   </View>
   <Pressable onPress={()=>void submit()} disabled={!keyword.trim()} style={{paddingHorizontal:5,paddingVertical:10,opacity:keyword.trim()?1:0.4}}><Text style={{fontSize:14,fontWeight:"800",color:colors.purple}}>검색</Text></Pressable>
  </View>
  <View style={styles.sectionHeader}>
   <Text style={[styles.sectionTitle,{color:colors.text}]}>최근 검색</Text>
   {recent.length>0&&<Pressable onPress={()=>Alert.alert("최근 검색어 전체 삭제","최근 검색어를 모두 삭제할까요?",[{text:"취소",style:"cancel"},{text:"전체 삭제",style:"destructive",onPress:()=>void deleteAll()}])}><Text style={{fontSize:12,fontWeight:"700",color:colors.muted}}>전체 삭제</Text></Pressable>}
  </View>
  <FlatList data={recent} keyExtractor={(item,index)=>item+index} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:18,paddingBottom:insets.bottom+24,flexGrow:1}} ItemSeparatorComponent={()=><View style={{height:1,backgroundColor:colors.line}}/>} renderItem={({item})=><View style={styles.row}>
    <Pressable onPress={()=>void submit(item)} style={styles.recentItem}><Ionicons name="time-outline" size={17} color={colors.muted}/><Text numberOfLines={1} style={{fontSize:14,color:colors.text,flex:1}}>{item}</Text></Pressable>
    <Pressable onPress={()=>void deleteOne(item)} hitSlop={10} style={styles.delete}><Ionicons name="close" size={17} color={colors.muted}/></Pressable>
   </View>} ListEmptyComponent={<View style={styles.empty}><Ionicons name="time-outline" size={28} color={colors.muted}/><Text style={{fontSize:13,color:colors.muted,marginTop:10}}>최근 검색어가 없습니다.</Text></View>}/>
 </SafeAreaView>;
}

const styles=StyleSheet.create({
 safe:{flex:1},
 header:{height:58,flexDirection:"row",alignItems:"center",paddingHorizontal:12,gap:8,borderBottomWidth:1},
 back:{width:34,height:42,alignItems:"center",justifyContent:"center"},
 searchBox:{height:42,flex:1,flexDirection:"row",alignItems:"center",gap:8,borderWidth:1,borderRadius:12,paddingHorizontal:11},
 input:{flex:1,fontSize:14,paddingVertical:0},
 sectionHeader:{height:56,flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:20},
 sectionTitle:{fontSize:15,fontWeight:"900"},
 row:{minHeight:52,flexDirection:"row",alignItems:"center"},
 recentItem:{flex:1,minHeight:52,flexDirection:"row",alignItems:"center",gap:11},
 delete:{width:38,height:46,alignItems:"center",justifyContent:"center"},
 empty:{flex:1,minHeight:220,alignItems:"center",justifyContent:"center"}
});
