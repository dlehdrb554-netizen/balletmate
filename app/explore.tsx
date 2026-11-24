import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator, Animated, FlatList, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, Platform, Alert
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
type Region = {latitude:number;longitude:number;latitudeDelta:number;longitudeDelta:number};
import { fetchStudios, fetchStudioById, searchStudiosByName, searchStudiosByKakao, isExcludedStudioSearchResult, StudioRecord } from "../lib/studios";
import { fetchClassesForStudio, StudioClass } from "../lib/classes";
import { searchStudiosByClassFilters, searchStudioIdsByClassName } from "../lib/class-search";
import { fetchCouponsForStudio, StudioCoupon } from "../lib/coupons";
import { fetchStudioBlogPosts, StudioBlogPost, fetchStudioPublicPrices, StudioPublicPrice, fetchStudioPublicSchedules, StudioPublicSchedule } from "../lib/studio-blog-content";
import { supabase, supabaseConfigured } from "../lib/supabase";
import * as Location from "expo-location";
import KakaoMap, { KakaoMapHandle } from "../components/KakaoMap";

type Studio = {
  id: string; name: string; lat: number; lng: number; area: string;
  tags: string[]; price: number | null; coupon: boolean; adult: boolean; kids: boolean;
  level: string[]; days: string[]; time: string; duration: number; rating: number;
  description: string; address?: string; phone?: string; imageUrls?: string[]; websiteUrl?: string; imageSourceName?: string; imageCheckedAt?: string; sourceUrl?: string; sourceName?: string; sourceStatus?: string; verifiedAt?: string; imageUsageNote?: string; priceEvidenceText?: string; scheduleEvidenceText?: string; detailsSourceUrls?: string[];kakaoChannelUrl?:string;detailsCheckedAt?: string; detailsStatus?: string; classDurations?: number[];
};
const cleanPublicText=(value:string|null|undefined)=>String(value||"").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").split(" ").filter(Boolean).join(" ");
const mapStudioRecord = (r: StudioRecord): Studio => ({
  id:r.id,name:r.name,lat:Number(r.latitude),lng:Number(r.longitude),area:r.district||"지역 정보 없음",
  address:r.address||undefined,tags:r.tags||[],price:r.price_per_class,coupon:!!r.coupon_available,
  adult:!!r.adult_classes,kids:!!r.kids_classes,level:r.levels||[],days:r.days||[],
  time:(r.time_slots||[]).join(" · "),duration:r.duration_minutes||0,rating:Number(r.rating||0),
  description:r.description||"등록된 소개가 없습니다.",phone:r.phone||undefined,imageUrls:r.image_urls||[],
  websiteUrl:r.website_url||undefined,imageSourceName:r.image_source_name||undefined,
  imageCheckedAt:r.image_checked_at||undefined,sourceUrl:r.source_url||undefined,
  sourceName:r.source_name||undefined,sourceStatus:r.source_status||undefined,verifiedAt:r.verified_at||undefined,
  imageUsageNote:r.image_usage_note||undefined,priceEvidenceText:r.price_evidence_text||undefined,
  scheduleEvidenceText:r.schedule_evidence_text||undefined,detailsSourceUrls:r.details_source_urls||[],kakaoChannelUrl:r.kakao_channel_url||undefined,
  detailsCheckedAt:r.details_checked_at||undefined,detailsStatus:r.details_status||undefined,
  classDurations:r.class_durations||[]
});

const PROVINCES=["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원도","충청북도","충청남도","전라북도","전라남도","경상북도","경상남도","제주도"];
const CITY_PROVINCE:Record<string,string>={"고양시":"경기","성남시":"경기","수원시":"경기","용인시":"경기","화성시":"경기","부천시":"경기","안양시":"경기","안산시":"경기","의정부시":"경기","남양주시":"경기","파주시":"경기","김포시":"경기","광명시":"경기","하남시":"경기","평택시":"경기","시흥시":"경기","광주시":"경기","양주시":"경기","구리시":"경기","군포시":"경기","오산시":"경기","이천시":"경기","포천시":"경기","춘천시":"강원도","원주시":"강원도","강릉시":"강원도","청주시":"충청북도","천안시":"충청남도","아산시":"충청남도","전주시":"전라북도","익산시":"전라북도","군산시":"전라북도","목포시":"전라남도","여수시":"전라남도","순천시":"전라남도","포항시":"경상북도","경주시":"경상북도","구미시":"경상북도","창원시":"경상남도","김해시":"경상남도","진주시":"경상남도","거제시":"경상남도","제주시":"제주도","서귀포시":"제주도"};
const PROVINCE_ALIASES:Record<string,string>={"서울특별시":"서울","경기도":"경기","강원":"강원도","강원특별자치도":"강원도","충북":"충청북도","충남":"충청남도","전북":"전라북도","전남":"전라남도","경북":"경상북도","경남":"경상남도","제주":"제주도","제주특별자치도":"제주도","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주","대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종"};
const parseArea=(area:string)=>{
  const parts=area.trim().split(/\s+/).filter(Boolean),first=parts[0]||"",normalized=PROVINCE_ALIASES[first]||first;
  const explicitProvince=PROVINCES.includes(normalized);
  const metro=["서울","부산","대구","인천","광주","대전","울산","세종"].includes(normalized);
  const city=explicitProvince?(metro?normalized:(parts[1]||normalized)):first;
  const province=explicitProvince?normalized:(CITY_PROVINCE[city]||(["서울","부산","대구","인천","광주","대전","울산","세종"].includes(city)?city:"기타"));
  const detail=explicitProvince?parts.slice(metro?1:2).join(" "):parts.slice(1).join(" ");
  return {province,city,detail:detail||area};
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
const COLORS = {ink:"#252238",muted:"#8B879A",purple:"#653BB7",pale:"#F2ECFF",bg:"#FBF9FF",line:"#E9E2F2",white:"#FFFFFF",pink:"#F7EFFF"};

const sourceStatusMeta=(status?:string|null)=>{
  if(status==="both")return {label:"교육청 등록 확인",icon:"checkmark-circle" as const,color:"#18794E",bg:"#EAF6EF",description:"교육청 학원 정보와 지도 업체 정보가 함께 확인된 곳입니다."};
  if(status==="kakao_only")return {label:"등록 여부 미확인",icon:"location-outline" as const,color:"#666477",bg:"#F1F0F5",description:"지도 업체 정보는 확인됐지만 교육청 등록 정보와의 연결은 확인되지 않았습니다. 미등록을 의미하지 않습니다."};
  if(status==="neis_only")return {label:"교육청 등록 확인 · 위치 보완",icon:"business-outline" as const,color:"#5D4AA2",bg:"#F1ECFC",description:"교육청 등록 정보는 확인됐으며, 지도 업체 정보가 없어 등록 주소를 기준으로 위치를 표시합니다."};
  return null;
};

function Chip({label,active,onPress}: {label:string;active?:boolean;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[styles.chip,active&&styles.chipActive]}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{label}</Text></Pressable>;
}
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const map = useRef<KakaoMapHandle | null>(null);
  const [studios,setStudios]=useState<Studio[]>(supabaseConfigured?[]:DATA);
  const [backendState,setBackendState]=useState<"mock"|"loading"|"connected"|"empty"|"error">(supabaseConfigured?"loading":"mock");
  const [region,setRegion]=useState(INITIAL);
  const [mapMoved,setMapMoved]=useState(false);
  const [search,setSearch]=useState("");
  const [classSearchIds,setClassSearchIds]=useState<string[]>([]);
  const [globalSearchStudios,setGlobalSearchStudios]=useState<Studio[]>([]);
  const [searchMatches,setSearchMatches]=useState<Studio[]>([]);
  const [searchResultsOpen,setSearchResultsOpen]=useState(false);
  const [searchSubmitting,setSearchSubmitting]=useState(false);
  const areaSearchRequestId=useRef(0);
  const searchSubmitRequestId=useRef(0);
  const [pendingMapTarget,setPendingMapTarget]=useState<Region|null>(null);
  const [classSearchLoading,setClassSearchLoading]=useState(false);
  const [selected,setSelected]=useState<Studio|null>(null);
  const [view,setView]=useState<"map"|"list"|"favorites">("map");
  const [listSort,setListSort]=useState<"distance"|"price">("distance");
  const [selectedListRegion,setSelectedListRegion]=useState("전체");
  const [rankMode,setRankMode]=useState<"views"|"favorites">("views");
  const [regionPickerOpen,setRegionPickerOpen]=useState(false);
  const [regionProvince,setRegionProvince]=useState("전체");
  const [regionCity,setRegionCity]=useState("전체");
  const [directoryAreas,setDirectoryAreas]=useState<string[]>(DATA.map(studio=>studio.area));
  const [directoryStudios,setDirectoryStudios]=useState<Studio[]>([]);
  const [popularViewRank,setPopularViewRank]=useState<any[]>([]);
  const [favoriteRank,setFavoriteRank]=useState<any[]>([]);
  const [rankLoading,setRankLoading]=useState(false);
  const [selectedRankStudio,setSelectedRankStudio]=useState<Studio|null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const [filterOpen,setFilterOpen]=useState(false);
  const [detailStudio,setDetailStudio]=useState<Studio|null>(null);
  const [detailCanonicalLoading,setDetailCanonicalLoading]=useState(false);
  const [detailCanonicalError,setDetailCanonicalError]=useState<string|null>(null);
  const [detailContentError,setDetailContentError]=useState<string|null>(null);
  const [failedStudioImageUrls,setFailedStudioImageUrls]=useState<string[]>([]);
  const [reportOpen,setReportOpen]=useState(false);
  const [reportCategory,setReportCategory]=useState("기타");
  const [reportDescription,setReportDescription]=useState("");
  const [reportSubmitting,setReportSubmitting]=useState(false);
  const [freshness,setFreshness]=useState<any>(null);
  const [freshnessLoading,setFreshnessLoading]=useState(false);
  const [studioClasses,setStudioClasses]=useState<StudioClass[]>([]);
  const [classesLoading,setClassesLoading]=useState(false);
  const [studioBlogPosts,setStudioBlogPosts]=useState<StudioBlogPost[]>([]);
  const [studioPublicPrices,setStudioPublicPrices]=useState<StudioPublicPrice[]>([]);
  const [studioPublicSchedules,setStudioPublicSchedules]=useState<StudioPublicSchedule[]>([]);
  const [studioOwnerNotices,setStudioOwnerNotices]=useState<any[]>([]);
  const [evidencePhotoIndexes,setEvidencePhotoIndexes]=useState<Record<string,number>>({});
  const [studioCoupons,setStudioCoupons]=useState<StudioCoupon[]>([]);
  const [blogLoading,setBlogLoading]=useState(false);
  const detailRequestId=useRef(0);
  const [detailExpanded,setDetailExpanded]=useState(false);
  const [detailTab,setDetailTab]=useState<"home"|"notices"|"blog"|"reviews"|"photos">("home");
  const [detailInfoTab,setDetailInfoTab]=useState<"price"|"schedule">("price");
  const [studioReviews,setStudioReviews]=useState<any[]>([]);
  const [reviewsLoading,setReviewsLoading]=useState(false);
  const [reviewRating,setReviewRating]=useState(5);
  const [reviewText,setReviewText]=useState("");
  const [reviewSubmitting,setReviewSubmitting]=useState(false);
  const [reviewUserId,setReviewUserId]=useState<string|null>(null);
  const [mapProvider,setMapProvider]=useState<"google"|"kakao"|null>(null);
  const [mapSettingsOpen,setMapSettingsOpen]=useState(false);
  const [pendingDirectionsStudio,setPendingDirectionsStudio]=useState<Studio|null>(null);
  const detailDragY=useRef(new Animated.Value(0)).current;
  const detailPan=useRef(PanResponder.create({
    // Dedicated grip zone: keep gesture handling away from the close buttons and content scroll.
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,gesture)=>Math.abs(gesture.dy)>6,
    onMoveShouldSetPanResponderCapture:()=>false,
    onPanResponderMove:(_,gesture)=>detailDragY.setValue(Math.max(-180,Math.min(420,gesture.dy))),
    onPanResponderRelease:(_,gesture)=>{
      const dy=gesture.dy;
      if(dy>145){
        Animated.timing(detailDragY,{toValue:520,duration:150,useNativeDriver:false}).start(()=>{
          detailRequestId.current++;
          setDetailStudio(null);
          setClassesLoading(false);
          setDetailExpanded(false);
          detailDragY.setValue(0);
        });
        return;
      }
      if(dy>48)setDetailExpanded(false);
      else if(dy< -48)setDetailExpanded(true);
      Animated.spring(detailDragY,{toValue:0,useNativeDriver:false,bounciness:3}).start();
    },
    onPanResponderTerminationRequest:()=>false,
    onPanResponderTerminate:()=>Animated.spring(detailDragY,{toValue:0,useNativeDriver:false,bounciness:3}).start(),
    onShouldBlockNativeResponder:()=>true,
  })).current;
  useEffect(()=>{AsyncStorage.getItem("balletmate.mapProvider.v1").then(value=>{if(value==="google"||value==="kakao")setMapProvider(value);}).catch(()=>{});},[]);
  useEffect(()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId){setFreshness(null);return;}
    let active=true;
    setFreshnessLoading(true);
    client.from("studio_information_freshness_app").select("profile_freshness,official_details_freshness,photo_freshness,latest_price_date,price_freshness,latest_schedule_date,schedule_freshness").eq("studio_id",studioId).maybeSingle().then(({data,error})=>{
      if(!active)return;
      setFreshness(error?null:data);
      setFreshnessLoading(false);
    });
    return ()=>{active=false;};
  },[detailStudio?.id]);
  useEffect(()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId||detailTab!=="notices")return;
    let active=true;
    void (async()=>{
      try{
        const {data,error}=await client.from("studio_owner_notices").select("id,title,body,created_at")
          .eq("studio_id",studioId).eq("is_active",true).order("created_at",{ascending:false}).limit(10);
        if(active)setStudioOwnerNotices(error?[]:(data||[]));
      }catch{if(active)setStudioOwnerNotices([]);}
    })();
    return()=>{active=false;};
  },[detailStudio?.id,detailTab]);
  useEffect(()=>{
    const studioId=detailStudio?.id;
    if(!supabase||!studioId)return;
    let active=true;
    setBlogLoading(true);
    fetchStudioBlogPosts(studioId).then(rows=>{if(active)setStudioBlogPosts(rows);})
      .catch(error=>{console.warn("Studio blog content unavailable:",error);if(active){setStudioBlogPosts([]);setDetailContentError("블로그 자료를 불러오지 못했습니다.");}})
      .finally(()=>{if(active)setBlogLoading(false);});
    return()=>{active=false;};
  },[detailStudio?.id]);
  const [compareOpen,setCompareOpen]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<string[]>([]);
  const [favoriteStudios,setFavoriteStudios]=useState<Studio[]>([]);
  const [favoritesReady,setFavoritesReady]=useState(false);
  const guestFavoritesRef=useRef<{ids:string[];studios:Studio[]}>({ids:[],studios:[]});
  const [compareIds,setCompareIds]=useState<string[]>([]);
  const [compareCache,setCompareCache]=useState<Studio[]>([]);
  const [compareReady,setCompareReady]=useState(false);
  const [compareClassData,setCompareClassData]=useState<Record<string,StudioClass[]>>({});
  const [compareClassLoading,setCompareClassLoading]=useState(false);
  useEffect(()=>{
    if(!compareOpen||compareIds.length===0)return;
    let active=true;
    setCompareClassLoading(true);
    Promise.all(compareIds.map(async id=>[id,await fetchClassesForStudio(id)] as const))
      .then(entries=>{if(active)setCompareClassData(Object.fromEntries(entries));})
      .catch(error=>{if(active)console.warn("Comparison timetable unavailable:",error);})
      .finally(()=>{if(active)setCompareClassLoading(false);});
    return()=>{active=false;};
  },[compareOpen,compareIds]);
  const [adult,setAdult]=useState(false);
  const [kids,setKids]=useState(false);
  const [coupon,setCoupon]=useState(false);
  const [neisOnlyFilter,setNeisOnlyFilter]=useState(false);
  const [level,setLevel]=useState<string|null>(null);
  const [dayFilter,setDayFilter]=useState<string|null>(null);
  const [timeFilter,setTimeFilter]=useState<string|null>(null);
  const [maxPrice,setMaxPrice]=useState<number|null>(null);
  const [durationFilter,setDurationFilter]=useState<number|null>(null);
  const [classTypeFilter,setClassTypeFilter]=useState<string|null>(null);
  const [classTypeOptions,setClassTypeOptions]=useState<string[]>([]);
  const [classFilterIds,setClassFilterIds]=useState<string[]>([]);
  const [classFilterLoading,setClassFilterLoading]=useState(false);
  const [maxDistance,setMaxDistance]=useState<number|null>(null);
  const [locationLoading,setLocationLoading]=useState(false);
  const [locationGranted,setLocationGranted]=useState(false);
  const [currentLocation,setCurrentLocation]=useState<{latitude:number;longitude:number}|null>(null);
  const [searchedRegion,setSearchedRegion]=useState(INITIAL);
  const [areaLocked,setAreaLocked]=useState(false);
  useEffect(()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId||detailTab!=="reviews")return;
    let active=true;
    setReviewsLoading(true);
    (async()=>{
      try{
        const {data:authData}=await client.auth.getSession();
        const userId=authData.session?.user.id||null;
        if(active)setReviewUserId(userId);
        const {data,error}=await client.from("studio_reviews")
          .select("id,studio_id,user_id,rating,content,created_at,updated_at")
          .eq("studio_id",studioId).order("created_at",{ascending:false}).limit(100);
        if(!active)return;
        if(error)throw error;
        const rows=data||[];
        setStudioReviews(rows);
        const mine=rows.find((row:any)=>row.user_id===userId);
        if(mine){setReviewRating(Number(mine.rating));setReviewText(mine.content||"");}
        else{setReviewRating(5);setReviewText("");}
      }catch(error){if(active){console.warn("Studio reviews unavailable:",error);setStudioReviews([]);}}
      finally{if(active)setReviewsLoading(false);}
    })();
    return()=>{active=false;};
  },[detailStudio?.id,detailTab]);

  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    supabase.from("classes").select("class_type").eq("is_active",true).not("class_type","is",null).limit(300)
      .then(({data,error})=>{
        if(!active||error)return;
        setClassTypeOptions([...new Set((data||[]).map((row:any)=>String(row.class_type||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko")));
      });
    return()=>{active=false;};
  },[]);

  const hasClassLevelFilters=!!(adult||kids||classTypeFilter||level||dayFilter||timeFilter||durationFilter!==null||maxPrice!==null);
  useEffect(()=>{
    if(!supabase||!hasClassLevelFilters){setClassFilterIds([]);setClassFilterLoading(false);return;}
    let active=true;
    const timer=setTimeout(()=>{
      setClassFilterLoading(true);
      searchStudiosByClassFilters({
        audiences:[adult?"adult":null,kids?"kids":null].filter((value):value is "adult"|"kids"=>value!==null),
        classType:classTypeFilter,level,weekdayGroup:dayFilter as "평일"|"주말"|null,
        timeOfDay:timeFilter as "오전"|"오후"|"저녁"|null,
        durationMinutes:durationFilter,maxPrice,
      }).then(ids=>{if(active)setClassFilterIds(ids);})
        .catch(error=>{if(active){setClassFilterIds([]);console.warn("Class filter search failed:",error);}})
        .finally(()=>{if(active)setClassFilterLoading(false);});
    },250);
    return()=>{active=false;clearTimeout(timer);};
  },[adult,kids,classTypeFilter,level,dayFilter,timeFilter,durationFilter,maxPrice,hasClassLevelFilters]);

  useEffect(()=>{
    const client=supabase;
    const query=search.trim();
    if(!client||query.length<2){setClassSearchIds([]);setClassSearchLoading(false);return;}
    let active=true;
    const timer=setTimeout(async()=>{
      setClassSearchLoading(true);
      try{
        const ids=await searchStudioIdsByClassName(query);
        if(active)setClassSearchIds(ids);
      }catch{if(active)setClassSearchIds([]);}
      finally{if(active)setClassSearchLoading(false);}
    },350);
    return()=>{active=false;clearTimeout(timer);};
  },[search]);

  const globalSearchIdSet=useMemo(()=>new Set(globalSearchStudios.map(studio=>studio.id)),[globalSearchStudios]);
  const classSearchIdSet=useMemo(()=>new Set(classSearchIds),[classSearchIds]);
  const classFilterIdSet=useMemo(()=>new Set(classFilterIds),[classFilterIds]);
  const mergedStudios=useMemo(()=>[...new Map([...studios,...globalSearchStudios].map(studio=>[studio.id,studio])).values()],[studios,globalSearchStudios]);
  const results=useMemo(()=>mergedStudios.filter(s=>{
    const q=search.trim().toLowerCase();
    if(q && !globalSearchIdSet.has(s.id) && !s.name.toLowerCase().includes(q) && !s.area.toLowerCase().includes(q) && !s.tags.some(t=>t.toLowerCase().includes(q)) && !classSearchIdSet.has(s.id)) return false;
    if((adult||kids)&&!((adult&&s.adult)||(kids&&s.kids)))return false;
    if(coupon&&!s.coupon)return false;
    if(neisOnlyFilter&&s.sourceStatus!=="both"&&s.sourceStatus!=="neis_only")return false;
    if(hasClassLevelFilters&&!classFilterIdSet.has(s.id))return false;
    if(level&&!s.level.includes(level))return false;
    if(dayFilter&&!s.days.includes(dayFilter))return false;
    if(timeFilter&&!s.time.includes(timeFilter))return false;
    if(maxPrice!==null&&(s.price===null||s.price>maxPrice))return false;
    if(durationFilter!==null&&!(s.classDurations?.length?s.classDurations.includes(durationFilter):s.duration===durationFilter))return false;
    if(maxDistance!==null&&distanceKm(searchedRegion.latitude,searchedRegion.longitude,s.lat,s.lng)>maxDistance)return false;
    if(areaLocked){
      const latSpan=searchedRegion.latitudeDelta/2;
      const lngSpan=searchedRegion.longitudeDelta/2;
      if(Math.abs(s.lat-searchedRegion.latitude)>latSpan||Math.abs(s.lng-searchedRegion.longitude)>lngSpan)return false;
    }
    return true;
  }),[mergedStudios,globalSearchIdSet,search,classSearchIdSet,adult,kids,coupon,level,dayFilter,timeFilter,maxPrice,durationFilter,classTypeFilter,hasClassLevelFilters,classFilterIdSet,maxDistance,areaLocked,searchedRegion,neisOnlyFilter]);

  const mapMarkers=useMemo(()=>results.map(studio=>({id:studio.id,name:studio.name,area:studio.area,latitude:studio.lat,longitude:studio.lng})),[results]);
  const handleMapRegionChange=useCallback((next:Region)=>{areaSearchRequestId.current++;searchSubmitRequestId.current++;setSearchSubmitting(false);setRegion(next);setMapMoved(true);},[]);
  const handleMapMarkerPress=useCallback((id:string)=>{const studio=results.find(item=>item.id===id);if(studio)setSelected(studio);},[results]);
  const allListAreas=useMemo(()=>[...new Set([...directoryAreas,...studios.map(studio=>studio.area)].filter(area=>area&&area!=="지역 정보 없음"))].sort((a,b)=>a.localeCompare(b,"ko")),[directoryAreas,studios]);
  const listProvinces=["전체",...PROVINCES];
  const listCities=useMemo(()=>["전체",...new Set(allListAreas.filter(area=>regionProvince==="전체"||parseArea(area).province===regionProvince).map(area=>parseArea(area).city))].sort((a,b)=>a.localeCompare(b,"ko")),[allListAreas,regionProvince]);
  useEffect(()=>{let active=true;fetchStudios().then(rows=>{if(active){setDirectoryAreas([...new Set(rows.map(row=>row.district||"").filter(Boolean))]);setDirectoryStudios(rows.map(mapStudioRecord));}}).catch(error=>console.warn("전체 지역 목록 조회 실패:",error));return()=>{active=false;};},[]);
  const listDistricts=useMemo(()=>allListAreas.filter(area=>(regionProvince==="전체"||parseArea(area).province===regionProvince)&&(regionCity==="전체"||parseArea(area).city===regionCity)),[allListAreas,regionProvince,regionCity]);
  const listRows=useMemo(()=>{
    const rows=view==="favorites"?favoriteStudios:results.filter(studio=>selectedListRegion!=="전체"?studio.area===selectedListRegion:(regionProvince==="전체"||parseArea(studio.area).province===regionProvince)&&(regionCity==="전체"||parseArea(studio.area).city===regionCity));
    return [...rows].sort((a,b)=>{
      if(listSort==="price"){
        if(a.price===null&&b.price===null)return a.name.localeCompare(b.name,"ko");
        if(a.price===null)return 1;
        if(b.price===null)return -1;
        return a.price-b.price||a.name.localeCompare(b.name,"ko");
      }
      return distanceKm(searchedRegion.latitude,searchedRegion.longitude,a.lat,a.lng)-distanceKm(searchedRegion.latitude,searchedRegion.longitude,b.lat,b.lng);
    });
  },[view,favoriteStudios,results,listSort,searchedRegion,selectedListRegion,regionProvince,regionCity]);
  useEffect(()=>{
    if(view!=="list"||!supabase)return;
    let active=true;setRankLoading(true);
    Promise.all([
      supabase.rpc("get_studio_popular_views_rank",{p_region:selectedListRegion}),
      supabase.rpc("get_studio_favorite_rank",{p_region:selectedListRegion})
    ]).then(([viewsRes,favoritesRes])=>{
      if(!active)return;
      setPopularViewRank(viewsRes.error?[]:(viewsRes.data||[]).filter((r:any)=>selectedListRegion!=="전체"||((regionProvince==="전체"||parseArea(studios.find(studio=>studio.id===r.studio_id)?.area||"").province===regionProvince)&&(regionCity==="전체"||parseArea(studios.find(studio=>studio.id===r.studio_id)?.area||"").city===regionCity))));
      setFavoriteRank(favoritesRes.error?[]:(favoritesRes.data||[]).filter((r:any)=>selectedListRegion!=="전체"?studios.find(studio=>studio.id===r.studio_id)?.area===selectedListRegion:((regionProvince==="전체"||parseArea(studios.find(studio=>studio.id===r.studio_id)?.area||"").province===regionProvince)&&(regionCity==="전체"||parseArea(studios.find(studio=>studio.id===r.studio_id)?.area||"").city===regionCity))));
    }).finally(()=>{if(active)setRankLoading(false);});
    return()=>{active=false;};
  },[view,selectedListRegion,regionProvince,regionCity,studios]);
  const rankItems=rankMode==="views"?popularViewRank.filter((r:any)=>Number(r.view_count)>10):favoriteRank;
  const REGIONAL_SEARCH:Record<string,{latitude:number;longitude:number}> = {
    "화곡":{latitude:37.5416,longitude:126.8466},"화곡동":{latitude:37.5416,longitude:126.8466},"화곡역":{latitude:37.5423,longitude:126.8403},
    "까치산":{latitude:37.5317,longitude:126.8489},"까치산역":{latitude:37.5317,longitude:126.8489},
    "천호":{latitude:37.5386,longitude:127.1238},"천호동":{latitude:37.5386,longitude:127.1238},"천호역":{latitude:37.5386,longitude:127.1238},
    "미아사거리":{latitude:37.6131,longitude:127.0300},"미아사거리역":{latitude:37.6131,longitude:127.0300},
    "강서구":{latitude:37.5509,longitude:126.8495},"양천구":{latitude:37.5169,longitude:126.8664},"목동":{latitude:37.5260,longitude:126.8750},
    "마곡":{latitude:37.5600,longitude:126.8265},"발산":{latitude:37.5580,longitude:126.8370},"등촌":{latitude:37.5507,longitude:126.8640},
    "송파":{latitude:37.5145,longitude:127.1059},"잠실":{latitude:37.5133,longitude:127.1000},"강남":{latitude:37.4979,longitude:127.0276},
    "홍대":{latitude:37.5563,longitude:126.9236},"합정":{latitude:37.5495,longitude:126.9137},"신촌":{latitude:37.5551,longitude:126.9368},
    "은평구":{latitude:37.6027,longitude:126.9291},"종로":{latitude:37.5729,longitude:126.9794},"광화문":{latitude:37.5720,longitude:126.9769},
    "성수":{latitude:37.5446,longitude:127.0557},"건대":{latitude:37.5404,longitude:127.0692},"왕십리":{latitude:37.5614,longitude:127.0370},
    "백석":{latitude:37.6584,longitude:126.7932},"백석동":{latitude:37.6584,longitude:126.7932},"백석역":{latitude:37.6584,longitude:126.7932},
    "월롱":{latitude:37.7964,longitude:126.7928},"월롱면":{latitude:37.7964,longitude:126.7928},"월롱역":{latitude:37.7964,longitude:126.7928},
    "파주":{latitude:37.7599,longitude:126.7800},"운정":{latitude:37.7250,longitude:126.7550},"금촌":{latitude:37.7667,longitude:126.7745},
    "일산":{latitude:37.6584,longitude:126.7900},"정발산":{latitude:37.6740,longitude:126.7730},"주엽":{latitude:37.6700,longitude:126.7610},"대화":{latitude:37.6760,longitude:126.7470},
    "분당":{latitude:37.3780,longitude:127.1130},"판교":{latitude:37.3948,longitude:127.1112},"수원":{latitude:37.2636,longitude:127.0286},"용인":{latitude:37.2411,longitude:127.1776},
    "평택":{latitude:36.9920,longitude:127.1128},"안성":{latitude:37.0080,longitude:127.2798},"오산":{latitude:37.1499,longitude:127.0775},"화성":{latitude:37.1995,longitude:126.8310},
    "인천":{latitude:37.4563,longitude:126.7052},"부천":{latitude:37.5034,longitude:126.7660},"김포":{latitude:37.6153,longitude:126.7156},"구리":{latitude:37.5943,longitude:127.1295},"남양주":{latitude:37.6360,longitude:127.2165},
    "춘천":{latitude:37.8813,longitude:127.7298},"강릉":{latitude:37.7519,longitude:128.8761},"대전":{latitude:36.3504,longitude:127.3845},"세종":{latitude:36.4800,longitude:127.2890},"청주":{latitude:36.6424,longitude:127.4890},
    "천안":{latitude:36.8151,longitude:127.1139},"아산":{latitude:36.7898,longitude:127.0017},"전주":{latitude:35.8242,longitude:127.1480},"광주":{latitude:35.1595,longitude:126.8526},"대구":{latitude:35.8714,longitude:128.6014},
    "부산":{latitude:35.1796,longitude:129.0756},"울산":{latitude:35.5384,longitude:129.3114},"창원":{latitude:35.2281,longitude:128.6811},"제주":{latitude:33.4996,longitude:126.5312}
  };
  const submitSearch=async()=>{
    if(searchSubmitting)return;
    const requestId=++searchSubmitRequestId.current;
    setSearchSubmitting(true);
    Keyboard.dismiss();
    const query=search.trim();
    if(!query){setAreaLocked(false);setSelected(null);setGlobalSearchStudios([]);setSearchSubmitting(false);return;}

    const q=query.toLowerCase();
    const regionKey=Object.keys(REGIONAL_SEARCH).sort((a,b)=>b.length-a.length).find(key=>q.includes(key));
    let remoteRows:any[]=[];
    if(supabase&&query.length>=2){
      // Always query Kakao as well as the local DB: a partial DB hit must not
      // suppress a nationwide exact-place search.
      try{
        const [dbRows,kakaoRows]=await Promise.all([
          searchStudiosByName(query).catch(error=>{console.warn("Database studio search failed:",error);return [] as any[];}),
          searchStudiosByKakao(query).catch(error=>{console.warn("Kakao studio search failed:",error);return [] as any[];})
        ]);
        const byId=new Map<string,any>();
        [...dbRows,...kakaoRows].forEach(row=>{if(row?.id)byId.set(String(row.id),row);});
        remoteRows=[...byId.values()];
      }catch(error){
        if(requestId!==searchSubmitRequestId.current)return;
        console.warn("Nationwide studio search failed:",error);
        try{remoteRows=await searchStudiosByName(query);}catch{}
      }
      if(requestId!==searchSubmitRequestId.current)return;
    }
    const mapped:Studio[]=remoteRows.map(mapStudioRecord);
    setGlobalSearchStudios(mapped);
    let matchingClassIds=classSearchIds;
    if(!mapped.length&&supabase&&query.length>=2){try{matchingClassIds=await searchStudioIdsByClassName(query);if(requestId!==searchSubmitRequestId.current)return;setClassSearchIds(matchingClassIds);}catch{}}
    if(requestId!==searchSubmitRequestId.current)return;
    const matching=[...new Map([...mapped,...studios.filter(studio=>studio.name.toLowerCase().includes(q)||String(studio.address||"").toLowerCase().includes(q)||studio.area.toLowerCase().includes(q))].filter(studio=>!isExcludedStudioSearchResult(studio.name)).map(studio=>[studio.id,studio])).values()];
    if(matching.length){
      setAreaLocked(false);
      const ordered=matching.sort((a,b)=>a.name.localeCompare(b.name,"ko")||String(a.address||a.area).localeCompare(String(b.address||b.area),"ko"));
      if(ordered.length>1){
        setSearchMatches(ordered);
        setGlobalSearchStudios(ordered);
        setSearchResultsOpen(true);
        setSelected(null);
        setSearchSubmitting(false);
        return;
      }
      const target=ordered[0];
      const next={latitude:target.lat,longitude:target.lng,latitudeDelta:0.018,longitudeDelta:0.018};
      setPendingMapTarget(next);setRegion(next);setSearchedRegion(next);setAreaLocked(false);setMapMoved(false);setSelected(target);setView("map");
      setSearchMatches([target]);
      setSearchSubmitting(false);
      return;
    }
    if(regionKey){
      const point=REGIONAL_SEARCH[regionKey];
      const next={latitude:point.latitude,longitude:point.longitude,latitudeDelta:0.035,longitudeDelta:0.035};
      setPendingMapTarget(next);setRegion(next);setSearchedRegion(next);setAreaLocked(true);setMapMoved(false);setSelected(null);setGlobalSearchStudios([]);setSearchMatches([]);setView("map");setSearchSubmitting(false);
      return;
    }
    try{
      let geocoded:Location.LocationGeocodedLocation[]=[];
      const candidates=[query+" 대한민국",query+" 아파트 대한민국",query+"역 대한민국",query+" 사거리 대한민국",query+" 서울시 대한민국",query+" 경기도 대한민국",query+" 서울 대한민국",query+" 강북구 서울 대한민국"];
      for(const candidate of candidates){try{geocoded=await Location.geocodeAsync(candidate);if(requestId!==searchSubmitRequestId.current)return;if(geocoded.length)break;}catch{}}
      if(requestId!==searchSubmitRequestId.current)return;
      if(geocoded.length){
        const next={latitude:geocoded[0].latitude,longitude:geocoded[0].longitude,latitudeDelta:0.035,longitudeDelta:0.035};
        setPendingMapTarget(next);setRegion(next);setSearchedRegion(next);setAreaLocked(true);setMapMoved(false);setSelected(null);setGlobalSearchStudios([]);setSearchMatches([]);setView("map");setSearchSubmitting(false);
        return;
      }
      Alert.alert("검색 결과 없음","입력한 학원명·역명·아파트명을 지도 위치 검색으로 찾지 못했습니다. 역명은 '미아사거리역'처럼, 아파트는 구·동을 함께 입력하면 정확도가 높아집니다.");
    }catch(error){if(requestId===searchSubmitRequestId.current){console.warn("Search location geocoding failed:",error);Alert.alert("지역 검색","지역 위치를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");}}
    finally{if(requestId===searchSubmitRequestId.current)setSearchSubmitting(false);}
  };
  const locate=async()=>{
    setLocationLoading(true);
    try {
      const {status}=await Location.requestForegroundPermissionsAsync();
      if(status!=="granted"){setLocationGranted(false);Alert.alert("위치 권한","권한이 없어 기본 지역에서 지도를 표시합니다. 설정에서 위치 권한을 허용할 수 있어요.");return;}
      const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const r={latitude:p.coords.latitude,longitude:p.coords.longitude,latitudeDelta:0.035,longitudeDelta:0.035};
      setPendingMapTarget(r);setRegion(r);setSearchedRegion(r);setAreaLocked(false);setLocationGranted(true);setCurrentLocation({latitude:p.coords.latitude,longitude:p.coords.longitude});setMapMoved(false);
    } catch { Alert.alert("위치 확인 실패","현재 위치를 가져오지 못했습니다. 지도를 직접 이동해 이용해주세요."); }
    finally {setLocationLoading(false);}
  };
  // Location permissions and GPS are requested only after the user taps the location button.
  useEffect(()=>{Promise.all([AsyncStorage.getItem("balletmate.favorites.v1"),AsyncStorage.getItem("balletmate.favoriteStudios.v1")]).then(([ids,legacyCache])=>{let savedIds:string[]=[];let legacyStudios:Studio[]=[];if(ids){const parsed=JSON.parse(ids);if(Array.isArray(parsed))savedIds=[...new Set(parsed.filter(x=>typeof x==="string"))];}if(legacyCache){const parsed=JSON.parse(legacyCache);if(Array.isArray(parsed))legacyStudios=parsed.filter((x:any)=>x&&typeof x.id==="string");}guestFavoritesRef.current={ids:savedIds,studios:legacyStudios.filter(studio=>savedIds.includes(studio.id))};setFavoriteIds(savedIds);setFavoriteStudios(guestFavoritesRef.current.studios);}).catch(()=>{}).finally(()=>setFavoritesReady(true));},[]);
  useEffect(()=>{if(favoritesReady){AsyncStorage.setItem("balletmate.favorites.v1",JSON.stringify(favoriteIds)).catch(()=>{});AsyncStorage.removeItem("balletmate.favoriteStudios.v1").catch(()=>{});}},[favoriteIds,favoriteStudios,favoritesReady]);
  useEffect(()=>{
    AsyncStorage.getItem("balletmate.compare.v1").then(raw=>{
      if(!raw)return;
      const parsed=JSON.parse(raw);
      if(!parsed||!Array.isArray(parsed.ids)||!Array.isArray(parsed.studios))return;
      const studios:Studio[]=parsed.studios.filter((x:any)=>x&&typeof x.id==="string");
      const validIds: string[]=[...new Set<string>((parsed.ids as unknown[]).filter((id): id is string=>typeof id==="string"))].slice(0,3);
      const available=new Set(studios.map(x=>x.id));
      setCompareIds(validIds.filter(id=>available.has(id)));
      setCompareCache(studios.filter(x=>validIds.includes(x.id)));
    }).catch(()=>{}).finally(()=>setCompareReady(true));
  },[]);
  useEffect(()=>{
    if(compareReady){
      AsyncStorage.setItem("balletmate.compare.v1",JSON.stringify({ids:compareIds,studios:compareCache})).catch(()=>{});
    }
  },[compareIds,compareCache,compareReady]);
  const favoriteSyncUser=useRef<string|null>(null);
  useEffect(()=>{if(!favoritesReady||!directoryStudios.length)return;setFavoriteStudios(current=>{const byId=new Map([...current,...directoryStudios].map(studio=>[studio.id,studio]));const next=favoriteIds.map(id=>byId.get(id)).filter((studio):studio is Studio=>!!studio);if(!favoriteSyncUser.current)guestFavoritesRef.current={ids:favoriteIds,studios:next};return next;});},[directoryStudios,favoriteIds,favoritesReady]);
  useEffect(()=>{
    const client=supabase;
    if(!client||!favoritesReady)return;
    let active=true;
    const syncForSession=async(session:any)=>{
      const uid=session?.user?.id||null;
      if(!uid){
        favoriteSyncUser.current=null;
        setFavoriteIds(guestFavoritesRef.current.ids);
        setFavoriteStudios(guestFavoritesRef.current.studios);
        return;
      }
      if(favoriteSyncUser.current===uid)return;
      favoriteSyncUser.current=uid;
      try{
        const {data:remote,error}=await client.from("user_favorites").select("studio_id,studio_snapshot").eq("user_id",uid);
        if(error)throw error;
        if(!active)return;
        const remoteRows=remote||[];
        const remoteStudios=remoteRows.map((r:any)=>r.studio_snapshot).filter((s:any)=>s&&typeof s.id==="string");
        const remoteIds=[...new Set(remoteRows.map((r:any)=>r.studio_id).filter((id:any)=>typeof id==="string"))];
        const remoteIdSet=new Set(remoteIds);
        const localStudios=guestFavoritesRef.current.studios;
        const mergedIds=[...new Set([...remoteIds,...guestFavoritesRef.current.ids])];
        const mergedStudios=[...remoteStudios,...localStudios.filter((studio:any)=>!remoteIdSet.has(studio.id))];
        setFavoriteStudios(mergedStudios);
        setFavoriteIds(mergedIds);
        const localRows=localStudios.filter((studio:any)=>!remoteIdSet.has(studio.id)).map((studio:any)=>({
          user_id:uid,studio_id:studio.id,studio_snapshot:studio,updated_at:new Date().toISOString(),
        }));
        if(localRows.length){
          const {error:mergeError}=await client.from("user_favorites").upsert(localRows,{onConflict:"user_id,studio_id"});
          if(mergeError)console.warn("Guest favorite merge skipped:",mergeError);
        }
      }catch(e){
        favoriteSyncUser.current=null;
        console.warn("Favorite sync skipped:",e);
      }
    };
    client.auth.getSession().then(({data})=>syncForSession(data.session));
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{syncForSession(session);});
    return()=>{active=false;subscription.unsubscribe();};
  },[favoritesReady]);

  useEffect(()=>{if(!supabaseConfigured)return;let mounted=true;setBackendState("loading");fetchStudios(searchedRegion).then(rows=>{if(!mounted)return;const mapped:Studio[]=rows.map(mapStudioRecord);setStudios(mapped);setBackendState(mapped.length?"connected":"empty");}).catch(()=>{if(mounted){setStudios([]);setBackendState("error");}});return()=>{mounted=false;};},[searchedRegion]);
  const searchArea=async()=>{
    const requestId=++areaSearchRequestId.current;
    const target=region;
    const queryAtStart=search.trim();
    setSearchedRegion(target);setAreaLocked(true);setMapMoved(false);setSelected(null);
    setSearchSubmitting(true);
    setClassSearchIds([]);setClassSearchLoading(false);
    try{
      // A viewport search must query Kakao Local around the map center as well as
      // the studios already stored in Supabase; a DB-only bounds read misses new places.
      const term=queryAtStart.length>=2?queryAtStart:"발레";
      const rows=await searchStudiosByKakao(term,target);
      if(requestId!==areaSearchRequestId.current)return;
      const mapped:Studio[]=rows.map(mapStudioRecord);
      setGlobalSearchStudios(mapped);
      if(mapped.length)setBackendState("connected");
      else if(!studios.length)setBackendState("empty");
      if(!mapped.length)Alert.alert("검색 결과 없음","현재 지도 범위에서 검색어와 일치하는 발레 학원을 찾지 못했습니다. 지도를 조금 이동하거나 검색어를 바꿔 주세요.");
    }catch(error:any){
      if(requestId===areaSearchRequestId.current){
        console.warn("Viewport Kakao search failed:",error);
        Alert.alert("지도 검색 실패",error?.message||"현재 지역의 학원 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }finally{
      if(requestId===areaSearchRequestId.current)setSearchSubmitting(false);
    }
  };
  useEffect(()=>{
    if(view!=="map"||!pendingMapTarget)return;
    let cancelled=false;
    let attempts=0;
    let timer:ReturnType<typeof setTimeout>;
    const moveMap=()=>{
      if(cancelled)return;
      if(map.current){map.current.animateToRegion(pendingMapTarget,650);setPendingMapTarget(null);return;}
      attempts+=1;
      if(attempts<6)timer=setTimeout(moveMap,180);
      else setPendingMapTarget(null);
    };
    timer=setTimeout(moveMap,220);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[view,pendingMapTarget]);
  const isAreaChanged=Math.abs(region.latitude-searchedRegion.latitude)>Math.max(0.004,searchedRegion.latitudeDelta*0.12)||Math.abs(region.longitude-searchedRegion.longitude)>Math.max(0.004,searchedRegion.longitudeDelta*0.12)||Math.abs(region.latitudeDelta-searchedRegion.latitudeDelta)>searchedRegion.latitudeDelta*0.18||Math.abs(region.longitudeDelta-searchedRegion.longitudeDelta)>searchedRegion.longitudeDelta*0.18;
  const activeFilters=(adult?1:0)+(kids?1:0)+(coupon?1:0)+(level?1:0)+(dayFilter?1:0)+(timeFilter?1:0)+(maxPrice!==null?1:0)+(durationFilter!==null?1:0)+(classTypeFilter?1:0)+(maxDistance!==null?1:0);
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
    const nextIds=removing?favoriteIds.filter(i=>i!==studio.id):[...favoriteIds,studio.id];
    const nextStudios=removing?favoriteStudios.filter(x=>x.id!==studio.id):[studio,...favoriteStudios.filter(x=>x.id!==studio.id)];
    setFavoriteIds(nextIds);
    setFavoriteStudios(nextStudios);
    if(!favoriteSyncUser.current)guestFavoritesRef.current={ids:nextIds,studios:nextStudios};
    const client=supabase;
    if(client) client.auth.getSession().then(({data})=>{
      const uid=data.session?.user.id;if(!uid)return;
      if(removing) client.from("user_favorites").delete().eq("user_id",uid).eq("studio_id",studio.id).then(({error})=>{if(error)console.warn("Favorite delete sync failed",error);});
      else client.from("user_favorites").upsert({user_id:uid,studio_id:studio.id,studio_snapshot:studio,updated_at:new Date().toISOString()},{onConflict:"user_id,studio_id"}).then(({error})=>{if(error)console.warn("Favorite save sync failed",error);});
    });
  };
  const resetFilters=()=>{setAdult(false);setKids(false);setCoupon(false);setNeisOnlyFilter(false);setLevel(null);setDayFilter(null);setTimeFilter(null);setMaxPrice(null);setDurationFilter(null);setClassTypeFilter(null);setMaxDistance(null);};
  const resetListFilters=()=>{areaSearchRequestId.current++;searchSubmitRequestId.current++;setSearchSubmitting(false);resetFilters();setRegionProvince("전체");setRegionCity("전체");setSelectedListRegion("전체");setSearch("");setGlobalSearchStudios([]);setSearchMatches([]);setAreaLocked(false);Keyboard.dismiss();};
  const openDirections=async(studio:Studio,provider:"google"|"kakao")=>{
    const destination=studio.address||studio.name;
    const url=provider==="google"
      ? "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination)+"&travelmode=driving"
      : "kakaomap://route?ep="+studio.lng+","+studio.lat+"&by=CAR";
    try{await Linking.openURL(url);}
    catch{
      const fallback=provider==="kakao"
        ? "https://map.kakao.com/link/to/"+encodeURIComponent(studio.name)+","+studio.lat+","+studio.lng
        : "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(destination);
      Linking.openURL(fallback).catch(()=>Alert.alert("길찾기 연결","선택한 지도 앱 또는 웹 지도를 열 수 없습니다."));
    }
  };
  const selectMapProvider=async(provider:"google"|"kakao")=>{
    setMapProvider(provider);
    await AsyncStorage.setItem("balletmate.mapProvider.v1",provider).catch(()=>{});
    setMapSettingsOpen(false);
    const pending=pendingDirectionsStudio;
    setPendingDirectionsStudio(null);
    if(pending)openDirections(pending,provider);
  };
  const requestDirections=(studio:Studio)=>{
    if(mapProvider){openDirections(studio,mapProvider);return;}
    setPendingDirectionsStudio(studio);
    setMapSettingsOpen(true);
  };

  const retryDetailRequest=async<T,>(task:()=>Promise<T>,attempts=2):Promise<T>=>{
    let lastError:any=null;
    for(let attempt=0;attempt<attempts;attempt++){
      try{return await task();}
      catch(error:any){lastError=error;if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,650*(attempt+1)));}
    }
    throw lastError;
  };
  const retryCanonicalDetail=async(studioId:string,requestId:number)=>{
    if(!supabaseConfigured)return;
    setDetailCanonicalLoading(true);
    setDetailCanonicalError(null);
    try{
      const row=await fetchStudioById(studioId);
      if(requestId!==detailRequestId.current)return;
      if(row)setDetailStudio(mapStudioRecord(row));
      else setDetailCanonicalError("학원 정보를 찾지 못했습니다. 다시 시도해 주세요.");
    }catch(error:any){
      if(requestId===detailRequestId.current){
        setDetailCanonicalError(error?.message||"학원 정보를 불러오지 못했습니다.");
        console.warn("Canonical studio detail retry failed:",error);
      }
    }finally{
      if(requestId===detailRequestId.current)setDetailCanonicalLoading(false);
    }
  };
  const openDetail=async(s:Studio)=>{
    if(supabase)supabase.rpc("record_studio_detail_view",{p_studio_id:s.id}).then(({error})=>{if(error)console.warn("Studio view metric unavailable:",error.message);});
    const requestId=++detailRequestId.current;
    setDetailTab("home");
    setDetailInfoTab("price");
    setDetailExpanded(false);
    detailDragY.setValue(0);
    setDetailStudio(s);
    setDetailContentError(null);
    setDetailCanonicalError(null);
    setDetailCanonicalLoading(!!supabaseConfigured);
    setStudioClasses([]);
    setStudioBlogPosts([]);
    setBlogLoading(false);
    setStudioPublicPrices([]);
    setStudioPublicSchedules([]);
    setStudioOwnerNotices([]);
    setStudioCoupons([]);
    if(supabaseConfigured){
      setClassesLoading(true);
      (async()=>{
        let lastError:any=null;
        for(let attempt=0;attempt<1;attempt++){
          try{
            const row=await fetchStudioById(s.id);
            if(requestId!==detailRequestId.current)return;
            if(row){setDetailStudio(mapStudioRecord(row));setDetailCanonicalError(null);}
            else setDetailCanonicalError("학원 정보를 찾지 못했습니다. 다시 시도해 주세요.");
            return;
          }catch(error:any){
            lastError=error;
            if(attempt<2)await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
          }
        }
        if(requestId===detailRequestId.current){
          setDetailCanonicalError(lastError?.message||"학원 정보를 불러오지 못했습니다.");
          console.warn("Canonical studio detail lookup failed:",lastError);
        }
      })().finally(()=>{if(requestId===detailRequestId.current)setDetailCanonicalLoading(false);});
      retryDetailRequest(()=>fetchClassesForStudio(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioClasses(rows);})
        .catch(error=>{console.warn("Studio classes unavailable:",error);if(requestId===detailRequestId.current)setStudioClasses([]);})
        .finally(()=>{if(requestId===detailRequestId.current)setClassesLoading(false);});
      retryDetailRequest(()=>fetchStudioPublicPrices(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioPublicPrices(rows);})
        .catch(error=>{console.warn("Approved studio prices unavailable:",error);if(requestId===detailRequestId.current){setStudioPublicPrices([]);setDetailContentError("가격표 자료를 불러오지 못했습니다.");}});
      retryDetailRequest(()=>fetchStudioPublicSchedules(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioPublicSchedules(rows);})
        .catch(error=>{console.warn("Approved studio schedules unavailable:",error);if(requestId===detailRequestId.current){setStudioPublicSchedules([]);setDetailContentError("시간표 자료를 불러오지 못했습니다.");}});
      retryDetailRequest(()=>fetchCouponsForStudio(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioCoupons(rows);})
        .catch(error=>{console.warn("Studio coupons unavailable:",error);if(requestId===detailRequestId.current)setStudioCoupons([]);});
    }
  };
  const detailPhotoItems = detailStudio ? [...new Set((detailStudio.imageUrls||[]).filter(uri=>uri.toLowerCase().startsWith("https://")))].slice(0,30).map((uri,index)=>({uri,key:"registered-"+index,url:null,label:"학원 등록 사진"})) : [];
  const representativeStudioImage = detailPhotoItems[0] || null;
  const evidencePhotosForSource=(storedImages:string[]|null|undefined)=>{
    // Only load optimized, explicitly attached material images. Do not pull full-size
    // third-party blog originals into the detail screen or its memory cache.
    return [...new Set((storedImages||[]).filter(url=>/^https:\/\//i.test(url)))].slice(0,8);
  };
  const cleanScheduleDisplay=(value:string)=>{
    return String(value||"").replace(/\\s*(오픈\\s*예정|개강\\s*예정|모집\\s*예정|모집\\s*중|신설\\s*예정)\\s*$/g,"").trim();
  };
    const evidencePhotoGallery=(key:string,storedImages:string[]|null|undefined)=>{
     const photos=evidencePhotosForSource(storedImages);
    if(!photos.length)return null;
    const index=Math.min(evidencePhotoIndexes[key]||0,photos.length-1);
    return <View style={{marginTop:12,padding:10,borderRadius:12,borderWidth:1,borderColor:"#E5DFF3",backgroundColor:"#FBFAFE"}}>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <Text style={{fontSize:13,fontWeight:"800",color:"#40365D"}}>자료 사진</Text>
        <Text style={styles.photoCredit}>{index+1} / {photos.length}장</Text>
      </View>
      <View style={{height:250,borderRadius:9,overflow:"hidden",backgroundColor:"#F0EDF6",justifyContent:"center",alignItems:"center"}}>
        {failedStudioImageUrls.includes(photos[index])?<Text style={styles.filterHint}>이미지를 불러올 수 없습니다.</Text>:<Image source={{uri:photos[index]}} style={{width:"100%",height:"100%"}} resizeMode="contain" onError={()=>setFailedStudioImageUrls(current=>current.includes(photos[index])?current:[...current,photos[index]])}/>}
      </View>
      {photos.length>0&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingTop:9}}>
        {photos.map((url,i)=><Pressable key={url} onPress={()=>setEvidencePhotoIndexes(current=>({...current,[key]:i}))} style={{width:72,height:72,borderRadius:8,overflow:"hidden",borderWidth:i===index?2:1,borderColor:i===index?COLORS.purple:"#DCD6E8",backgroundColor:"#F0EDF6"}}>
          {failedStudioImageUrls.includes(url)?<View style={{flex:1,alignItems:"center",justifyContent:"center"}}><Text style={{fontSize:9,color:COLORS.muted}}>오류</Text></View>:<Image source={{uri:url}} style={{width:"100%",height:"100%"}} resizeMode="cover" onError={()=>setFailedStudioImageUrls(current=>current.includes(url)?current:[...current,url])}/>}
        </Pressable>)}
      </ScrollView>}
      {photos.length>1&&<View style={{flexDirection:"row",justifyContent:"space-between",marginTop:8}}>
        <Pressable onPress={()=>setEvidencePhotoIndexes(current=>({...current,[key]:(index+photos.length-1)%photos.length}))} style={{paddingHorizontal:12,paddingVertical:7,borderRadius:16,backgroundColor:"#EEEAFB"}}><Text style={{fontSize:12,color:COLORS.purple,fontWeight:"800"}}>‹ 이전 사진</Text></Pressable>
        <Pressable onPress={()=>setEvidencePhotoIndexes(current=>({...current,[key]:(index+1)%photos.length}))} style={{paddingHorizontal:12,paddingVertical:7,borderRadius:16,backgroundColor:"#EEEAFB"}}><Text style={{fontSize:12,color:COLORS.purple,fontWeight:"800"}}>다음 사진 ›</Text></Pressable>
      </View>}
    </View>;
  };
  const handleStudioImageError=useCallback((failed:string)=>{setFailedStudioImageUrls(current=>current.includes(failed)?current:[...current,failed]);},[]);
  const studioCard=(s:Studio,compact=false)=><Pressable key={s.id} onPress={()=>{setSelected(s);setView("map");const target={latitude:s.lat,longitude:s.lng,latitudeDelta:0.018,longitudeDelta:0.018};setPendingMapTarget(target);setRegion(target);if(!studios.some(x=>x.id===s.id)){setSearchedRegion(target);setAreaLocked(false);}}} style={[styles.studioCard,compact&&styles.compactCard]}>
    <View style={styles.cardTop}><View style={styles.studioIcon}>{(s.imageUrls||[]).find(url=>!failedStudioImageUrls.includes(url))?<Image source={{uri:(s.imageUrls||[]).find(url=>!failedStudioImageUrls.includes(url))!}} onError={()=>{const failed=(s.imageUrls||[]).find(url=>!failedStudioImageUrls.includes(url));if(failed)handleStudioImageError(failed);}} style={styles.studioThumb} resizeMode="cover"/>:<MaterialCommunityIcons name="human-female-dance" size={28} color={COLORS.purple}/>}</View><View style={{flex:1}}><Text style={styles.studioName}>{s.name}</Text><Text style={styles.studioArea}>{s.area} · {s.rating>0?"⭐ "+s.rating.toFixed(1):"평점 미등록"}</Text></View>{s.coupon&&<View style={styles.couponBadge}><Text style={styles.couponText}>쿠폰</Text></View>}</View>
    <View style={styles.tagsRow}>{s.tags.map(t=><View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}</View>
    <View style={styles.cardBottom}><Text style={styles.priceText}>{s.price!==null?"₩"+s.price.toLocaleString():"가격 문의"}<Text style={styles.priceUnit}> / 회</Text></Text><Text style={styles.metaText}>{[s.duration>0?s.duration+"분":null,s.time||null].filter(Boolean).join(" · ")||"수업 정보 미등록"}</Text></View><View style={styles.cardActions}><Pressable onPress={e=>{e.stopPropagation();toggleFavorite(s);}} style={styles.actionChip}><Text style={styles.actionText}>{favoriteIds.includes(s.id)?"♥ 찜됨":"♡ 찜"}</Text></Pressable><Pressable onPress={e=>{e.stopPropagation();toggleCompare(s);}} style={styles.actionChip}><Text style={styles.actionText}>{compareIds.includes(s.id)?"✓ 비교중":"+ 비교"}</Text></Pressable><Pressable onPress={e=>{e.stopPropagation();openDetail(s);}} style={styles.actionChip}><Text style={styles.actionText}>상세정보</Text></Pressable></View>
  </Pressable>;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}>
    <View style={styles.header}>
      <Text style={styles.brand}>balletmate <Text style={styles.brandDot}>✦</Text></Text>
      <View style={styles.headerActions}><Pressable style={styles.menuButton} onPress={()=>setMenuOpen(true)} accessibilityLabel="메뉴 열기"><Ionicons name="menu-outline" size={23} color={COLORS.ink} /></Pressable><Pressable style={styles.profileButton} onPress={()=>router.push("/account")} accessibilityLabel="마이페이지"><Ionicons name="person-circle-outline" size={23} color={COLORS.ink} /></Pressable></View>
    </View>
    <View style={styles.searchRow}>
      <View style={styles.searchBox}><Ionicons name="search-outline" size={19} color={COLORS.muted} /><TextInput value={search} onChangeText={value=>{areaSearchRequestId.current++;searchSubmitRequestId.current++;setSearchSubmitting(false);setSearch(value);setGlobalSearchStudios([]);setSearchMatches([]);}} placeholder="학원명, 지역, 수업명 검색" placeholderTextColor="#A5A1B0" style={styles.searchInput} maxFontSizeMultiplier={1.15} returnKeyType="search" onSubmitEditing={submitSearch}/>{!!search&&<Pressable onPress={()=>{areaSearchRequestId.current++;searchSubmitRequestId.current++;setSearchSubmitting(false);setSearch("");setGlobalSearchStudios([]);setSearchMatches([]);Keyboard.dismiss();}}><Text style={styles.clear}>×</Text></Pressable>}</View><Pressable style={[styles.searchSubmitButton,searchSubmitting&&{opacity:0.6}]} onPress={submitSearch} disabled={searchSubmitting}><Ionicons name={searchSubmitting?"hourglass-outline":"search"} size={19} color="#fff"/></Pressable>
      <Pressable style={styles.filterButton} onPress={()=>setFilterOpen(true)}><Ionicons name="options-outline" size={21} color={COLORS.ink} />{activeFilters>0&&<View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilters}</Text></View>}</Pressable>
    </View>
    {!!search.trim()&&search.trim().length>=2&&<Text style={styles.searchHint}>{classSearchLoading?"수업명 검색 중…":"학원명·지역·태그·등록 수업명 검색"}</Text>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,flexShrink:0}} contentContainerStyle={[styles.quickFilters,{alignItems:"center"}]}><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/><Chip label="쿠폰" active={coupon} onPress={()=>setCoupon(!coupon)}/><Chip label="초급" active={level==="초급"} onPress={()=>setLevel(level==="초급"?null:"초급")}/><Chip label="전체" onPress={resetFilters}/></ScrollView>
    <View style={styles.content}>
      {view==="map"?<View style={styles.mapWrap}>
        <KakaoMap ref={map} initialRegion={region} markers={mapMarkers} selectedId={selected?.id??null} currentLocation={locationGranted?currentLocation:null} onRegionChangeComplete={handleMapRegionChange} onMarkerPress={handleMapMarkerPress} />
        {mapMoved&&isAreaChanged&&<Pressable style={styles.areaSearch} disabled={backendState==="loading"||searchSubmitting} onPress={searchArea}><View style={{flexDirection:"row",alignItems:"center",gap:6}}><Ionicons name="search-outline" size={15} color={COLORS.ink}/><Text style={styles.areaSearchText}>{searchSubmitting?"검색 중…":"이 지역에서 재검색"}</Text></View></Pressable>}
        <Pressable style={styles.locateButton} onPress={locate}><Ionicons name={locationLoading?"sync-outline":"locate-outline"} size={22} color={COLORS.purple} /></Pressable>
        <Pressable style={styles.mapCount} onPress={()=>{if(searchMatches.length>1){setSearchResultsOpen(true);}else if(results.length>1&&search.trim()){setSearchMatches(results);setSearchResultsOpen(true);}}}><Text style={styles.mapCountText}>{search.trim()&&globalSearchStudios.length?"검색 결과 ":"주변 학원 "}<Text style={{color:COLORS.purple,fontWeight:"800"}}>{search.trim()&&globalSearchStudios.length?globalSearchStudios.length:results.length}</Text>곳{searchMatches.length>1?" · 목록 보기":backendState==="loading"?" · 불러오는 중":backendState==="mock"?" · 데모":backendState==="error"?" · 연결 오류":backendState==="empty"?" · 등록된 학원 없음":""}</Text></Pressable>
        {selected&&<View style={styles.selectedCard}>{studioCard(selected,true)}<Pressable style={styles.detailBtn} onPress={()=>openDetail(selected)}><Text style={styles.detailBtnText}>상세 보기  ›</Text></Pressable><Pressable style={styles.dismiss} onPress={()=>setSelected(null)}><Text style={styles.dismissText}>×</Text></Pressable></View>}
      </View> :<><View style={styles.listSortRow}><Text style={styles.listSortLabel}>{view==="favorites"?"찜한 학원":"학원 목록"} · {listRows.length}곳</Text><Pressable onPress={()=>setListSort("distance")} style={[styles.listSortChip,listSort==="distance"&&styles.listSortChipActive]}><Text style={[styles.listSortChipText,listSort==="distance"&&styles.listSortChipTextActive]}>거리순</Text></Pressable><Pressable onPress={()=>setListSort("price")} style={[styles.listSortChip,listSort==="price"&&styles.listSortChipActive]}><Text style={[styles.listSortChipText,listSort==="price"&&styles.listSortChipTextActive]}>가격 낮은순</Text></Pressable></View>{view==="list"&&<View style={{paddingHorizontal:12,paddingBottom:9}}>
  <Text style={{fontSize:11,fontWeight:"800",color:COLORS.muted,marginBottom:6}}>지역 선택</Text>
  <View style={{flexDirection:"row",alignItems:"center",gap:7}}><Pressable onPress={()=>setRegionPickerOpen(true)} style={{flex:1,paddingHorizontal:12,paddingVertical:10,borderRadius:10,borderWidth:1,borderColor:COLORS.line,backgroundColor:COLORS.white,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text numberOfLines={1} style={{flex:1,fontSize:12,fontWeight:"800",color:COLORS.ink}}>{selectedListRegion!=="전체"?selectedListRegion:[regionProvince,regionCity].filter(x=>x!=="전체").join(" · ")||"전체 지역"}</Text><Text style={{color:COLORS.purple,fontWeight:"900"}}>변경⌄</Text></Pressable>{(selectedListRegion!=="전체"||regionCity!=="전체"||regionProvince!=="전체")&&<Pressable onPress={()=>{setSelectedListRegion("전체");setRegionCity("전체");setRegionProvince("전체");}} style={{paddingHorizontal:10,paddingVertical:10,borderRadius:10,backgroundColor:"#F2F0F6"}}><Text style={{fontSize:11,fontWeight:"800",color:COLORS.ink}}>전체</Text></Pressable>}</View>
  <View style={{flexDirection:"row",gap:7,marginTop:10}}>
    {([{key:"views",label:"많이 본 학원"},{key:"favorites",label:"즐겨찾기"}] as const).map(opt=><Pressable key={opt.key} onPress={()=>setRankMode(opt.key)} style={{flex:1,paddingVertical:9,borderRadius:10,backgroundColor:rankMode===opt.key?COLORS.purple:"#F2F0F6",alignItems:"center"}}><Text style={{fontSize:11,fontWeight:"900",color:rankMode===opt.key?"#fff":COLORS.ink}}>{opt.label}</Text></Pressable>)}
  </View>
  <View style={{marginTop:10,backgroundColor:rankMode==="views"?"#F7F4FF":"#F8F7FA",borderRadius:12,padding:12}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{fontSize:13,fontWeight:"900",color:rankMode==="views"?COLORS.purple:COLORS.ink}}>{rankMode==="views"?"많이 본 학원":"즐겨찾기 많은 학원"}</Text>{rankMode==="views"&&<Text style={{fontSize:10,fontWeight:"700",color:COLORS.muted,backgroundColor:"#fff",paddingHorizontal:8,paddingVertical:4,borderRadius:8}}>최근 7일</Text>}</View>
    {rankLoading?<Text style={styles.photoCredit}>순위를 불러오는 중…</Text>:rankItems.length>0?rankItems.slice(0,5).map((r:any,i)=><Pressable key={r.studio_id} onPress={async()=>{try{const item=studios.find(studio=>studio.id===r.studio_id)||await fetchStudioById(r.studio_id).then(row=>row?mapStudioRecord(row):null);if(item)setSelectedRankStudio(item);else Alert.alert("학원 정보","학원 위치 정보를 불러오지 못했습니다.");}catch{Alert.alert("학원 정보","학원 정보를 불러오지 못했습니다.");}}} style={{marginTop:7,paddingVertical:9,paddingHorizontal:9,borderRadius:10,backgroundColor:"#fff",borderWidth:1,borderColor:selectedRankStudio?.id===r.studio_id?COLORS.purple:"#EAE5F1",flexDirection:"row",alignItems:"center",gap:8}}>
      <View style={{width:27,height:27,borderRadius:9,backgroundColor:i<3?"#F0E8FF":"#F4F2F7",alignItems:"center",justifyContent:"center"}}><Text style={{fontSize:12,fontWeight:"900",color:i<3?COLORS.purple:COLORS.muted}}>{i+1}</Text></View>
      <View style={{flex:1,minWidth:0}}><Text numberOfLines={2} ellipsizeMode="tail" style={{fontSize:12,fontWeight:"800",color:COLORS.ink,lineHeight:17}}>{r.studio_name}</Text></View>
      <Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple,flexShrink:0}}>{rankMode==="views"?r.view_count+"회":r.favorite_count+"명"}</Text>
      <Ionicons name="chevron-forward" size={15} color={COLORS.muted}/>
    </Pressable>):<Text style={styles.photoCredit}>{rankMode==="views"?"10회 이하 조회는 데이터가 쌓이면 표시됩니다.":"즐겨찾기가 쌓이면 표시됩니다."}</Text>}
    {selectedRankStudio&&<Pressable onPress={()=>{const item=selectedRankStudio;const next={latitude:item.lat,longitude:item.lng,latitudeDelta:0.009,longitudeDelta:0.009};setGlobalSearchStudios([]);setSelected(item);setAreaLocked(false);setMapMoved(false);setSearchedRegion(next);setRegion(next);setPendingMapTarget(next);setView("map");}} style={{marginTop:11,padding:11,borderRadius:12,backgroundColor:"#EEE7FF",borderWidth:1,borderColor:"#D6C5FF"}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:6,marginBottom:5}}><Ionicons name="location" size={15} color={COLORS.purple}/><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple}}>선택한 학원 · 지도에서 보기</Text></View>
      <Text numberOfLines={2} style={{fontSize:13,fontWeight:"900",color:COLORS.ink,lineHeight:18}}>{selectedRankStudio.name}</Text>
      <Text numberOfLines={2} style={{fontSize:10,color:COLORS.muted,marginTop:4}}>{selectedRankStudio.address||selectedRankStudio.area||"주소 정보 없음"}</Text>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"flex-end",marginTop:7}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple}}>지도에서 위치 확인  ›</Text></View>
    </Pressable>}
  </View>
</View>}<FlatList data={listRows} keyExtractor={i=>i.id} renderItem={({item})=>studioCard(item)} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" ListEmptyComponent={<View style={{alignItems:"center",paddingHorizontal:24,paddingVertical:30,gap:9}}><Ionicons name="search-outline" size={28} color={COLORS.muted}/><Text style={styles.empty}>{view==="favorites"?"찜한 학원이 아직 없어요.":"조건에 맞는 학원이 없어요."}</Text>{view==="list"&&<><Text style={{fontSize:11,color:COLORS.muted,textAlign:"center"}}>지역이나 수업 필터 때문에 결과가 없을 수 있어요.</Text><Pressable onPress={resetListFilters} style={{marginTop:4,paddingHorizontal:16,paddingVertical:9,borderRadius:10,backgroundColor:COLORS.pale}}><Text style={{fontSize:12,fontWeight:"900",color:COLORS.purple}}>지역·검색·필터 초기화</Text></Pressable></>}</View>}/></>}
    </View>
    {compareIds.length>=2&&<Pressable style={styles.compareFloating} onPress={()=>setCompareOpen(true)}><Text style={styles.compareFloatingText}>학원 비교하기 · {compareIds.length}</Text></Pressable>}
    <Modal visible={searchResultsOpen} transparent animationType="fade" onRequestClose={()=>setSearchResultsOpen(false)}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={()=>setSearchResultsOpen(false)} />
        <View style={[styles.modal,{maxHeight:"78%",paddingBottom:24}]}>
          <View style={styles.modalHead}>
            <View style={{flex:1,minWidth:0}}>
              <Text style={styles.modalTitle}>검색 결과 {searchMatches.length}곳</Text>
              <Text style={styles.searchResultSub}>학원명과 주소를 확인하고 지점을 선택해 주세요</Text>
            </View>
            <Pressable onPress={()=>setSearchResultsOpen(false)} style={styles.drawerClose}><Ionicons name="close" size={21} color={COLORS.muted}/></Pressable>
          </View>
          <FlatList data={searchMatches} keyExtractor={item=>item.id} style={{marginTop:12}} contentContainerStyle={{paddingBottom:8}} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled"
            renderItem={({item,index})=><Pressable style={styles.searchResultRow} onPress={()=>{
              // A selected search result should jump directly to that studio, not first to a broad area.
              const next={latitude:item.lat,longitude:item.lng,latitudeDelta:0.009,longitudeDelta:0.009};
              setGlobalSearchStudios(searchMatches);setSearchResultsOpen(false);setSelected(item);setAreaLocked(false);setMapMoved(false);setSearchedRegion(next);setRegion(next);setPendingMapTarget(next);setView("map");
            }}>
              <View style={styles.searchResultNumber}><Text style={styles.searchResultNumberText}>{index+1}</Text></View>
              <View style={{flex:1,minWidth:0}}>
                <Text style={styles.searchResultName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.searchResultAddress} numberOfLines={2}>{item.address||item.area||"주소 정보 없음"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.muted}/>
            </Pressable>}
          />
        </View>
      </View>
    </Modal>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={()=>setMenuOpen(false)}>
      <View style={styles.drawerShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={()=>setMenuOpen(false)} accessibilityLabel="메뉴 닫기"/>
        <View style={styles.drawerPanel}>
          <View style={styles.drawerHeader}><View><Text style={styles.drawerBrand}>balletmate ✦</Text><Text style={styles.drawerSubtitle}>발레 생활을 더 편리하게</Text></View><Pressable onPress={()=>setMenuOpen(false)} style={styles.drawerClose}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable></View>
          <Text style={styles.drawerSection}>탐색</Text>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("map");setMenuOpen(false);}}><Ionicons name="map-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>지도에서 찾기</Text>{view==="map"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("list");setMenuOpen(false);}}><Ionicons name="list-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>학원 목록</Text>{view==="list"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("favorites");setMenuOpen(false);}}><Ionicons name="heart-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>찜한 학원</Text>{view==="favorites"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);setCompareOpen(true);}}><Ionicons name="swap-horizontal" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>학원 비교</Text><Text style={styles.drawerCount}>{compareIds.length}/3</Text></Pressable>
          <View style={styles.drawerDivider}/>
          <Text style={styles.drawerSection}>커뮤니티 및 계정</Text>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/community");}}><Ionicons name="chatbubbles-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>발레 커뮤니티</Text></Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/account");}}><Ionicons name="person-circle-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>마이페이지 / 로그인</Text></Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);setPendingDirectionsStudio(null);setMapSettingsOpen(true);}}><Ionicons name="navigate-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>기본 길찾기 앱</Text><Text style={styles.drawerCount}>{mapProvider==="kakao"?"카카오맵":mapProvider==="google"?"구글 지도":"미설정"}</Text></Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/admin");}}><Ionicons name="settings-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>관리자</Text></Pressable>
          <View style={styles.drawerFooter}><Text style={styles.drawerFooterText}>Balletmate · 가까운 발레학원 찾기</Text></View>
        </View>
      </View>
    </Modal>
    <Modal visible={mapSettingsOpen} transparent animationType="fade" onRequestClose={()=>{setMapSettingsOpen(false);setPendingDirectionsStudio(null);}}>
      <View style={styles.modalShade}><View style={[styles.modal,{paddingBottom:28}]}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>기본 길찾기 앱</Text><Pressable onPress={()=>{setMapSettingsOpen(false);setPendingDirectionsStudio(null);}}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.filterHint}>선택한 지도 앱을 기본으로 저장합니다. 다음부터는 길찾기를 누르면 바로 이 앱으로 열립니다.</Text>
        <Pressable style={[styles.mapProviderOption,mapProvider==="google"&&styles.mapProviderSelected]} onPress={()=>selectMapProvider("google")}><Ionicons name="map-outline" size={22} color={COLORS.purple}/><View style={{flex:1}}><Text style={styles.mapProviderTitle}>Google 지도</Text><Text style={styles.mapProviderSub}>구글 지도에서 길찾기</Text></View><Text style={styles.mapProviderCheck}>{mapProvider==="google"?"기본":"선택"}</Text></Pressable>
        <Pressable style={[styles.mapProviderOption,mapProvider==="kakao"&&styles.mapProviderSelected]} onPress={()=>selectMapProvider("kakao")}><Ionicons name="navigate-outline" size={22} color={COLORS.purple}/><View style={{flex:1}}><Text style={styles.mapProviderTitle}>카카오맵</Text><Text style={styles.mapProviderSub}>카카오맵 앱 우선, 미설치 시 웹 지도</Text></View><Text style={styles.mapProviderCheck}>{mapProvider==="kakao"?"기본":"선택"}</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={compareOpen} animationType="slide" transparent onRequestClose={()=>setCompareOpen(false)}>
      <View style={styles.modalShade}><View style={styles.modal}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>학원 비교</Text><Pressable onPress={()=>setCompareOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.filterHint}>최대 3곳까지 비교할 수 있습니다. 카드의 비교 버튼으로 선택을 변경하세요.</Text>
        {compareIds.map(id=>{const s=studios.find(x=>x.id===id)||favoriteStudios.find(x=>x.id===id)||compareCache.find(x=>x.id===id);if(!s)return null;return <View key={id} style={styles.compareRow}><Text style={styles.compareName}>{s.name}</Text><Text style={styles.compareInfo}>{s.area} · {s.level.join("/")}</Text><Text style={styles.compareInfo}>{[s.days.join(" · "),s.time].filter(Boolean).join(" / ")||"요일·시간 미등록"}</Text><Text style={styles.compareInfo}>{s.duration>0?s.duration+"분":"수업 시간 미등록"} · {s.coupon?"쿠폰 있음":"쿠폰 없음"}</Text><Text style={styles.comparePrice}>{s.price!==null?"₩"+s.price.toLocaleString()+" / 회":"가격 미등록"}</Text><Text style={styles.compareInfo}>등록 수업 및 시간표</Text>{compareClassLoading?<ActivityIndicator color={COLORS.purple}/>:((compareClassData[id]||[]).length?(compareClassData[id]||[]).map(cls=><View key={cls.id} style={{marginTop:6}}><Text style={styles.compareInfo}>{cls.title} · {cls.duration_minutes||"-"}분 · {cls.price!=null?"₩"+cls.price.toLocaleString()+" / 회":"가격 문의"}</Text><Text style={styles.compareInfo}>{cls.class_sessions?.length?cls.class_sessions.map(session=>["일","월","화","수","목","금","토"][session.weekday]+" "+session.start_time.slice(0,5)+(session.end_time?"–"+session.end_time.slice(0,5):"")).join(" / "):"시간표 미등록"}</Text></View>):<Text style={styles.compareInfo}>세부 수업 시간표가 등록되지 않았습니다.</Text>)}<Pressable onPress={()=>{setCompareIds(ids=>ids.filter(x=>x!==id));setCompareCache(list=>list.filter(x=>x.id!==id));}}><Text style={styles.removeCompare}>비교 목록에서 제외</Text></Pressable></View>})}
        <Pressable style={styles.applyButton} onPress={()=>setCompareOpen(false)}><Text style={styles.applyText}>확인</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={regionPickerOpen} transparent animationType="fade" onRequestClose={()=>setRegionPickerOpen(false)}><View style={styles.modalShade}><View style={[styles.modal,{maxHeight:"82%",paddingHorizontal:12}]}><View style={styles.modalHead}><Text style={styles.modalTitle}>지역 선택</Text><Pressable onPress={()=>setRegionPickerOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View><Text style={styles.photoCredit}>왼쪽부터 시·도 → 시 → 상세 구·군을 선택하세요.</Text><View style={{flexDirection:"row",gap:5,marginTop:12,minHeight:300,maxHeight:470}}><View style={{flex:1,minWidth:0,borderRightWidth:1,borderColor:COLORS.line,paddingRight:4}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple,marginBottom:7}}>시·도</Text><ScrollView nestedScrollEnabled><Pressable onPress={()=>{setRegionProvince("전체");setRegionCity("전체");setSelectedListRegion("전체");}} style={{paddingVertical:9,paddingHorizontal:4,backgroundColor:regionProvince==="전체"?"#F2ECFF":"transparent",borderRadius:7}}><Text style={{fontSize:11,fontWeight:regionProvince==="전체"?"900":"600",color:regionProvince==="전체"?COLORS.purple:COLORS.ink}}>전체</Text></Pressable>{listProvinces.filter(x=>x!=="전체").map(province=><Pressable key={province} onPress={()=>{setRegionProvince(province);setRegionCity("전체");setSelectedListRegion("전체");}} style={{paddingVertical:9,paddingHorizontal:4,backgroundColor:regionProvince===province?"#F2ECFF":"transparent",borderRadius:7}}><Text style={{fontSize:11,fontWeight:regionProvince===province?"900":"600",color:regionProvince===province?COLORS.purple:COLORS.ink}}>{province}</Text></Pressable>)}</ScrollView></View><View style={{flex:1,minWidth:0,borderRightWidth:1,borderColor:COLORS.line,paddingHorizontal:4}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple,marginBottom:7}}>시</Text><ScrollView nestedScrollEnabled><Pressable onPress={()=>{setRegionCity("전체");setSelectedListRegion("전체");}} style={{paddingVertical:9,paddingHorizontal:4,backgroundColor:regionCity==="전체"?"#F2ECFF":"transparent",borderRadius:7}}><Text style={{fontSize:11,fontWeight:regionCity==="전체"?"900":"600",color:regionCity==="전체"?COLORS.purple:COLORS.ink}}>전체</Text></Pressable>{listCities.filter(x=>x!=="전체").map(city=><Pressable key={city} onPress={()=>{setRegionCity(city);setSelectedListRegion("전체");}} style={{paddingVertical:9,paddingHorizontal:4,backgroundColor:regionCity===city?"#F2ECFF":"transparent",borderRadius:7}}><Text style={{fontSize:11,fontWeight:regionCity===city?"900":"600",color:regionCity===city?COLORS.purple:COLORS.ink}}>{city}</Text></Pressable>)}</ScrollView></View><View style={{flex:1,minWidth:0,paddingLeft:4}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple,marginBottom:7}}>상세 구·군</Text><ScrollView nestedScrollEnabled><Pressable onPress={()=>{setSelectedListRegion("전체");setRegionPickerOpen(false);}} style={{paddingVertical:9,paddingHorizontal:4,backgroundColor:selectedListRegion==="전체"?"#F2ECFF":"transparent",borderRadius:7}}><Text style={{fontSize:11,fontWeight:"800",color:COLORS.ink}}>전체</Text></Pressable>{listDistricts.map(area=><Pressable key={area} onPress={()=>{setSelectedListRegion(area);setRegionPickerOpen(false);}} style={{paddingVertical:9,paddingHorizontal:4,borderRadius:7}}><Text style={{fontSize:11,fontWeight:"700",color:COLORS.ink}}>{parseArea(area).detail}</Text></Pressable>)}</ScrollView></View></View><Pressable style={[styles.applyButton,{marginTop:14}]} onPress={()=>setRegionPickerOpen(false)}><Text style={styles.applyText}>닫기</Text></Pressable></View></View></Modal>
<Modal visible={!!detailStudio} animationType="slide" transparent onRequestClose={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}>
<View style={styles.modalShade}><Animated.View style={[styles.modal,{height:detailExpanded?"92%":"65%",maxHeight:"94%",paddingBottom:24,transform:[{translateY:detailDragY}]}]}>
<View style={styles.dragHeader}><View style={styles.dragGestureZone} {...detailPan.panHandlers}><View style={styles.dragHandle}/></View><View style={styles.modalHead}><Text style={styles.modalTitle}>학원 상세 정보</Text><View style={{flexDirection:"row",alignItems:"center",gap:14}}><Pressable onPress={()=>setDetailExpanded(v=>!v)}><Text style={styles.expandText}>{detailExpanded?"접기":"펼치기"}</Text></Pressable><Pressable onPress={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}><Text style={styles.dismissText}>×</Text></Pressable></View></View><Text style={styles.dragHint}>위아래로 끌어 창 크기 조절 · 아래로 길게 끌면 닫기</Text></View>
<View style={{flexDirection:"row",gap:5,marginTop:8,marginBottom:8}}>{([{id:"home",label:"홈"},{id:"notices",label:"소식"},{id:"blog",label:"블로그"},{id:"reviews",label:"리뷰"},{id:"photos",label:"사진"}] as const).map(tab=><Pressable key={tab.id} onPress={()=>setDetailTab(tab.id)} style={{flex:1,paddingVertical:10,borderRadius:10,backgroundColor:detailTab===tab.id?COLORS.pale:"#F8F7FA",alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"800",color:detailTab===tab.id?COLORS.purple:COLORS.muted}}>{tab.label}</Text></Pressable>)}</View>
{!!detailContentError&&<View style={{marginHorizontal:12,marginBottom:8,padding:9,borderRadius:9,backgroundColor:"#FFF8E8"}}><Text style={{fontSize:11,color:"#8B641B"}}>{detailContentError}</Text></View>}{detailCanonicalLoading&&<View style={{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,paddingVertical:8}}><ActivityIndicator size="small" color={COLORS.purple}/><Text style={styles.photoCredit}>학원 정보 동기화 중…</Text></View>}
{!!detailCanonicalError&&<View style={{marginHorizontal:12,marginBottom:8,padding:10,borderRadius:10,backgroundColor:"#FFF1F0",flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{flex:1,fontSize:12,color:"#A53A35"}}>일부 상세 정보 갱신 실패</Text><Pressable disabled={detailCanonicalLoading} onPress={()=>retryCanonicalDetail(detailStudio!.id,detailRequestId.current)} style={{paddingHorizontal:10,paddingVertical:6,backgroundColor:"#FCE1DE",borderRadius:8}}><Text style={{fontSize:12,fontWeight:"800",color:"#A53A35"}}>재시도</Text></Pressable></View>}
<View style={{flex:1}}>{detailStudio&&<>
{detailTab==="home"&&<ScrollView key={detailTab} style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:Math.max(24,insets.bottom+24)}}><View style={{marginTop:10}}>{studioCard(detailStudio,true)}</View>
          <Text style={styles.sectionTitle}>대표 이미지</Text>
          {representativeStudioImage&&!failedStudioImageUrls.includes(representativeStudioImage.uri)?
             <><Pressable onPress={()=>{if(representativeStudioImage.url)Linking.openURL(representativeStudioImage.url).catch(()=>Alert.alert("사진 출처","원문을 열 수 없습니다."));}}><Image source={{uri:representativeStudioImage.uri}} style={[styles.studioPhoto,{width:"100%",height:210,backgroundColor:"#F8F6FB"}]} resizeMode="contain" onError={()=>setFailedStudioImageUrls(current=>current.includes(representativeStudioImage.uri)?current:[...current,representativeStudioImage.uri])}/></Pressable>
            <Text style={styles.photoCredit}>학원 관리자가 등록한 사진</Text>{!!detailStudio.sourceUrl&&<Pressable onPress={()=>Linking.openURL(detailStudio.sourceUrl!).catch(()=>Alert.alert("출처 연결","출처 페이지를 열 수 없습니다."))} style={{alignSelf:"flex-start",paddingVertical:5}}><Text style={styles.photoSourceLink}>정보 원문 확인 ›</Text></Pressable>}
            <Pressable onPress={()=>setDetailTab("photos")} style={{alignSelf:"flex-end",paddingVertical:6,paddingHorizontal:8}}><Text style={styles.photoSourceLink}>사진 {detailPhotoItems.length}장 모두 보기 ›</Text></Pressable></>
            :<View style={styles.photoEmpty}><Text style={styles.filterHint}>확인된 대표 이미지가 아직 없습니다.</Text>{detailStudio.websiteUrl&&<Pressable onPress={()=>Linking.openURL(detailStudio.websiteUrl!).catch(()=>Alert.alert("홈페이지 연결","사이트를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>공식 홈페이지 방문 ›</Text></Pressable>}</View>}
          
          
          <View style={{marginTop:10}}>
            <View style={{flexDirection:"row",gap:8,marginBottom:10}}>
              {([{id:"price",label:"가격 정보"},{id:"schedule",label:"시간표"}] as const).map(tab=><Pressable key={tab.id} onPress={()=>setDetailInfoTab(tab.id)} style={{flex:1,paddingVertical:10,borderRadius:10,borderWidth:1,borderColor:detailInfoTab===tab.id?COLORS.purple:COLORS.line,backgroundColor:detailInfoTab===tab.id?COLORS.pale:"#FFFFFF",alignItems:"center"}}><Text style={{fontSize:13,fontWeight:"800",color:detailInfoTab===tab.id?COLORS.purple:COLORS.muted}}>{tab.label}</Text></Pressable>)}
            </View>
            {detailInfoTab==="price"&&<View>
              <Text style={styles.sectionTitle}>가격표 이미지</Text>
              {studioPublicPrices.filter(item=>evidencePhotosForSource(item.image_urls).length>0).map(item=><View key={"public-price-"+item.id}>{evidencePhotoGallery("price-"+item.id,item.image_urls)}</View>)}
              {!studioPublicPrices.some(item=>evidencePhotosForSource(item.image_urls).length>0)&&<Text style={styles.filterHint}>등록된 가격표 이미지가 없습니다.</Text>}
            </View>}
            {detailInfoTab==="schedule"&&<View>
              <Text style={styles.sectionTitle}>시간표 이미지</Text>
              {studioPublicSchedules.filter(item=>evidencePhotosForSource(item.image_urls).length>0).map(item=><View key={"public-schedule-"+item.id}>{evidencePhotoGallery("schedule-"+item.id,item.image_urls)}</View>)}
              {!studioPublicSchedules.some(item=>evidencePhotosForSource(item.image_urls).length>0)&&<Text style={styles.filterHint}>등록된 시간표 이미지가 없습니다.</Text>}
            </View>}
          </View>
          {detailStudio.address&&<View style={styles.infoRow}><Text style={styles.infoLabel}>주소</Text><Text style={styles.infoValue}>{detailStudio.address}</Text></View>}
          {(detailStudio.address||detailStudio.lat)&&<Pressable style={styles.detailBtn} onPress={()=>requestDirections(detailStudio)}><Text style={styles.detailBtnText}>길찾기 열기 · {mapProvider==="kakao"?"카카오맵":mapProvider==="google"?"구글 지도":"앱 선택"}</Text></Pressable>}
          <View style={styles.infoRow}><Text style={styles.infoLabel}>수업 대상</Text><Text style={styles.infoValue}>{[detailStudio.adult?"성인":null,detailStudio.kids?"키즈":null].filter(Boolean).join(" · ")||"미등록"}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>수준</Text><Text style={styles.infoValue}>{detailStudio.level.join(" · ")||"미등록"}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>전화</Text><Text style={styles.infoValue}>{detailStudio.phone||"미등록"}</Text></View>
          {detailStudio.phone&&<Pressable style={styles.detailBtn} onPress={()=>Linking.openURL("tel:"+detailStudio.phone).catch(()=>Alert.alert("전화 연결","전화 앱을 열 수 없습니다."))}><Text style={styles.detailBtnText}>전화 문의 · {detailStudio.phone}</Text></Pressable>}
          <Text style={styles.detailDisclaimer}>가격과 시간표는 학원 또는 관리자에게 확인된 등록 정보만 표시합니다. 최신 여부를 확인해 주세요.</Text>
          <Pressable onPress={()=>router.push("/studio-manager?studioId="+encodeURIComponent(detailStudio.id)+"&studioName="+encodeURIComponent(detailStudio.name))} style={{marginTop:14,backgroundColor:COLORS.pale,borderRadius:10,padding:12,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"900",color:COLORS.purple}}>학원 관리 신청 / 정보 수정</Text></Pressable>
          {(!!detailStudio.detailsCheckedAt||(detailStudio.detailsSourceUrls||[]).length>0)&&<Text style={styles.sectionTitle}>공식 홈페이지 확인 정보</Text>}
          {!!detailStudio.detailsCheckedAt&&<Text style={styles.photoCredit}>최근 확인: {new Date(detailStudio.detailsCheckedAt).toLocaleDateString("ko-KR")} · 원문 텍스트 자동 추출</Text>}
          {(detailStudio.detailsSourceUrls||[]).map((url,index)=><Pressable key={url+index} onPress={()=>Linking.openURL(url).catch(()=>Alert.alert("원문 연결","페이지를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>수집 원문 {index+1} 확인 ›</Text></Pressable>)}
          <Pressable onPress={()=>setDetailTab("reviews")} style={{marginHorizontal:14,marginTop:10,padding:12,borderRadius:12,borderWidth:1,borderColor:COLORS.line,backgroundColor:COLORS.white,flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{fontSize:12,fontWeight:"800",color:COLORS.ink}}>리뷰 {studioReviews.length}개 · 후기 확인하기</Text><Text style={styles.photoSourceLink}>리뷰 ›</Text></Pressable>{studioCoupons.length>0&&<Text style={styles.sectionTitle}>사용 가능한 쿠폰 및 할인</Text>}
          {studioCoupons.length?studioCoupons.map(coupon=><View key={coupon.id} style={styles.classBlock}><Text style={styles.classTitle}>{coupon.title}</Text>{coupon.discount_text&&<Text style={styles.classMeta}>{coupon.discount_text}</Text>}{coupon.description&&<Text style={styles.sessionText}>{coupon.description}</Text>}<Text style={styles.photoCredit}>유효 기간: {coupon.starts_at?new Date(coupon.starts_at).toLocaleDateString("ko-KR"):"시작일 제한 없음"} ~ {coupon.ends_at?new Date(coupon.ends_at).toLocaleDateString("ko-KR"):"종료일 제한 없음"}</Text></View>) :null}
          <Pressable style={styles.detailBtn} onPress={async()=>{if(!supabase){Alert.alert("제보","로그인이 필요한 기능입니다.");return;}const {data}=await supabase.auth.getSession();if(!data.session){Alert.alert("로그인 필요","학원 정보 제보는 로그인 후 이용할 수 있어요.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);return;}setReportCategory("기타");setReportDescription("");setReportOpen(true);}}><Text style={styles.detailBtnText}>학원 정보 오류 제보</Text></Pressable>
          <Pressable style={[styles.applyButton,{marginTop:8}]} onPress={()=>toggleFavorite(detailStudio)}><Text style={styles.applyText}>{favoriteIds.includes(detailStudio.id)?"찜 해제":"♡ 즐겨찾기 추가"}</Text></Pressable></ScrollView>}
{detailTab==="notices"&&<ScrollView key={detailTab} style={{flex:1}} contentContainerStyle={{paddingBottom:Math.max(24,insets.bottom+24)}}><Text style={styles.sectionTitle}>학원 안내</Text>{String(detailStudio.description||"").trim().length>0&&<><Text style={styles.sectionTitle}>학원 소개</Text><Text style={styles.detailDescription}>{cleanPublicText(detailStudio.description)}</Text></>}
          {!!detailStudio.kakaoChannelUrl&&<View style={styles.infoRow}><Text style={styles.infoLabel}>카카오톡 채널</Text><Pressable onPress={()=>Linking.openURL(detailStudio.kakaoChannelUrl!).catch(()=>Alert.alert("카카오톡 채널","채널 주소를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>채널 방문 ›</Text></Pressable></View>}
          {!!detailStudio.websiteUrl&&<View style={styles.infoRow}><Text style={styles.infoLabel}>공식 홈페이지</Text><Pressable onPress={()=>Linking.openURL(detailStudio.websiteUrl!).catch(()=>Alert.alert("홈페이지 연결","사이트를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>홈페이지 방문 ›</Text></Pressable></View>}
          <Text style={styles.sectionTitle}>공지사항</Text><View style={{marginHorizontal:14,marginTop:10,padding:13,borderRadius:13,backgroundColor:"#FFF9E9",borderWidth:1,borderColor:"#F0E3C1"}}><Text style={{fontSize:13,fontWeight:"900",color:"#72551A"}}>공지사항</Text>{studioOwnerNotices.length?studioOwnerNotices.slice(0,2).map(item=><View key={"owner-notice-"+String(item?.id??"notice")} style={{borderTopWidth:1,borderTopColor:"#EFE4CA",paddingTop:8,marginTop:7}}><Text style={{fontSize:13,fontWeight:"800",color:COLORS.ink}}>{cleanPublicText(item?.title)||"공지"}</Text><Text numberOfLines={3} style={{fontSize:12,lineHeight:18,color:"#625E70",marginTop:4}}>{cleanPublicText(item?.body)||"내용이 없습니다."}</Text><Text style={{fontSize:10,color:COLORS.muted,marginTop:5}}>{item?.created_at&&Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleDateString("ko-KR"):"날짜 미확인"}</Text></View>):<Text style={{fontSize:11,color:"#81798D",marginTop:7}}>등록된 공지사항이 없습니다.</Text>}</View></ScrollView>}{detailTab==="blog"&&<View style={{flex:1}}><Text style={styles.photoCredit}>학원 연결 네이버 블로그 게시글 · {studioBlogPosts.length}건</Text>{blogLoading?<ActivityIndicator color={COLORS.purple} style={{marginVertical:20}}/>:<FlatList data={studioBlogPosts} keyExtractor={item=>String(item.source_id)} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={6} removeClippedSubviews ListEmptyComponent={<Text style={styles.filterHint}>등록된 공식 블로그 게시글이 없습니다. 공식 계정이 확인되면 최신 글이 표시됩니다.</Text>} renderItem={({item:post})=><Pressable onPress={()=>Linking.openURL(post.post_url).catch(()=>Alert.alert("원문 연결","게시글을 열 수 없습니다."))} style={{marginHorizontal:2,marginVertical:7,padding:15,borderRadius:14,backgroundColor:COLORS.white,borderWidth:1,borderColor:COLORS.line}}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:9}}><View style={{paddingHorizontal:9,paddingVertical:4,borderRadius:20,backgroundColor:COLORS.pale}}><Text style={{fontSize:10,fontWeight:"800",color:COLORS.purple}}>공식 블로그</Text></View><Text style={styles.photoCredit}>{post.post_date?new Date(post.post_date).toLocaleDateString("ko-KR"):"게시일 미확인"}</Text></View><Text style={[styles.classTitle,{fontSize:15,lineHeight:22,marginBottom:6}]}>{cleanPublicText(post.title)}</Text>{!!post.description&&<Text numberOfLines={3} style={[styles.sessionText,{lineHeight:20}]}>{cleanPublicText(post.description)}</Text>}<Text style={[styles.photoSourceLink,{marginTop:10}]}>네이버 블로그에서 글 읽기 ›</Text></Pressable>}/>}</View>}
{detailTab==="reviews"&&<View style={{flex:1}}>
<View style={styles.classBlock}><Text style={styles.classTitle}>이 학원에 대한 리뷰</Text><Text style={styles.photoCredit}>{studioReviews.length?"평균 별점 "+(studioReviews.reduce((sum,row)=>sum+Number(row.rating),0)/studioReviews.length).toFixed(1)+" · 리뷰 "+studioReviews.length+"개":"첫 리뷰를 남겨주세요."}</Text><Text style={styles.classMeta}>내 별점</Text><View style={{flexDirection:"row",gap:8,marginVertical:8}}>{[1,2,3,4,5].map(value=><Pressable key={value} onPress={()=>setReviewRating(value)}><Text style={{fontSize:28,color:value<=reviewRating?"#F2B544":"#D8D4E1"}}>★</Text></Pressable>)}</View><TextInput value={reviewText} onChangeText={setReviewText} placeholder="수업 분위기, 강사님, 시설 등에 대한 경험을 작성해 주세요." placeholderTextColor="#A5A1B0" multiline maxLength={1000} textAlignVertical="top" style={styles.reportInput}/>{reviewText.trim().length>0&&reviewText.trim().length<5&&<Text style={{fontSize:11,color:"#B66B77",marginTop:-9,marginBottom:10}}>리뷰는 5자 이상 입력해 주세요. ({reviewText.trim().length}/5자)</Text>}<Pressable disabled={reviewSubmitting||reviewText.trim().length<5} style={[styles.applyButton,{opacity:reviewSubmitting||reviewText.trim().length<5?0.5:1}]} onPress={async()=>{if(!supabase){Alert.alert("리뷰","로그인이 필요한 기능입니다.");return;}setReviewSubmitting(true);try{const {data:{session}}=await supabase.auth.getSession();if(!session){Alert.alert("로그인 필요","리뷰 작성은 로그인 후 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);return;}const {error}=await supabase.from("studio_reviews").upsert({studio_id:detailStudio!.id,user_id:session.user.id,rating:reviewRating,content:reviewText.trim(),updated_at:new Date().toISOString()},{onConflict:"studio_id,user_id"});if(error)throw error;setReviewText("");const {data,error:loadError}=await supabase.from("studio_reviews").select("id,studio_id,user_id,rating,content,created_at,updated_at").eq("studio_id",detailStudio!.id).order("created_at",{ascending:false}).limit(100);if(loadError)throw loadError;setStudioReviews(data||[]);Alert.alert("리뷰 등록 완료","학원 리뷰가 등록되었습니다.");}catch(error:any){Alert.alert("리뷰 등록 실패",error?.message||"잠시 후 다시 시도해 주세요.");}finally{setReviewSubmitting(false);}}}><Text style={styles.applyText}>{reviewSubmitting?"등록 중…":"리뷰 등록 / 수정"}</Text></Pressable></View>
{reviewsLoading?<ActivityIndicator color={COLORS.purple} style={{margin:20}}/>:<FlatList data={studioReviews} keyExtractor={item=>String(item.id)} initialNumToRender={5} maxToRenderPerBatch={5} windowSize={5} removeClippedSubviews ListEmptyComponent={<Text style={styles.filterHint}>아직 등록된 리뷰가 없습니다.</Text>} renderItem={({item})=><View style={styles.classBlock}><Text style={styles.classTitle}>{"★".repeat(Number(item.rating))}{"☆".repeat(5-Number(item.rating))}</Text><Text style={styles.photoCredit}>{item.user_id===reviewUserId?"내 리뷰":"방문자 리뷰"} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</Text><Text style={styles.sessionText}>{item.content}</Text></View>}/>}
</View>}
{detailTab==="photos"&&<View style={{flex:1}}><Text style={styles.photoCredit}>학원 관리자가 등록한 사진만 표시합니다.</Text><FlatList data={detailPhotoItems.slice(0,36)} keyExtractor={item=>item.key} numColumns={3} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5} removeClippedSubviews columnWrapperStyle={{gap:7,marginBottom:7}} ListEmptyComponent={<Text style={styles.filterHint}>등록된 사진이 없습니다.</Text>} renderItem={({item})=><Pressable style={{flex:1}} onPress={()=>{if(item.url)Linking.openURL(item.url).catch(()=>Alert.alert("원문 연결","사진 출처를 열 수 없습니다."));}}>{failedStudioImageUrls.includes(item.uri)?<View style={{height:108,alignItems:"center",justifyContent:"center",backgroundColor:"#F3F0F5"}}><Text style={styles.filterHint}>이미지 없음</Text></View>:<Image source={{uri:item.uri}} style={{flex:1,height:108,borderRadius:9,backgroundColor:"#F3F0F5"}} resizeMode="cover" onError={()=>setFailedStudioImageUrls(current=>current.includes(item.uri)?current:[...current,item.uri])}/>}</Pressable>}/></View>}
</>}</View>
</Animated.View></View></Modal><Modal visible={reportOpen} transparent animationType="slide" onRequestClose={()=>setReportOpen(false)}>
      <View style={styles.modalShade}><View style={styles.modal}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>학원 정보 제보</Text><Pressable onPress={()=>setReportOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.sectionTitle}>제보 유형</Text><View style={styles.filterChoices}>{["폐업/이전","주소 오류","전화/홈페이지 오류","가격/시간표 오류","사진 오류","기타"].map(v=><Chip key={v} label={v} active={reportCategory===v} onPress={()=>setReportCategory(v)}/>)}</View>
        <Text style={styles.sectionTitle}>상세 내용</Text><TextInput value={reportDescription} onChangeText={setReportDescription} placeholder="잘못된 정보와 확인한 내용을 적어주세요. (5~1000자)" multiline maxLength={1000} textAlignVertical="top" style={styles.reportInput}/>
        <Pressable disabled={reportSubmitting||reportDescription.trim().length<5} style={[styles.applyButton,{opacity:reportSubmitting||reportDescription.trim().length<5?0.5:1}]} onPress={async()=>{const client=supabase;const target=detailStudio;if(!client||!target)return;setReportSubmitting(true);try{const {data:{session}}=await client.auth.getSession();if(!session){Alert.alert("로그인 필요","다시 로그인해 주세요.");setReportOpen(false);return;}const {error}=await client.from("studio_user_reports").insert({studio_id:target.id,reporter_id:session.user.id,category:reportCategory,description:reportDescription.trim()});if(error)throw error;setReportOpen(false);Alert.alert("제보 접수 완료","제보 내용을 관리자에게 전달했습니다.");}catch(e:any){Alert.alert("제보 실패",e?.message||"잠시 후 다시 시도해 주세요.");}finally{setReportSubmitting(false);}}}><Text style={styles.applyText}>{reportSubmitting?"접수 중…":"제보 보내기"}</Text></Pressable>
      </View></View>
    </Modal>

    <Modal visible={filterOpen} animationType="slide" transparent onRequestClose={()=>setFilterOpen(false)}>
      <View style={styles.modalShade}><View style={[styles.modal,{maxHeight:"90%"}]}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>검색 필터</Text><Pressable onPress={()=>setFilterOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled"><Text style={styles.sectionTitle}>대상</Text><View style={styles.filterChoices}><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/></View>
        <Text style={styles.sectionTitle}>수준</Text><View style={styles.filterChoices}>{["입문","초급","중급","고급"].map(v=><Chip key={v} label={v} active={level===v} onPress={()=>setLevel(level===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>수업 유형</Text><View style={styles.filterChoices}>{classTypeOptions.length?classTypeOptions.map(v=><Chip key={v} label={v} active={classTypeFilter===v} onPress={()=>setClassTypeFilter(classTypeFilter===v?null:v)}/>):<Text style={styles.filterHint}>등록된 수업 유형 정보가 없습니다.</Text>}</View>
        {classFilterLoading&&<Text style={styles.filterHint}>선택한 수업 조건을 확인하고 있습니다…</Text>}
        <Text style={styles.sectionTitle}>요일</Text><View style={styles.filterChoices}>{["평일","주말"].map(v=><Chip key={v} label={v} active={dayFilter===v} onPress={()=>setDayFilter(dayFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>시간대</Text><View style={styles.filterChoices}>{["오전","오후","저녁"].map(v=><Chip key={v} label={v} active={timeFilter===v} onPress={()=>setTimeFilter(timeFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>가격</Text><View style={styles.filterChoices}>{[{label:"2만원 이하",value:20000},{label:"2.5만원 이하",value:25000},{label:"3만원 이하",value:30000}].map(v=><Chip key={v.value} label={v.label} active={maxPrice===v.value} onPress={()=>setMaxPrice(maxPrice===v.value?null:v.value)}/>)}</View>
        <Text style={styles.sectionTitle}>수업 길이</Text><View style={styles.filterChoices}>{[45,50,60,75,90].map(v=><Chip key={v} label={v+"분"} active={durationFilter===v} onPress={()=>setDurationFilter(durationFilter===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>거리 (지도 중심 기준)</Text><View style={styles.filterChoices}>{[1,3,5,10].map(v=><Chip key={v} label={v+"km"} active={maxDistance===v} onPress={()=>setMaxDistance(maxDistance===v?null:v)}/>)}</View>
        <Text style={styles.sectionTitle}>교육청 등록 정보</Text><View style={styles.filterChoices}><Chip label="교육청 등록 정보 확인된 곳만" active={neisOnlyFilter} onPress={()=>setNeisOnlyFilter(!neisOnlyFilter)}/></View><Text style={styles.filterHint}>기본 검색에는 지도에서 확인된 모든 학원이 표시됩니다. 필터를 켜면 교육청 등록 정보가 확인된 학원만 볼 수 있습니다. 등록 여부 미확인은 미등록을 뜻하지 않습니다.</Text>
        <Text style={styles.sectionTitle}>혜택</Text><View style={styles.filterChoices}><Chip label="쿠폰/할인" active={coupon} onPress={()=>setCoupon(!coupon)}/></View>
        <Text style={styles.filterHint}>거리 필터는 현재 지도 중심을 기준으로 계산합니다.</Text>
        </ScrollView><View style={styles.modalActions}><Pressable style={styles.resetButton} onPress={resetFilters}><Text style={styles.resetText}>초기화</Text></Pressable><Pressable style={styles.applyButton} onPress={()=>setFilterOpen(false)}><Text style={styles.applyText}>결과 {results.length}곳 보기</Text></Pressable></View>
      </View></View>
    </Modal>
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:COLORS.bg},header:{paddingHorizontal:12,paddingTop:2,paddingBottom:3,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},headerActions:{flexDirection:"row",alignItems:"center",gap:8},menuButton:{height:34,width:34,borderRadius:11,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},menuButtonText:{fontSize:19,color:COLORS.ink,fontWeight:"700"},brand:{fontSize:20,fontWeight:"900",letterSpacing:-0.7,color:COLORS.ink},brandDot:{color:COLORS.purple,fontSize:19},subtitle:{fontSize:11,color:COLORS.muted,marginTop:3},profileButton:{height:34,width:34,borderRadius:11,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},
 searchRow:{paddingHorizontal:10,paddingTop:0,flexDirection:"row",gap:6},searchSubmitButton:{width:42,height:42,borderRadius:12,backgroundColor:COLORS.purple,alignItems:"center",justifyContent:"center"},searchHint:{fontSize:10,color:COLORS.muted,paddingHorizontal:20,paddingTop:4},searchBox:{flex:1,flexDirection:"row",alignItems:"center",backgroundColor:"#fff",borderRadius:12,paddingHorizontal:11,height:42,borderWidth:1,borderColor:COLORS.line,gap:8},searchInput:{flex:1,fontSize:14,color:COLORS.ink,height:42,paddingVertical:0,includeFontPadding:false},clear:{fontSize:21,color:COLORS.muted},filterButton:{width:42,height:42,backgroundColor:"#fff",borderRadius:12,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},filterCount:{position:"absolute",top:4,right:4,backgroundColor:COLORS.purple,width:16,height:16,borderRadius:8,alignItems:"center",justifyContent:"center"},filterCountText:{fontSize:10,color:"#fff",fontWeight:"700"},
 quickFilters:{flexDirection:"row",paddingHorizontal:10,paddingVertical:4,gap:8},chip:{height:32,borderRadius:16,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",paddingHorizontal:14,justifyContent:"center"},chipActive:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},chipText:{fontSize:13,color:"#625E70"},chipTextActive:{color:COLORS.purple,fontWeight:"700"},
 content:{flex:1,marginTop:2},mapWrap:{flex:1,overflow:"hidden",borderTopLeftRadius:22,borderTopRightRadius:22},map:{flex:1},pin:{backgroundColor:"#fff",paddingHorizontal:10,paddingVertical:7,borderRadius:18,borderColor:"#DCD6F8",borderWidth:1.5,elevation:3,shadowColor:"#000",shadowOpacity:0.1,shadowRadius:4},pinSelected:{backgroundColor:COLORS.purple,borderColor:COLORS.purple},pinText:{fontSize:11,fontWeight:"800",color:COLORS.purple},pinTextSelected:{color:"#fff"},areaSearch:{position:"absolute",top:14,alignSelf:"center",backgroundColor:"#fff",paddingHorizontal:16,paddingVertical:11,borderRadius:24,elevation:4,shadowColor:"#000",shadowOpacity:0.12,shadowRadius:5},areaSearchText:{color:COLORS.ink,fontSize:13,fontWeight:"700"},locateButton:{position:"absolute",right:14,bottom:76,width:44,height:44,borderRadius:14,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",elevation:3},mapCount:{position:"absolute",left:12,bottom:12,backgroundColor:"#fff",paddingHorizontal:13,paddingVertical:10,borderRadius:13,elevation:2},mapCountText:{fontSize:12,color:COLORS.ink,fontWeight:"700"},selectedCard:{position:"absolute",bottom:10,left:8,right:8,backgroundColor:"#fff",borderRadius:18,padding:10,elevation:7,shadowColor:"#000",shadowOpacity:0.15,shadowRadius:10},studioCard:{backgroundColor:"#fff",borderRadius:17,padding:14,marginBottom:10,borderWidth:1,borderColor:"#F0EDF5"},compactCard:{marginBottom:0,padding:8,borderWidth:0},cardTop:{flexDirection:"row",alignItems:"center",gap:10},studioIcon:{width:68,height:68,borderRadius:14,backgroundColor:COLORS.pink,alignItems:"center",justifyContent:"center",overflow:"hidden"},studioThumb:{width:68,height:68},studioName:{fontSize:15,fontWeight:"800",color:COLORS.ink},studioArea:{fontSize:11,color:COLORS.muted,marginTop:3},couponBadge:{backgroundColor:"#FFF1D9",borderRadius:8,paddingHorizontal:7,paddingVertical:4},couponText:{fontSize:10,color:"#B87922",fontWeight:"700"},tagsRow:{flexDirection:"row",gap:5,marginTop:11},tag:{backgroundColor:"#F6F4F9",borderRadius:6,paddingHorizontal:7,paddingVertical:4},tagText:{fontSize:10,color:"#777184"},cardBottom:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:11},priceText:{fontSize:14,fontWeight:"800",color:COLORS.ink},priceUnit:{fontSize:11,fontWeight:"400",color:COLORS.muted},metaText:{fontSize:11,color:COLORS.muted},cardActions:{flexDirection:"row",gap:7,marginTop:9},actionChip:{backgroundColor:"#F7F5FA",borderRadius:9,paddingHorizontal:10,paddingVertical:6},actionText:{fontSize:10,color:COLORS.purple,fontWeight:"700"},compareFloating:{position:"absolute",bottom:72,alignSelf:"center",backgroundColor:COLORS.purple,paddingHorizontal:18,paddingVertical:12,borderRadius:24,zIndex:5,elevation:6},compareFloatingText:{fontSize:12,fontWeight:"800",color:"#fff"},dragHeader:{paddingBottom:6},dragGestureZone:{height:42,alignItems:"center",justifyContent:"center"},dragHandle:{width:48,height:6,borderRadius:3,backgroundColor:"#D8D4E1",alignSelf:"center"},dragHint:{fontSize:10,color:COLORS.muted,marginTop:5,textAlign:"center"},expandText:{fontSize:12,color:COLORS.purple,fontWeight:"800"},studioPhoto:{width:250,height:158,borderRadius:13,backgroundColor:"#F3F0F5"},photoEmpty:{backgroundColor:"#F8F6FB",padding:14,borderRadius:12},photoSourceLink:{fontSize:12,color:COLORS.purple,fontWeight:"800",marginTop:7},photoCredit:{fontSize:10,color:COLORS.muted,marginTop:5},classBlock:{backgroundColor:"#F8F6FB",borderRadius:12,padding:12,marginBottom:8},classTitle:{fontSize:13,fontWeight:"800",color:COLORS.ink},classMeta:{fontSize:11,color:COLORS.muted,marginTop:4},sessionText:{fontSize:11,color:"#625E70",marginTop:5},compareRow:{borderBottomWidth:1,borderBottomColor:COLORS.line,paddingVertical:13},compareName:{fontSize:14,fontWeight:"800",color:COLORS.ink},compareInfo:{fontSize:11,color:COLORS.muted,marginTop:4},comparePrice:{fontSize:14,fontWeight:"900",color:COLORS.purple,marginTop:6},removeCompare:{fontSize:11,color:"#B66B77",marginTop:6},detailDescription:{fontSize:13,color:"#625E70",lineHeight:20},infoRow:{flexDirection:"row",justifyContent:"space-between",paddingVertical:9,borderBottomWidth:1,borderBottomColor:COLORS.line},infoLabel:{fontSize:12,color:COLORS.muted},infoValue:{fontSize:12,color:COLORS.ink,fontWeight:"700"},detailDisclaimer:{fontSize:10,color:"#A29EAC",marginTop:14},reportInput:{minHeight:110,borderWidth:1,borderColor:COLORS.line,borderRadius:13,padding:12,fontSize:13,color:COLORS.ink,marginBottom:15},detailBtn:{backgroundColor:COLORS.pale,alignItems:"center",padding:10,borderRadius:12,marginTop:7},detailBtnText:{fontSize:12,fontWeight:"700",color:COLORS.purple},dismiss:{position:"absolute",top:9,right:8,width:24,height:24,borderRadius:12,backgroundColor:"#F5F3F8",alignItems:"center",justifyContent:"center"},dismissText:{fontSize:20,color:COLORS.muted},listSortRow:{flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:12,paddingVertical:8,backgroundColor:COLORS.bg},listSortLabel:{flex:1,fontSize:12,color:COLORS.muted,fontWeight:"700"},listSortChip:{paddingHorizontal:10,paddingVertical:6,borderRadius:14,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff"},listSortChipActive:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},listSortChipText:{fontSize:11,color:COLORS.muted,fontWeight:"700"},listSortChipTextActive:{color:COLORS.purple},listContent:{padding:12,paddingBottom:20},empty:{textAlign:"center",padding:30,color:COLORS.muted},
 bottomNav:{height:61,backgroundColor:"#fff",borderTopWidth:1,borderTopColor:COLORS.line,flexDirection:"row",justifyContent:"space-around",alignItems:"center",paddingBottom:3},navItem:{alignItems:"center",justifyContent:"center",gap:2,flex:1},navIcon:{fontSize:20,color:"#9D98AA"},navLabel:{fontSize:10,color:"#9D98AA"},navActive:{color:COLORS.purple,fontWeight:"800"},
 drawerShade:{flex:1,flexDirection:"row",backgroundColor:"rgba(30,25,45,0.38)"},drawerPanel:{width:"84%",maxWidth:340,height:"100%",backgroundColor:"#fff",paddingTop:24,paddingHorizontal:16,paddingBottom:16,elevation:12},drawerHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingBottom:24,borderBottomWidth:1,borderBottomColor:COLORS.line},drawerBrand:{fontSize:22,fontWeight:"900",color:COLORS.ink},drawerSubtitle:{fontSize:11,color:COLORS.muted,marginTop:4},drawerClose:{width:34,height:34,borderRadius:12,backgroundColor:COLORS.bg,alignItems:"center",justifyContent:"center"},drawerCloseText:{fontSize:24,color:COLORS.muted,marginTop:-3},drawerSection:{fontSize:11,color:COLORS.muted,fontWeight:"800",marginTop:24,marginBottom:8,letterSpacing:0.5},drawerItem:{minHeight:52,flexDirection:"row",alignItems:"center",gap:13,borderRadius:13,paddingHorizontal:12},drawerIcon:{width:24,alignItems:"center",justifyContent:"center"},drawerItemText:{flex:1,fontSize:14,fontWeight:"700",color:COLORS.ink},drawerCurrent:{fontSize:10,color:COLORS.purple,fontWeight:"800"},drawerCount:{fontSize:11,color:COLORS.muted,fontWeight:"700"},drawerDivider:{height:1,backgroundColor:COLORS.line,marginTop:14},drawerFooter:{marginTop:"auto",paddingTop:18,borderTopWidth:1,borderTopColor:COLORS.line},drawerFooterText:{fontSize:10,color:COLORS.muted},modalShade:{flex:1,backgroundColor:"rgba(30,25,45,0.35)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:24,borderTopRightRadius:24,padding:22,paddingBottom:30},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},mapProviderOption:{flexDirection:"row",alignItems:"center",gap:12,padding:14,borderWidth:1,borderColor:COLORS.line,borderRadius:14,marginTop:10},mapProviderSelected:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},mapProviderTitle:{fontSize:14,fontWeight:"800",color:COLORS.ink},mapProviderSub:{fontSize:10,color:COLORS.muted,marginTop:3},mapProviderCheck:{fontSize:11,fontWeight:"800",color:COLORS.purple},modalTitle:{fontSize:20,fontWeight:"900",color:COLORS.ink},searchResultSub:{fontSize:11,color:COLORS.muted,marginTop:4},searchResultRow:{flexDirection:"row",alignItems:"center",gap:11,paddingHorizontal:12,paddingVertical:14,marginBottom:8,borderWidth:1,borderColor:COLORS.line,borderRadius:13,backgroundColor:COLORS.white},searchResultNumber:{width:28,height:28,borderRadius:9,backgroundColor:COLORS.pale,alignItems:"center",justifyContent:"center"},searchResultNumberText:{fontSize:12,fontWeight:"900",color:COLORS.purple},searchResultName:{fontSize:14,fontWeight:"800",color:COLORS.ink},searchResultAddress:{fontSize:11,color:COLORS.muted,marginTop:4,lineHeight:16},sectionTitle:{fontSize:14,fontWeight:"800",color:COLORS.ink,marginTop:23,marginBottom:10},filterChoices:{flexDirection:"row",flexWrap:"wrap",gap:8},filterHint:{fontSize:11,color:COLORS.muted,marginTop:20,lineHeight:17},modalActions:{flexDirection:"row",gap:10,marginTop:25},resetButton:{flex:1,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,borderWidth:1,borderColor:COLORS.line},resetText:{fontWeight:"700",color:COLORS.ink},applyButton:{flex:2,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,backgroundColor:COLORS.purple},applyText:{fontWeight:"800",color:"#fff"}
});