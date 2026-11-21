import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator, Animated, FlatList, Image, Keyboard, Linking, Modal, PanResponder, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, View, Alert
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import { fetchStudios } from "../lib/studios";
import { fetchClassesForStudio, StudioClass } from "../lib/classes";
import { supabase, supabaseConfigured } from "../lib/supabase";
import * as Location from "expo-location";

type Studio = {
  id: string; name: string; lat: number; lng: number; area: string;
  tags: string[]; price: number | null; coupon: boolean; adult: boolean; kids: boolean;
  level: string[]; days: string[]; time: string; duration: number; rating: number;
  description: string; address?: string; phone?: string; imageUrls?: string[]; websiteUrl?: string; imageSourceName?: string; imageCheckedAt?: string; sourceUrl?: string; sourceName?: string; verifiedAt?: string; imageUsageNote?: string;
};
const DATA: Studio[] = [
  {id:"s1",name:"발레온 스튜디오",lat:37.6584,lng:126.8321,area:"고양시 일산동구",tags:["성인","초급","기초"],price:25000,coupon:true,adult:true,kids:false,level:["초급","중급"],days:["평일","주말"],time:"오전 · 저녁",duration:60,rating:4.8,description:"성인 취미 발레 기초와 단계별 수업을 운영하는 스튜디오."},
  {id:"s2",name:"라벨르 발레",lat:37.6643,lng:126.7798,area:"고양시 일산서구",tags:["성인","키즈","초급"],price:22000,coupon:false,adult:true,kids:true,level:["입문","초급"],days:["평일"],time:"오전 · 오후",duration:50,rating:4.7,description:"입문자를 위한 소규모 그룹 수업."},
  {id:"s3",name:"아뜰리에 발레",lat:37.6452,lng:126.7867,area:"고양시 일산서구",tags:["성인","중급"],price:30000,coupon:true,adult:true,kids:false,level:["초급","중급","고급"],days:["평일","주말"],time:"저녁",duration:75,rating:4.9,description:"테크닉과 작품 수업을 함께 운영."},
  {id:"s4",name:"리틀 스완 발레",lat:37.6711,lng:126.8143,area:"고양시 일산동구",tags:["키즈","유아"],price:18000,coupon:false,adult:false,kids:true,level:["입문"],days:["평일","주말"],time:"오후",duration:40,rating:4.6,description:"유아·어린이 발레 수업."},
  {id:"s5",name:"무브 발레핏",lat:37.6344,lng:126.8328,area:"고양시 일산동구",tags:["성인","발레핏","초급"],price:20000,coupon:true,adult:true,kids:false,level:["입문","초급"],days:["평일"],time:"오전 · 저녁",duration:55,rating:4.5,description:"발레 기초와 컨디셔닝을 결합한 수업."},
  {id:"s6",name:"플리에 발레 아카데미",lat:37.6530,lng:126.8578,area:"고양시 덕양구",tags:["성인","키즈","중급"],price:28000,coupon:false,adult:true,kids:true,level:["초급","중급"],days:["평일","주말"],time:"오전 · 오후 · 저녁",duration:60,rating:4.8,description:"연령별·수준별 클래스 운영."}
];
const INITIAL: Region = {latitude:37.5665,longitude:126.9780,latitudeDelta:0.06,longitudeDelta:0.06};
const distanceKm=(lat1:number,lon1:number,lat2:number,lon2:number)=>{const rad=(n:number)=>n*Math.PI/180;const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));};
const COLORS = {ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",bg:"#FAF9FC",line:"#EAE7F0",white:"#FFFFFF",pink:"#F8E8F1"};

function Chip({label,active,onPress}: {label:string;active?:boolean;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[styles.chip,active&&styles.chipActive]}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{label}</Text></Pressable>;
}
export default function Home() {
  const router = useRouter();
  const map = useRef<MapView>(null);
  const [studios,setStudios]=useState<Studio[]>(supabaseConfigured?[]:DATA);
  const [backendState,setBackendState]=useState<"mock"|"loading"|"connected"|"empty"|"error">(supabaseConfigured?"loading":"mock");
  const [region,setRegion]=useState(INITIAL);
  const [mapMoved,setMapMoved]=useState(false);
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState<Studio|null>(null);
  const [view,setView]=useState<"map"|"list"|"favorites">("map");
  const [filterOpen,setFilterOpen]=useState(false);
  const [detailStudio,setDetailStudio]=useState<Studio|null>(null);
  const [studioClasses,setStudioClasses]=useState<StudioClass[]>([]);
  const [classesLoading,setClassesLoading]=useState(false);
  const detailRequestId=useRef(0);
  const [detailExpanded,setDetailExpanded]=useState(false);
  const detailDragY=useRef(new Animated.Value(0)).current;
  const detailPan=useRef(PanResponder.create({
    onMoveShouldSetPanResponder:(_,gesture)=>Math.abs(gesture.dy)>8,
    onPanResponderMove:Animated.event([null,{dy:detailDragY}],{useNativeDriver:false}),
    onPanResponderRelease:(_,gesture)=>{
      Animated.spring(detailDragY,{toValue:0,useNativeDriver:false,bounciness:4}).start();
      if(gesture.dy>145){detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}
      else if(gesture.dy>55)setDetailExpanded(false);
      else if(gesture.dy< -55)setDetailExpanded(true);
    },
    onPanResponderTerminationRequest:()=>false,
  })).current;
  const [compareOpen,setCompareOpen]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<string[]>([]);
  const [favoriteStudios,setFavoriteStudios]=useState<Studio[]>([]);
  const [favoritesReady,setFavoritesReady]=useState(false);
  const [compareIds,setCompareIds]=useState<string[]>([]);
  const [compareCache,setCompareCache]=useState<Studio[]>([]);
  const [adult,setAdult]=useState(false);
  const [kids,setKids]=useState(false);
  const [coupon,setCoupon]=useState(false);
  const [level,setLevel]=useState<string|null>(null);
  const [dayFilter,setDayFilter]=useState<string|null>(null);
  const [timeFilter,setTimeFilter]=useState<string|null>(null);
  const [maxPrice,setMaxPrice]=useState<number|null>(null);
  const [durationFilter,setDurationFilter]=useState<number|null>(null);
  const [maxDistance,setMaxDistance]=useState<number|null>(null);
  const [locationLoading,setLocationLoading]=useState(false);
  const [locationGranted,setLocationGranted]=useState(false);
  const [searchedRegion,setSearchedRegion]=useState(INITIAL);
  const [areaLocked,setAreaLocked]=useState(false);

  const results=useMemo(()=>studios.filter(s=>{
    const q=search.trim().toLowerCase();
    if(q && !s.name.toLowerCase().includes(q) && !s.area.includes(q) && !s.tags.some(t=>t.includes(q))) return false;
    if((adult||kids)&&!((adult&&s.adult)||(kids&&s.kids)))return false;
    if(coupon&&!s.coupon)return false;
    if(level&&!s.level.includes(level))return false;
    if(dayFilter&&!s.days.includes(dayFilter))return false;
    if(timeFilter&&!s.time.includes(timeFilter))return false;
    if(maxPrice!==null&&(s.price===null||s.price>maxPrice))return false;
    if(durationFilter!==null&&s.duration!==durationFilter)return false;
    if(maxDistance!==null&&distanceKm(searchedRegion.latitude,searchedRegion.longitude,s.lat,s.lng)>maxDistance)return false;
    if(areaLocked){
      const latSpan=searchedRegion.latitudeDelta/2;
      const lngSpan=searchedRegion.longitudeDelta/2;
      if(Math.abs(s.lat-searchedRegion.latitude)>latSpan||Math.abs(s.lng-searchedRegion.longitude)>lngSpan)return false;
    }
    return true;
  }),[studios,search,adult,kids,coupon,level,dayFilter,timeFilter,maxPrice,durationFilter,maxDistance,areaLocked,searchedRegion]);

  const locate=async()=>{
    setLocationLoading(true);
    try {
      const {status}=await Location.requestForegroundPermissionsAsync();
      if(status!=="granted"){setLocationGranted(false);Alert.alert("위치 권한","권한이 없어 기본 지역에서 지도를 표시합니다. 설정에서 위치 권한을 허용할 수 있어요.");return;}
      const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const r={latitude:p.coords.latitude,longitude:p.coords.longitude,latitudeDelta:0.035,longitudeDelta:0.035};
      map.current?.animateToRegion(r,650);setRegion(r);setSearchedRegion(r);setAreaLocked(false);setLocationGranted(true);setMapMoved(false);
    } catch { Alert.alert("위치 확인 실패","현재 위치를 가져오지 못했습니다. 지도를 직접 이동해 이용해주세요."); }
    finally {setLocationLoading(false);}
  };
  useEffect(()=>{let active=true;const initializeLocation=async()=>{try{let permission=await Location.getForegroundPermissionsAsync();if(permission.status==="undetermined")permission=await Location.requestForegroundPermissionsAsync();if(!active)return;setLocationGranted(permission.status==="granted");if(permission.status!=="granted")return;const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});if(!active)return;const r={latitude:p.coords.latitude,longitude:p.coords.longitude,latitudeDelta:0.04,longitudeDelta:0.04};map.current?.animateToRegion(r,500);setRegion(r);setSearchedRegion(r);setAreaLocked(false);setMapMoved(false);}catch{if(active)setLocationGranted(false);}};initializeLocation();return()=>{active=false;};},[]);
  useEffect(()=>{Promise.all([AsyncStorage.getItem("balletmate.favorites.v1"),AsyncStorage.getItem("balletmate.favoriteStudios.v1")]).then(([ids,cache])=>{if(ids){const parsed=JSON.parse(ids);if(Array.isArray(parsed))setFavoriteIds(parsed.filter(x=>typeof x==="string"));}if(cache){const parsed=JSON.parse(cache);if(Array.isArray(parsed))setFavoriteStudios(parsed);}}).catch(()=>{}).finally(()=>setFavoritesReady(true));},[]);
  useEffect(()=>{if(favoritesReady){AsyncStorage.setItem("balletmate.favorites.v1",JSON.stringify(favoriteIds)).catch(()=>{});AsyncStorage.setItem("balletmate.favoriteStudios.v1",JSON.stringify(favoriteStudios)).catch(()=>{});}},[favoriteIds,favoriteStudios,favoritesReady]);
  const favoriteSyncUser=useRef<string|null>(null);
  useEffect(()=>{
    const client=supabase;
    if(!client)return;
    let active=true;
    const syncForSession=async(session:any)=>{
      const uid=session?.user?.id||null;
      if(!uid){favoriteSyncUser.current=null;return;}
      if(!favoritesReady)return;
      if(favoriteSyncUser.current===uid)return;
      favoriteSyncUser.current=uid;
      try{
        const {data:remote,error}=await client.from("user_favorites").select("studio_id,studio_snapshot").eq("user_id",uid);
        if(error)throw error;
        if(!active)return;
        const remoteRows=remote||[];
        const remoteStudios=remoteRows.map((r:any)=>r.studio_snapshot).filter((s:any)=>s&&typeof s.id==="string");
        const localStudios=favoriteStudios;
        const mergedMap=new Map<string,Studio>();
        remoteStudios.forEach((s:Studio)=>mergedMap.set(s.id,s));
        localStudios.forEach((s:Studio)=>mergedMap.set(s.id,s));
        const merged=[...mergedMap.values()];
        const mergedIds=[...new Set([...favoriteIds,...remoteRows.map((r:any)=>r.studio_id),...merged.map(s=>s.id)])];
        setFavoriteStudios(merged);setFavoriteIds(mergedIds);
        if(merged.length){
          const payload=merged.map(s=>({user_id:uid,studio_id:s.id,studio_snapshot:s,updated_at:new Date().toISOString()}));
          const {error:upsertError}=await client.from("user_favorites").upsert(payload,{onConflict:"user_id,studio_id"});
          if(upsertError)throw upsertError;
        }
      }catch(e){console.warn("Favorite sync skipped:",e);}
    };
    client.auth.getSession().then(({data})=>syncForSession(data.session));
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{syncForSession(session);});
    return()=>{active=false;subscription.unsubscribe();};
  },[favoritesReady,favoriteIds,favoriteStudios]);

  useEffect(()=>{if(!supabaseConfigured)return;let mounted=true;setBackendState("loading");fetchStudios(searchedRegion).then(rows=>{if(!mounted)return;const mapped:Studio[]=rows.map(r=>({id:r.id,name:r.name,lat:r.latitude,lng:r.longitude,area:r.district||"지역 정보 없음",address:r.address||undefined,tags:r.tags||[],price:r.price_per_class,coupon:!!r.coupon_available,adult:!!r.adult_classes,kids:!!r.kids_classes,level:r.levels||[],days:r.days||[],time:(r.time_slots||[]).join(" · "),duration:r.duration_minutes||0,rating:Number(r.rating||0),description:r.description||"등록된 소개가 없습니다.",phone:r.phone||undefined,imageUrls:r.image_urls||[],websiteUrl:r.website_url||undefined,imageSourceName:r.image_source_name||undefined,imageCheckedAt:r.image_checked_at||undefined,sourceUrl:r.source_url||undefined,sourceName:r.source_name||undefined,verifiedAt:r.verified_at||undefined,imageUsageNote:r.image_usage_note||undefined}));setStudios(mapped);setBackendState(mapped.length?"connected":"empty");}).catch(()=>{if(mounted){setStudios([]);setBackendState("error");}});return()=>{mounted=false;};},[searchedRegion]);
  const searchArea=()=>{setSearchedRegion(region);setAreaLocked(true);setMapMoved(false);setSelected(null);};
  const isAreaChanged=Math.abs(region.latitude-searchedRegion.latitude)>Math.max(0.004,searchedRegion.latitudeDelta*0.12)||Math.abs(region.longitude-searchedRegion.longitude)>Math.max(0.004,searchedRegion.longitudeDelta*0.12)||Math.abs(region.latitudeDelta-searchedRegion.latitudeDelta)>searchedRegion.latitudeDelta*0.18||Math.abs(region.longitudeDelta-searchedRegion.longitudeDelta)>searchedRegion.longitudeDelta*0.18;
  const activeFilters=(adult?1:0)+(kids?1:0)+(coupon?1:0)+(level?1:0)+(dayFilter?1:0)+(timeFilter?1:0)+(maxPrice!==null?1:0)+(durationFilter!==null?1:0)+(maxDistance!==null?1:0);
  const toggleCompare=(studio:Studio)=>{
    if(compareIds.includes(studio.id)){
      setCompareIds(ids=>ids.filter(i=>i!==studio.id));
      setCompareCache(list=>list.filter(x=>x.id!==studio.id));
      return;
    }
    if(compareIds.length>=3){
      Alert.alert("비교 제한","학원은 최대 3곳까지 비교할 수 있어요. 먼저 비교 목록에서 한 곳을 제외해 주세요.");
      return;
    }
    setCompareIds(ids=>[...ids,studio.id]);
    setCompareCache(list=>[studio,...list.filter(x=>x.id!==studio.id)]);
  };
  const toggleFavorite=(studio:Studio)=>{
    const removing=favoriteIds.includes(studio.id);
    setFavoriteIds(ids=>removing?ids.filter(i=>i!==studio.id):[...ids,studio.id]);
    setFavoriteStudios(list=>removing?list.filter(x=>x.id!==studio.id):[studio,...list.filter(x=>x.id!==studio.id)]);
    const client=supabase;
    if(client) client.auth.getSession().then(({data})=>{
      const uid=data.session?.user.id;if(!uid)return;
      if(removing) client.from("user_favorites").delete().eq("user_id",uid).eq("studio_id",studio.id).then(({error})=>{if(error)console.warn("Favorite delete sync failed",error);});
      else client.from("user_favorites").upsert({user_id:uid,studio_id:studio.id,studio_snapshot:studio,updated_at:new Date().toISOString()},{onConflict:"user_id,studio_id"}).then(({error})=>{if(error)console.warn("Favorite save sync failed",error);});
    });
  };
  const resetFilters=()=>{setAdult(false);setKids(false);setCoupon(false);setLevel(null);setDayFilter(null);setTimeFilter(null);setMaxPrice(null);setDurationFilter(null);setMaxDistance(null);};
  const openDetail=async(s:Studio)=>{const requestId=++detailRequestId.current;setDetailExpanded(false);detailDragY.setValue(0);setDetailStudio(s);setStudioClasses([]);if(supabaseConfigured){setClassesLoading(true);try{const rows=await fetchClassesForStudio(s.id);if(requestId===detailRequestId.current)setStudioClasses(rows);}catch{if(requestId===detailRequestId.current)setStudioClasses([]);}finally{if(requestId===detailRequestId.current)setClassesLoading(false);}}};
  const studioCard=(s:Studio,compact=false)=><Pressable key={s.id} onPress={()=>{setSelected(s);setView("map");if(!studios.some(x=>x.id===s.id)){const r={latitude:s.lat,longitude:s.lng,latitudeDelta:0.04,longitudeDelta:0.04};setSearchedRegion(r);setAreaLocked(false);}map.current?.animateToRegion({latitude:s.lat,longitude:s.lng,latitudeDelta:0.018,longitudeDelta:0.018},400);}} style={[styles.studioCard,compact&&styles.compactCard]}>
    <View style={styles.cardTop}><View style={styles.studioIcon}><Text style={{fontSize:20}}>🩰</Text></View><View style={{flex:1}}><Text style={styles.studioName}>{s.name}</Text><Text style={styles.studioArea}>{s.area} · ⭐ {s.rating.toFixed(1)}</Text></View>{s.coupon&&<View style={styles.couponBadge}><Text style={styles.couponText}>쿠폰</Text></View>}</View>
    <View style={styles.tagsRow}>{s.tags.map(t=><View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}</View>
    <View style={styles.cardBottom}><Text style={styles.priceText}>{s.price!==null?"₩"+s.price.toLocaleString():"가격 문의"}<Text style={styles.priceUnit}> / 회</Text></Text><Text style={styles.metaText}>{s.duration}분 · {s.time}</Text></View><View style={styles.cardActions}><Pressable onPress={e=>{e.stopPropagation();toggleFavorite(s);}} style={styles.actionChip}><Text style={styles.actionText}>{favoriteIds.includes(s.id)?"♥ 찜됨":"♡ 찜"}</Text></Pressable><Pressable onPress={e=>{e.stopPropagation();toggleCompare(s);}} style={styles.actionChip}><Text style={styles.actionText}>{compareIds.includes(s.id)?"✓ 비교중":"+ 비교"}</Text></Pressable><Pressable onPress={e=>{e.stopPropagation();openDetail(s);}} style={styles.actionChip}><Text style={styles.actionText}>상세정보</Text></Pressable></View>
  </Pressable>;

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View><Text style={styles.brand}>balletmate <Text style={styles.brandDot}>✦</Text></Text><Text style={styles.subtitle}>나에게 맞는 발레를 찾아보세요</Text></View>
      <Pressable style={styles.profileButton} onPress={()=>router.push("/account")}><Text style={{fontSize:18}}>◉</Text></Pressable>
    </View>
    <View style={styles.searchRow}>
      <View style={styles.searchBox}><Text style={{fontSize:17}}>⌕</Text><TextInput value={search} onChangeText={setSearch} placeholder="학원명, 지역, 수업 검색" placeholderTextColor="#A5A1B0" style={styles.searchInput} returnKeyType="search" onSubmitEditing={()=>Keyboard.dismiss()}/>{!!search&&<Pressable onPress={()=>setSearch("")}><Text style={styles.clear}>×</Text></Pressable>}</View>
      <Pressable style={styles.filterButton} onPress={()=>setFilterOpen(true)}><Text style={{fontSize:18}}>☷</Text>{activeFilters>0&&<View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilters}</Text></View>}</Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilters}><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/><Chip label="쿠폰" active={coupon} onPress={()=>setCoupon(!coupon)}/><Chip label="초급" active={level==="초급"} onPress={()=>setLevel(level==="초급"?null:"초급")}/><Chip label="전체" onPress={resetFilters}/></ScrollView>
    <View style={styles.content}>
      {view==="map"?<View style={styles.mapWrap}>
        <MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={INITIAL} onRegionChangeComplete={r=>{setRegion(r);setMapMoved(true);}} showsUserLocation={locationGranted} showsMyLocationButton={false} onPress={()=>setSelected(null)}>
          {results.map(s=><Marker key={s.id} coordinate={{latitude:s.lat,longitude:s.lng}} onPress={()=>{setSelected(s);openDetail(s);}} tracksViewChanges={false}><View style={[styles.pin,selected?.id===s.id&&styles.pinSelected]}><Text style={[styles.pinText,selected?.id===s.id&&styles.pinTextSelected]}>{s.price!==null?(s.price===0?"무료":"₩"+Math.round(s.price/1000)+"k"):"문의"}</Text></View></Marker>)}
        </MapView>
        {mapMoved&&isAreaChanged&&<Pressable style={styles.areaSearch} disabled={backendState==="loading"} onPress={searchArea}><Text style={styles.areaSearchText}>⌕  이 지역에서 재검색</Text></Pressable>}
        <Pressable style={styles.locateButton} onPress={locate}><Text style={{fontSize:19}}>{locationLoading?"…":"◎"}</Text></Pressable>
        <View style={styles.mapCount}><Text style={styles.mapCountText}>주변 학원 <Text style={{color:COLORS.purple,fontWeight:"800"}}>{results.length}</Text>곳{backendState==="loading"?" · 불러오는 중":backendState==="mock"?" · 데모":backendState==="error"?" · 연결 오류":backendState==="empty"?" · 등록된 학원 없음":""}</Text></View>
        {selected&&<View style={styles.selectedCard}>{studioCard(selected,true)}<Pressable style={styles.detailBtn} onPress={()=>openDetail(selected)}><Text style={styles.detailBtnText}>상세 보기  ›</Text></Pressable><Pressable style={styles.dismiss} onPress={()=>setSelected(null)}><Text style={styles.dismissText}>×</Text></Pressable></View>}
      </View> :<FlatList data={view==="favorites"?favoriteStudios:results} keyExtractor={i=>i.id} renderItem={({item})=>studioCard(item)} contentContainerStyle={styles.listContent} ListEmptyComponent={<Text style={styles.empty}>{view==="favorites"?"찜한 학원이 아직 없어요.":"검색 조건에 맞는 학원이 없어요."}</Text>}/>}
    </View>
    {compareIds.length>=2&&<Pressable style={styles.compareFloating} onPress={()=>setCompareOpen(true)}><Text style={styles.compareFloatingText}>학원 비교하기 · {compareIds.length}</Text></Pressable>}
    <View style={styles.bottomNav}><Pressable style={styles.navItem} onPress={()=>setView("map")}><Text style={[styles.navIcon,view==="map"&&styles.navActive]}>⌖</Text><Text style={[styles.navLabel,view==="map"&&styles.navActive]}>지도</Text></Pressable><Pressable style={styles.navItem} onPress={()=>setView("list")}><Text style={[styles.navIcon,view==="list"&&styles.navActive]}>☰</Text><Text style={[styles.navLabel,view==="list"&&styles.navActive]}>목록</Text></Pressable><Pressable style={styles.navItem} onPress={()=>router.push("/community")}><Text style={styles.navIcon}>▤</Text><Text style={styles.navLabel}>커뮤니티</Text></Pressable><Pressable style={styles.navItem} onPress={()=>setView("favorites")}><Text style={[styles.navIcon,view==="favorites"&&styles.navActive]}>♡</Text><Text style={[styles.navLabel,view==="favorites"&&styles.navActive]}>찜</Text></Pressable><Pressable style={styles.navItem} onPress={()=>router.push("/account")}><Text style={[styles.navIcon,styles.navActive]}>◉</Text><Text style={[styles.navLabel,styles.navActive]}>마이</Text></Pressable></View>
    <Modal visible={compareOpen} animationType="slide" transparent onRequestClose={()=>setCompareOpen(false)}>
      <View style={styles.modalShade}><View style={styles.modal}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>학원 비교</Text><Pressable onPress={()=>setCompareOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.filterHint}>최대 3곳까지 비교할 수 있습니다. 카드의 비교 버튼으로 선택을 변경하세요.</Text>
        {compareIds.map(id=>{const s=studios.find(x=>x.id===id)||favoriteStudios.find(x=>x.id===id)||compareCache.find(x=>x.id===id);if(!s)return null;return <View key={id} style={styles.compareRow}><Text style={styles.compareName}>{s.name}</Text><Text style={styles.compareInfo}>{s.area} · {s.level.join("/")}</Text><Text style={styles.compareInfo}>{s.days.join(" · ")} / {s.time}</Text><Text style={styles.compareInfo}>{s.duration}분 · {s.coupon?"쿠폰 있음":"쿠폰 없음"}</Text><Text style={styles.comparePrice}>{s.price!==null?"₩"+s.price.toLocaleString()+" / 회":"가격 미등록"}</Text><Pressable onPress={()=>setCompareIds(ids=>ids.filter(x=>x!==id))}><Text style={styles.removeCompare}>비교 목록에서 제외</Text></Pressable></View>})}
        <Pressable style={styles.applyButton} onPress={()=>setCompareOpen(false)}><Text style={styles.applyText}>확인</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={!!detailStudio} animationType="slide" transparent onRequestClose={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}>
      <View style={styles.modalShade}>
       <Animated.View style={[styles.modal,{height:detailExpanded?"92%":"65%",maxHeight:"94%",paddingBottom:24,transform:[{translateY:detailDragY}]}]}>
        <View style={styles.dragHeader} {...detailPan.panHandlers}>
         <View style={styles.dragHandle}/>
         <View style={styles.modalHead}><Text style={styles.modalTitle}>학원 상세 정보</Text><View style={{flexDirection:"row",alignItems:"center",gap:14}}><Pressable onPress={()=>setDetailExpanded(v=>!v)}><Text style={styles.expandText}>{detailExpanded?"접기":"펼치기"}</Text></Pressable><Pressable onPress={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}><Text style={styles.dismissText}>×</Text></Pressable></View></View>
         <Text style={styles.dragHint}>위아래로 끌어 창 크기 조절 · 아래로 길게 끌면 닫기</Text>
        </View>
        <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:20}}>{detailStudio&&<>
          <View style={{marginTop:10}}>{studioCard(detailStudio,true)}</View>
          <Text style={styles.sectionTitle}>학원 실제 사진</Text>
          {(detailStudio.imageUrls||[]).length>0?
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:9,paddingBottom:4}}>
             {(detailStudio.imageUrls||[]).map((uri,index)=><Image key={uri+index} source={{uri}} style={styles.studioPhoto} resizeMode="cover"/>)}
            </ScrollView>
            :<View style={styles.photoEmpty}><Text style={styles.filterHint}>공식 홈페이지에서 확인한 사진이 아직 없습니다.</Text>{detailStudio.websiteUrl&&<Pressable onPress={()=>Linking.openURL(detailStudio.websiteUrl!).catch(()=>Alert.alert("홈페이지 연결","사이트를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>공식 홈페이지 방문 ›</Text></Pressable>}</View>}
          {!!detailStudio.imageSourceName&&<Text style={styles.photoCredit}>이미지 출처: {detailStudio.imageSourceName}{detailStudio.imageCheckedAt?" · 확인 "+new Date(detailStudio.imageCheckedAt).toLocaleDateString("ko-KR"):""}</Text>}
          {!!detailStudio.imageUsageNote&&<Text style={styles.photoCredit}>사진 이용 메모: {detailStudio.imageUsageNote}</Text>}
          {!!detailStudio.sourceName&&<Text style={styles.photoCredit}>정보 출처: {detailStudio.sourceName}{detailStudio.verifiedAt?" · 확인 "+new Date(detailStudio.verifiedAt).toLocaleDateString("ko-KR"):""}</Text>}
          {!!detailStudio.sourceUrl&&<Pressable onPress={()=>Linking.openURL(detailStudio.sourceUrl!).catch(()=>Alert.alert("출처 연결","출처 페이지를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>정보 원문 확인 ›</Text></Pressable>}
          <Text style={styles.sectionTitle}>학원 소개</Text><Text style={styles.detailDescription}>{detailStudio.description}</Text>
          <Text style={styles.sectionTitle}>가격 및 수업 시간표</Text>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>대표 수강료</Text><Text style={styles.infoValue}>{detailStudio.price!==null?"₩"+detailStudio.price.toLocaleString()+" / 회":"가격 미등록 · 학원 문의"}</Text></View>
          {supabaseConfigured&&<>{classesLoading?<ActivityIndicator color={COLORS.purple} style={{marginVertical:12}}/>:studioClasses.length?studioClasses.map(cls=><View key={cls.id} style={styles.classBlock}><Text style={styles.classTitle}>{cls.title}</Text><Text style={styles.classMeta}>{cls.audience==="adult"?"성인":cls.audience==="kids"?"키즈":"전체"} · {cls.level||"수준 미표기"} · {cls.duration_minutes||"-"}분 · {cls.price!=null?"₩"+cls.price.toLocaleString():"가격 문의"}</Text>{cls.class_sessions?.length?cls.class_sessions.map((session,i)=><Text key={i} style={styles.sessionText}>{["일","월","화","수","목","금","토"][session.weekday]}요일 {session.start_time.slice(0,5)}{session.end_time?("–"+session.end_time.slice(0,5)):""}{session.note?(" · "+session.note):""}</Text>):<Text style={styles.sessionText}>등록된 시간표가 없습니다.</Text>}</View>):<Text style={styles.filterHint}>등록된 수업 및 시간표가 없습니다. 확인된 정보가 등록되면 여기에 표시됩니다.</Text>}</>}
          {detailStudio.address&&<View style={styles.infoRow}><Text style={styles.infoLabel}>주소</Text><Text style={styles.infoValue}>{detailStudio.address}</Text></View>}
          <View style={styles.infoRow}><Text style={styles.infoLabel}>수업 대상</Text><Text style={styles.infoValue}>{[detailStudio.adult?"성인":null,detailStudio.kids?"키즈":null].filter(Boolean).join(" · ")||"미등록"}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>수준</Text><Text style={styles.infoValue}>{detailStudio.level.join(" · ")||"미등록"}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>전화</Text><Text style={styles.infoValue}>{detailStudio.phone||"미등록"}</Text></View>
          {detailStudio.phone&&<Pressable style={styles.detailBtn} onPress={()=>Linking.openURL("tel:"+detailStudio.phone).catch(()=>Alert.alert("전화 연결","전화 앱을 열 수 없습니다."))}><Text style={styles.detailBtnText}>전화 문의 · {detailStudio.phone}</Text></Pressable>}
          <Text style={styles.detailDisclaimer}>가격과 시간표는 학원 또는 관리자에게 확인된 등록 정보만 표시합니다. 최신 여부를 확인해 주세요.</Text>
          <Pressable style={styles.applyButton} onPress={()=>toggleFavorite(detailStudio)}><Text style={styles.applyText}>{favoriteIds.includes(detailStudio.id)?"찜 해제":"♡ 즐겨찾기 추가"}</Text></Pressable>
        </>}</ScrollView>
       </Animated.View>
      </View>
    </Modal>
    <Modal visible={filterOpen} animationType="slide" transparent onRequestClose={()=>setFilterOpen(false)}>
      <View style={styles.modalShade}><View style={[styles.modal,{maxHeight:"90%"}]}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>검색 필터</Text><Pressable onPress={()=>setFilterOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled"><Text style={styles.sectionTitle}>대상</Text><View style={styles.filterChoices}><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/></View>
        <Text style={styles.sectionTitle}>수준</Text><View style={styles.filterChoices}>{["입문","초급","중급","고급"].map(v=><Chip key={v} label={v} active={level===v} onPress={()=>setLevel(level===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>요일</Text><View style={styles.filterChoices}>{["평일","주말"].map(v=><Chip key={v} label={v} active={dayFilter===v} onPress={()=>setDayFilter(dayFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>시간대</Text><View style={styles.filterChoices}>{["오전","오후","저녁"].map(v=><Chip key={v} label={v} active={timeFilter===v} onPress={()=>setTimeFilter(timeFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>가격</Text><View style={styles.filterChoices}>{[{label:"2만원 이하",value:20000},{label:"2.5만원 이하",value:25000},{label:"3만원 이하",value:30000}].map(v=><Chip key={v.value} label={v.label} active={maxPrice===v.value} onPress={()=>setMaxPrice(maxPrice===v.value?null:v.value)}/>)}</View>
        <Text style={styles.sectionTitle}>수업 길이</Text><View style={styles.filterChoices}>{[45,50,60,75,90].map(v=><Chip key={v} label={v+"분"} active={durationFilter===v} onPress={()=>setDurationFilter(durationFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>거리 (지도 중심 기준)</Text><View style={styles.filterChoices}>{[1,3,5,10].map(v=><Chip key={v} label={v+"km"} active={maxDistance===v} onPress={()=>setMaxDistance(maxDistance===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>혜택</Text><View style={styles.filterChoices}><Chip label="쿠폰/할인" active={coupon} onPress={()=>setCoupon(!coupon)}/></View>
        <Text style={styles.filterHint}>거리 필터는 현재 지도 중심을 기준으로 계산합니다.</Text>
        </ScrollView><View style={styles.modalActions}><Pressable style={styles.resetButton} onPress={resetFilters}><Text style={styles.resetText}>초기화</Text></Pressable><Pressable style={styles.applyButton} onPress={()=>setFilterOpen(false)}><Text style={styles.applyText}>결과 {results.length}곳 보기</Text></Pressable></View>
      </View></View>
    </Modal>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:COLORS.bg},header:{paddingHorizontal:20,paddingTop:8,paddingBottom:12,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:25,fontWeight:"900",letterSpacing:-0.7,color:COLORS.ink},brandDot:{color:COLORS.purple,fontSize:19},subtitle:{fontSize:12,color:COLORS.muted,marginTop:3},profileButton:{height:40,width:40,borderRadius:14,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},
 searchRow:{paddingHorizontal:16,flexDirection:"row",gap:9},searchBox:{flex:1,flexDirection:"row",alignItems:"center",backgroundColor:"#fff",borderRadius:15,paddingHorizontal:13,height:48,borderWidth:1,borderColor:COLORS.line,gap:8},searchInput:{flex:1,fontSize:14,color:COLORS.ink},clear:{fontSize:21,color:COLORS.muted},filterButton:{width:48,height:48,backgroundColor:"#fff",borderRadius:15,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},filterCount:{position:"absolute",top:4,right:4,backgroundColor:COLORS.purple,width:16,height:16,borderRadius:8,alignItems:"center",justifyContent:"center"},filterCountText:{fontSize:10,color:"#fff",fontWeight:"700"},
 quickFilters:{flexDirection:"row",paddingHorizontal:16,paddingVertical:10,gap:7},chip:{borderRadius:20,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",paddingHorizontal:13,paddingVertical:8},chipActive:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},chipText:{fontSize:12,color:"#625E70"},chipTextActive:{color:COLORS.purple,fontWeight:"700"},
 content:{flex:1,marginTop:2},mapWrap:{flex:1,overflow:"hidden",borderTopLeftRadius:22,borderTopRightRadius:22},map:{flex:1},pin:{backgroundColor:"#fff",paddingHorizontal:10,paddingVertical:7,borderRadius:18,borderColor:"#DCD6F8",borderWidth:1.5,elevation:3,shadowColor:"#000",shadowOpacity:0.1,shadowRadius:4},pinSelected:{backgroundColor:COLORS.purple,borderColor:COLORS.purple},pinText:{fontSize:11,fontWeight:"800",color:COLORS.purple},pinTextSelected:{color:"#fff"},areaSearch:{position:"absolute",top:14,alignSelf:"center",backgroundColor:"#fff",paddingHorizontal:16,paddingVertical:11,borderRadius:24,elevation:4,shadowColor:"#000",shadowOpacity:0.12,shadowRadius:5},areaSearchText:{color:COLORS.ink,fontSize:13,fontWeight:"700"},locateButton:{position:"absolute",right:15,bottom:135,width:44,height:44,borderRadius:14,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",elevation:3},mapCount:{position:"absolute",left:14,bottom:15,backgroundColor:"#fff",paddingHorizontal:13,paddingVertical:10,borderRadius:13,elevation:2},mapCountText:{fontSize:12,color:COLORS.ink,fontWeight:"700"},selectedCard:{position:"absolute",bottom:12,left:10,right:10,backgroundColor:"#fff",borderRadius:18,padding:10,elevation:7,shadowColor:"#000",shadowOpacity:0.15,shadowRadius:10},studioCard:{backgroundColor:"#fff",borderRadius:17,padding:14,marginBottom:10,borderWidth:1,borderColor:"#F0EDF5"},compactCard:{marginBottom:0,padding:8,borderWidth:0},cardTop:{flexDirection:"row",alignItems:"center",gap:10},studioIcon:{width:42,height:42,borderRadius:13,backgroundColor:COLORS.pink,alignItems:"center",justifyContent:"center"},studioName:{fontSize:15,fontWeight:"800",color:COLORS.ink},studioArea:{fontSize:11,color:COLORS.muted,marginTop:3},couponBadge:{backgroundColor:"#FFF1D9",borderRadius:8,paddingHorizontal:7,paddingVertical:4},couponText:{fontSize:10,color:"#B87922",fontWeight:"700"},tagsRow:{flexDirection:"row",gap:5,marginTop:11},tag:{backgroundColor:"#F6F4F9",borderRadius:6,paddingHorizontal:7,paddingVertical:4},tagText:{fontSize:10,color:"#777184"},cardBottom:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:11},priceText:{fontSize:14,fontWeight:"800",color:COLORS.ink},priceUnit:{fontSize:11,fontWeight:"400",color:COLORS.muted},metaText:{fontSize:11,color:COLORS.muted},cardActions:{flexDirection:"row",gap:7,marginTop:9},actionChip:{backgroundColor:"#F7F5FA",borderRadius:9,paddingHorizontal:10,paddingVertical:6},actionText:{fontSize:10,color:COLORS.purple,fontWeight:"700"},compareFloating:{position:"absolute",bottom:72,alignSelf:"center",backgroundColor:COLORS.purple,paddingHorizontal:18,paddingVertical:12,borderRadius:24,zIndex:5,elevation:6},compareFloatingText:{fontSize:12,fontWeight:"800",color:"#fff"},dragHeader:{paddingBottom:6},dragHandle:{width:42,height:5,borderRadius:3,backgroundColor:"#D8D4E1",alignSelf:"center",marginBottom:12},dragHint:{fontSize:10,color:COLORS.muted,marginTop:5,textAlign:"center"},expandText:{fontSize:12,color:COLORS.purple,fontWeight:"800"},studioPhoto:{width:250,height:158,borderRadius:13,backgroundColor:"#F3F0F5"},photoEmpty:{backgroundColor:"#F8F6FB",padding:14,borderRadius:12},photoSourceLink:{fontSize:12,color:COLORS.purple,fontWeight:"800",marginTop:7},photoCredit:{fontSize:10,color:COLORS.muted,marginTop:5},classBlock:{backgroundColor:"#F8F6FB",borderRadius:12,padding:12,marginBottom:8},classTitle:{fontSize:13,fontWeight:"800",color:COLORS.ink},classMeta:{fontSize:11,color:COLORS.muted,marginTop:4},sessionText:{fontSize:11,color:"#625E70",marginTop:5},compareRow:{borderBottomWidth:1,borderBottomColor:COLORS.line,paddingVertical:13},compareName:{fontSize:14,fontWeight:"800",color:COLORS.ink},compareInfo:{fontSize:11,color:COLORS.muted,marginTop:4},comparePrice:{fontSize:14,fontWeight:"900",color:COLORS.purple,marginTop:6},removeCompare:{fontSize:11,color:"#B66B77",marginTop:6},detailDescription:{fontSize:13,color:"#625E70",lineHeight:20},infoRow:{flexDirection:"row",justifyContent:"space-between",paddingVertical:9,borderBottomWidth:1,borderBottomColor:COLORS.line},infoLabel:{fontSize:12,color:COLORS.muted},infoValue:{fontSize:12,color:COLORS.ink,fontWeight:"700"},detailDisclaimer:{fontSize:10,color:"#A29EAC",marginTop:14},detailBtn:{backgroundColor:COLORS.pale,alignItems:"center",padding:10,borderRadius:12,marginTop:7},detailBtnText:{fontSize:12,fontWeight:"700",color:COLORS.purple},dismiss:{position:"absolute",top:9,right:8,width:24,height:24,borderRadius:12,backgroundColor:"#F5F3F8",alignItems:"center",justifyContent:"center"},dismissText:{fontSize:20,color:COLORS.muted},listContent:{padding:12,paddingBottom:20},empty:{textAlign:"center",padding:30,color:COLORS.muted},
 bottomNav:{height:61,backgroundColor:"#fff",borderTopWidth:1,borderTopColor:COLORS.line,flexDirection:"row",justifyContent:"space-around",alignItems:"center",paddingBottom:3},navItem:{alignItems:"center",justifyContent:"center",gap:2,flex:1},navIcon:{fontSize:20,color:"#9D98AA"},navLabel:{fontSize:10,color:"#9D98AA"},navActive:{color:COLORS.purple,fontWeight:"800"},
 modalShade:{flex:1,backgroundColor:"rgba(30,25,45,0.35)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:24,borderTopRightRadius:24,padding:22,paddingBottom:30},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},modalTitle:{fontSize:20,fontWeight:"900",color:COLORS.ink},sectionTitle:{fontSize:14,fontWeight:"800",color:COLORS.ink,marginTop:23,marginBottom:10},filterChoices:{flexDirection:"row",flexWrap:"wrap",gap:8},filterHint:{fontSize:11,color:COLORS.muted,marginTop:20,lineHeight:17},modalActions:{flexDirection:"row",gap:10,marginTop:25},resetButton:{flex:1,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,borderWidth:1,borderColor:COLORS.line},resetText:{fontWeight:"700",color:COLORS.ink},applyButton:{flex:2,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,backgroundColor:COLORS.purple},applyText:{fontWeight:"800",color:"#fff"}
});