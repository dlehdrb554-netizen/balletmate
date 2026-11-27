import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import BottomSheet, {BottomSheetScrollView} from "@gorhom/bottom-sheet";
import {Gesture, GestureDetector, GestureHandlerRootView} from "react-native-gesture-handler";
import {runOnJS} from "react-native-reanimated";
import {themeStyles } from "../lib/theme";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator, Animated, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform, Alert, Image, useColorScheme} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
type Region = {latitude:number;longitude:number;latitudeDelta:number;longitudeDelta:number};
import { fetchStudios, fetchStudioById, searchStudiosByName, searchStudiosByKakao, isExcludedStudioSearchResult, StudioRecord } from "../lib/studios";
import { fetchClassesForStudio, StudioClass } from "../lib/classes";
import { searchStudiosByClassFilters, searchStudioIdsByClassName } from "../lib/class-search";
import { fetchCouponsForStudio, StudioCoupon } from "../lib/coupons";
import { fetchStudioPublicPrices, StudioPublicPrice, fetchStudioPublicSchedules, StudioPublicSchedule } from "../lib/studio-public-materials";
import { supabase, supabaseConfigured } from "../lib/supabase";
import * as Location from "expo-location";
import KakaoMap, { KakaoMapHandle } from "../components/KakaoMap";

type Studio = {
  id: string; name: string; lat: number; lng: number; area: string;
  tags: string[]; coupon: boolean; adult: boolean; kids: boolean;
  level: string[]; days: string[]; time: string; duration: number; rating: number;
  description: string; address?: string; phone?: string; websiteUrl?: string; representativeImageUrl?: string; sourceUrl?: string; sourceName?: string; sourceStatus?: string; verifiedAt?: string; classDurations?: number[];
};
const cleanPublicText=(value:string|null|undefined)=>String(value||"").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").split(" ").filter(Boolean).join(" ");
const getKakaoSearchErrorMessage=(error:any)=>{
  const status=Number(error?.context?.status??error?.status);
  if(status===429)return {title:"검색 요청이 많아요",message:"짧은 시간에 검색 요청이 많았어요. 잠시 후 다시 검색해 주세요."};
  return {title:"검색할 수 없어요",message:"일시적으로 학원 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."};
};
const getStudioLoadErrorMessage=(error:any)=>{
  const message=String(error?.message||"");
  const status=Number(error?.context?.status??error?.status);
  if(message.includes("한도")||message.includes("40회"))return "지도 검색 요청 한도(40회)에 도달했습니다. 앱을 다시 실행한 뒤 다시 검색해 주세요.";
  if(status===429)return "서버 요청이 많아 잠시 검색이 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  return "학원 정보를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
};
const mapStudioRecord = (r: StudioRecord): Studio => ({
  id:r.id,name:r.name,lat:Number(r.latitude),lng:Number(r.longitude),area:r.district||"지역 정보 없음",
  address:r.address||undefined,tags:r.tags||[],coupon:!!r.coupon_available,
  adult:!!r.adult_classes,kids:!!r.kids_classes,level:r.levels||[],days:r.days||[],
  time:(r.time_slots||[]).join(" · "),duration:r.duration_minutes||0,rating:Number(r.rating||0),
  description:r.description||"등록된 소개가 없습니다.",phone:r.phone||undefined,
  websiteUrl:r.website_url||undefined,representativeImageUrl:r.representative_image_path&&supabase?supabase.storage.from("studio-representative-images").getPublicUrl(r.representative_image_path).data.publicUrl:undefined,sourceUrl:r.source_url||undefined,
   sourceName:r.source_name||undefined,sourceStatus:r.source_status||undefined,verifiedAt:r.verified_at||undefined,
   classDurations:r.class_durations||[]
});

const PROVINCES=["서울시","경기도","인천시","부산시","대구시","광주시","대전시","울산시","세종시","충청남도","충청북도","전라남도","전라북도","경상남도","경상북도","강원도","제주도"];
const PROVINCE_ALIASES:Record<string,string>={
 "서울":"서울시","서울시":"서울시","서울특별시":"서울시",
 "부산":"부산시","부산시":"부산시","부산광역시":"부산시",
 "대구":"대구시","대구시":"대구시","대구광역시":"대구시",
 "인천":"인천시","인천시":"인천시","인천광역시":"인천시",
 "광주":"광주시","광주시":"광주시","광주광역시":"광주시",
 "대전":"대전시","대전시":"대전시","대전광역시":"대전시",
 "울산":"울산시","울산시":"울산시","울산광역시":"울산시",
 "세종":"세종시","세종시":"세종시","세종특별자치시":"세종시",
 "경기":"경기도","경기도":"경기도","강원":"강원도","강원도":"강원도","강원특별자치도":"강원도",
 "충북":"충청북도","충청북도":"충청북도","충남":"충청남도","충청남도":"충청남도",
 "전북":"전라북도","전라북도":"전라북도","전북특별자치도":"전라북도",
 "전남":"전라남도","전라남도":"전라남도","경북":"경상북도","경상북도":"경상북도",
 "경남":"경상남도","경상남도":"경상남도","제주":"제주도","제주도":"제주도","제주특별자치도":"제주도"
};
const UNPREFIXED_CITY_PROVINCES:Record<string,string>={
 "수원":"경기도","성남":"경기도","의정부":"경기도","안양":"경기도","부천":"경기도","광명":"경기도","평택":"경기도","동두천":"경기도","안산":"경기도","고양":"경기도","과천":"경기도","구리":"경기도","남양주":"경기도","오산":"경기도","시흥":"경기도","군포":"경기도","의왕":"경기도","하남":"경기도","용인":"경기도","파주":"경기도","이천":"경기도","안성":"경기도","김포":"경기도","화성":"경기도","광주":"경기도","양주":"경기도","포천":"경기도","여주":"경기도","연천":"경기도","가평":"경기도","양평":"경기도",
 "천안":"충청남도","공주":"충청남도","보령":"충청남도","아산":"충청남도","서산":"충청남도","논산":"충청남도","계룡":"충청남도","당진":"충청남도","금산":"충청남도","부여":"충청남도","서천":"충청남도","청양":"충청남도","홍성":"충청남도","예산":"충청남도","태안":"충청남도",
 "청주":"충청북도","충주":"충청북도","제천":"충청북도","보은":"충청북도","옥천":"충청북도","영동":"충청북도","증평":"충청북도","진천":"충청북도","괴산":"충청북도","음성":"충청북도","단양":"충청북도",
 "전주":"전라북도","군산":"전라북도","익산":"전라북도","정읍":"전라북도","남원":"전라북도","김제":"전라북도","완주":"전라북도","진안":"전라북도","무주":"전라북도","장수":"전라북도","임실":"전라북도","순창":"전라북도","고창":"전라북도","부안":"전라북도",
 "목포":"전라남도","여수":"전라남도","순천":"전라남도","나주":"전라남도","광양":"전라남도","담양":"전라남도","곡성":"전라남도","구례":"전라남도","고흥":"전라남도","보성":"전라남도","화순":"전라남도","장흥":"전라남도","강진":"전라남도","해남":"전라남도","영암":"전라남도","무안":"전라남도","함평":"전라남도","영광":"전라남도","장성":"전라남도","완도":"전라남도","진도":"전라남도","신안":"전라남도",
 "포항":"경상북도","경주":"경상북도","김천":"경상북도","안동":"경상북도","구미":"경상북도","영주":"경상북도","영천":"경상북도","상주":"경상북도","문경":"경상북도","경산":"경상북도","의성":"경상북도","청송":"경상북도","영양":"경상북도","영덕":"경상북도","청도":"경상북도","고령":"경상북도","성주":"경상북도","칠곡":"경상북도","예천":"경상북도","봉화":"경상북도","울진":"경상북도","울릉":"경상북도",
 "창원":"경상남도","진주":"경상남도","통영":"경상남도","사천":"경상남도","김해":"경상남도","밀양":"경상남도","거제":"경상남도","양산":"경상남도","의령":"경상남도","함안":"경상남도","창녕":"경상남도","고성":"경상남도","남해":"경상남도","하동":"경상남도","산청":"경상남도","함양":"경상남도","거창":"경상남도","합천":"경상남도",
 "춘천":"강원도","원주":"강원도","강릉":"강원도","동해":"강원도","태백":"강원도","속초":"강원도","삼척":"강원도","홍천":"강원도","횡성":"강원도","영월":"강원도","평창":"강원도","정선":"강원도","철원":"강원도","화천":"강원도","양구":"강원도","인제":"강원도","양양":"강원도"
};
const METRO_PROVINCES=["서울시","부산시","대구시","인천시","광주시","대전시","울산시","세종시"];
const parseArea=(area:string)=>{
 const parts=String(area||"").trim().split(/\s+/).filter(Boolean);
 const first=parts[0]||"",normalizedFirst=first.replace(/(시|군)$/,""),province=parts.length===1?(UNPREFIXED_CITY_PROVINCES[normalizedFirst]||PROVINCE_ALIASES[first]||PROVINCE_ALIASES[normalizedFirst]||first):(PROVINCE_ALIASES[first]||PROVINCE_ALIASES[normalizedFirst]||UNPREFIXED_CITY_PROVINCES[normalizedFirst]||first);
 if(!PROVINCES.includes(province))return {province:"",city:"",detail:""};
 if(METRO_PROVINCES.includes(province)){
  const districtPattern=province==="세종시"?/(구|군|읍|면|동)$/:/(구|군)$/;
  const district=parts.slice(1).find(token=>districtPattern.test(token))||"";
  return {province,city:"",detail:district};
 }
 const inferredUnprefixedCity=UNPREFIXED_CITY_PROVINCES[normalizedFirst]===province;
 const cityToken=parts.slice(1).find(token=>/(시|군)$/.test(token))||"";
 const city=first.startsWith("세종")?"세종시":(cityToken||(inferredUnprefixedCity?normalizedFirst+"시":(parts[1]&&!/(구|군|도|시)$/.test(parts[1])?parts[1]+"시":"")));
 const district=parts.slice(1).find(token=>/(구|군)$/.test(token)&&token!==cityToken)||"";
 return {province,city,detail:district};
};
const canonicalArea=(area:string)=>{
 const parsed=parseArea(area);
 if(parsed.province==="기타")return String(area||"").trim().replace(/\s+/g," ");
 return [parsed.province,parsed.city,parsed.detail].filter(Boolean).join(" ");
};
const districtOptionLabel=(area:string,citySelected:string)=>{const parsed=parseArea(area);const detail=parsed.detail||(parsed.province==="세종시"?"세종 전체":"시 전체");return citySelected==="전체"&&parsed.city?parsed.city+" "+detail:detail;};

const INITIAL: Region = {latitude:37.5665,longitude:126.9780,latitudeDelta:0.06,longitudeDelta:0.06};
const distanceKm=(lat1:number,lon1:number,lat2:number,lon2:number)=>{const rad=(n:number)=>n*Math.PI/180;const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));};
const COLORS = {ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F2ECFF",bg:"#FBF9FF",line:"#E9E2F2",white:"#FFFFFF",pink:"#F7EFFF"};

const sourceStatusMeta=(status?:string|null)=>{
  if(status==="both")return {label:"교육청 등록 확인",icon:"checkmark-circle" as const,color:"#18794E",bg:"#EAF6EF",description:"교육청 학원 정보와 지도 업체 정보가 함께 확인된 곳입니다."};
  if(status==="kakao_only")return {label:"등록 여부 미확인",icon:"location-outline" as const,color:"#666477",bg:"#F1F0F5",description:"지도 업체 정보는 확인됐지만 교육청 등록 정보와의 연결은 확인되지 않았습니다. 미등록을 의미하지 않습니다."};
  if(status==="neis_only")return {label:"교육청 등록 확인 · 위치 보완",icon:"business-outline" as const,color:"#5D4AA2",bg:"#F1ECFC",description:"교육청 등록 정보는 확인됐으며, 지도 업체 정보가 없어 등록 주소를 기준으로 위치를 표시합니다."};
  return null;
};

function Chip({label,active,onPress}: {label:string;active?:boolean;onPress:()=>void}) {
  const isDark=useColorScheme()==="dark";
  const styles=useMemo(()=>createStyles(isDark),[isDark]);
  return <Pressable onPress={onPress} style={[styles.chip,active&&styles.chipActive]}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{label}</Text></Pressable>;
}
export default function Home() {
 const isDark=useColorScheme()==="dark";
 const styles=useMemo(()=>createStyles(isDark),[isDark]);
  const router = useRouter();
  const routeParams = useLocalSearchParams<{studioId?:string;searchQuery?:string}>();
  const insets = useSafeAreaInsets();
  const map = useRef<KakaoMapHandle | null>(null);
  const [studios,setStudios]=useState<Studio[]>([]);
  const [backendState,setBackendState]=useState<"loading"|"connected"|"empty"|"error">(supabaseConfigured?"empty":"error");
  const [hasMapSearchRequested,setHasMapSearchRequested]=useState(false);
  const [backendErrorMessage,setBackendErrorMessage]=useState("학원 정보를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
  const [region,setRegion]=useState(INITIAL);
  const [mapMoved,setMapMoved]=useState(false);
  const [search,setSearch]=useState("");
 const [searchFocused,setSearchFocused]=useState(false);
 const [recentSearches,setRecentSearches]=useState<string[]>([]);
 const searchInputRef=useRef<TextInput|null>(null);
 const MAX_RECENT=10;
 const RECENT_SEARCH_KEY="recent_searches_v1";
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

  const [selectedListRegion,setSelectedListRegion]=useState("전체");
  const [rankMode,setRankMode]=useState<"views"|"favorites">("views");
  const [visibleListCount,setVisibleListCount]=useState(25);
  const [regionPickerOpen,setRegionPickerOpen]=useState(false);
  const [regionProvince,setRegionProvince]=useState("전체");
  const [regionCity,setRegionCity]=useState("전체");
  const [expandedProvince,setExpandedProvince]=useState<string|null>(null);
  const [expandedCity,setExpandedCity]=useState<string|null>(null);
  const [directoryAreas,setDirectoryAreas]=useState<string[]>([]);
  const [directoryStudios,setDirectoryStudios]=useState<Studio[]>([]);
  const [popularViewRank,setPopularViewRank]=useState<any[]>([]);
  const [favoriteRank,setFavoriteRank]=useState<any[]>([]);
  const [rankLoading,setRankLoading]=useState(false);
  const [selectedRankStudio,setSelectedRankStudio]=useState<Studio|null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const [isAdminUser,setIsAdminUser]=useState(false);
  const [isStudioOwner,setIsStudioOwner]=useState(false);
  const refreshAdminAccess=async()=>{
    setIsAdminUser(false);
    setIsStudioOwner(false);
    if(!supabase)return;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)return;
      const [adminResult,ownerResult]=await Promise.all([
        supabase.rpc("is_balletmate_admin"),
        supabase.from("studio_owners").select("studio_id").eq("user_id",session.user.id).limit(1)
      ]);
      setIsAdminUser(!adminResult.error&&adminResult.data===true);
      setIsStudioOwner(!ownerResult.error&&!!ownerResult.data?.length);
    }catch{
      setIsAdminUser(false);
      setIsStudioOwner(false);
    }
  };
  const [filterOpen,setFilterOpen]=useState(false);
  const [detailStudio,setDetailStudio]=useState<Studio|null>(null);
   const [failedRepresentativeImageUrl,setFailedRepresentativeImageUrl]=useState<string|null>(null);
  const [detailCanonicalLoading,setDetailCanonicalLoading]=useState(false);
  const [detailCanonicalError,setDetailCanonicalError]=useState<string|null>(null);
  const [reportOpen,setReportOpen]=useState(false);
  const [reportCategory,setReportCategory]=useState("기타");
  const [reportDescription,setReportDescription]=useState("");
  const [reportSubmitting,setReportSubmitting]=useState(false);
  const [studioClasses,setStudioClasses]=useState<StudioClass[]>([]);
  const [classesLoading,setClassesLoading]=useState(false);
  const [studioPublicPrices,setStudioPublicPrices]=useState<StudioPublicPrice[]>([]);
  const [studioPublicSchedules,setStudioPublicSchedules]=useState<StudioPublicSchedule[]>([]);
  const [studioOwnerNotices,setStudioOwnerNotices]=useState<any[]>([]);
  const [studioOwnerNoticesHasMore,setStudioOwnerNoticesHasMore]=useState(false);
  const [studioOwnerNoticesLoading,setStudioOwnerNoticesLoading]=useState(false);
  const studioOwnerNoticesOffset=useRef(0);
  const studioOwnerNoticesLoadingRef=useRef(false);
  const [studioCoupons,setStudioCoupons]=useState<StudioCoupon[]>([]);
  const [couponLoadState,setCouponLoadState]=useState<"idle"|"loading"|"available"|"none"|"unverified">("idle");
  const detailRequestId=useRef(0);
  const [detailExpanded,setDetailExpanded]=useState(false);
  const [detailContentError,setDetailContentError]=useState<string|null>(null);
  const [detailTab,setDetailTab]=useState<"home"|"notices"|"classes"|"reviews"|"photos">("home");
  const [detailShowTop,setDetailShowTop]=useState(false);
  const detailScrollRef=useRef<ScrollView|null>(null);
  const handleDetailScroll=useCallback((event:any)=>{const y=event?.nativeEvent?.contentOffset?.y??0;setDetailShowTop(y>420);},[]);
  const [detailInfoTab,setDetailInfoTab]=useState<"price"|"schedule">("price");
  const [studioReviews,setStudioReviews]=useState<any[]>([]);
  const [studioGalleryImages,setStudioGalleryImages]=useState<any[]>([]);
  const [failedGalleryImageIds,setFailedGalleryImageIds]=useState<string[]>([]);
  const [studioGalleryLoading,setStudioGalleryLoading]=useState(false);
  const [reviewsLoading,setReviewsLoading]=useState(false);
  const [reviewRating,setReviewRating]=useState(5);
  const [reviewText,setReviewText]=useState("");
  const [reviewSubmitting,setReviewSubmitting]=useState(false);
  const [reviewUserId,setReviewUserId]=useState<string|null>(null);
  const [reviewVerified,setReviewVerified]=useState(false);
  const [verifiedReviewsOnly,setVerifiedReviewsOnly]=useState(false);
  const [mapProvider,setMapProvider]=useState<"google"|"kakao"|null>(null);
  const [mapSettingsOpen,setMapSettingsOpen]=useState(false);
  const [pendingDirectionsStudio,setPendingDirectionsStudio]=useState<Studio|null>(null);
  const selectedStudioForGesture=useRef<Studio|null>(null);
  selectedStudioForGesture.current=selected;
  const openDetailAction=useRef<(studio:Studio)=>void>(()=>{});
  const selectedCardPan=useRef(PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onStartShouldSetPanResponderCapture:()=>false,
    onMoveShouldSetPanResponder:(_,gesture)=>gesture.dy < -12 && Math.abs(gesture.dy)>Math.abs(gesture.dx)*1.2,
    onMoveShouldSetPanResponderCapture:(_,gesture)=>gesture.dy < -12 && Math.abs(gesture.dy)>Math.abs(gesture.dx)*1.2,
    onPanResponderRelease:(_,gesture)=>{const studio=selectedStudioForGesture.current;if(gesture.dy < -45 && studio)openDetailAction.current(studio);},
    onPanResponderTerminationRequest:()=>true,
  })).current;
  const detailTabs=["home","notices","classes","reviews","photos"] as const;
  const detailSheetRef=useRef<BottomSheet|null>(null);
  useEffect(()=>{if(detailStudio)detailSheetRef.current?.snapToIndex(0);},[detailStudio?.id]);
  const detailTabRef=useRef(detailTab);detailTabRef.current=detailTab;
  useEffect(()=>{setDetailShowTop(false);detailScrollRef.current=null;},[detailTab,detailStudio?.id]);
  const changeDetailTabBySwipe=useCallback((dx:number)=>{
    const index=detailTabs.indexOf(detailTabRef.current);
    const next=Math.max(0,Math.min(detailTabs.length-1,index+(dx<0?1:-1)));
    if(next!==index)setDetailTab(detailTabs[next]);
  },[]);
  const detailHorizontalGesture=useMemo(()=>Gesture.Pan()
    .activeOffsetX([-24,24])
    .failOffsetY([-8,8])
    .maxPointers(1)
    .onEnd(event=>{
      const dx=event.translationX;
      if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(event.translationY)*1.4)return;
      runOnJS(changeDetailTabBySwipe)(dx);
    }),[changeDetailTabBySwipe]);
  useEffect(()=>{AsyncStorage.getItem("balletmate.mapProvider.v1").then(value=>{if(value==="google"||value==="kakao")setMapProvider(value);}).catch(()=>{});},[]);
  const saveStudioReview=async()=>{
    const client=supabase;
    if(!client)return;
    setReviewSubmitting(true);
    try{
      const {data:{session}}=await client.auth.getSession();
      if(!session){Alert.alert("로그인 필요","리뷰 작성은 로그인 후 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);return;}
      const {data:memberProfile,error:memberProfileError}=await client.from("user_profiles").select("display_name").eq("user_id",session.user.id).maybeSingle();
      if(memberProfileError)throw memberProfileError;
      if(!String(memberProfile?.display_name||"").trim()){Alert.alert("회원정보 등록 필요","리뷰를 작성하려면 회원정보 등록을 완료해 주세요.",[{text:"취소",style:"cancel"},{text:"등록하기",onPress:()=>router.push("/onboarding")}]);return;}
      const {error}=await client.from("studio_reviews").upsert({studio_id:detailStudio!.id,user_id:session.user.id,rating:reviewRating,content:reviewText.trim(),updated_at:new Date().toISOString()},{onConflict:"studio_id,user_id"});
      if(error)throw error;
      setReviewText("");
      const {data,error:loadError}=await client.from("studio_reviews").select("id,studio_id,user_id,rating,content,created_at,updated_at,verified_at").eq("studio_id",detailStudio!.id).order("created_at",{ascending:false}).limit(100);
      if(loadError)throw loadError;
      const {data:blocks}=await client.from("community_user_blocks").select("blocked_user_id").eq("blocker_id",session.user.id);
      const blockedIds=(blocks||[]).map((row:any)=>String(row.blocked_user_id));
      setStudioReviews((data||[]).filter((row:any)=>!blockedIds.includes(String(row.user_id))).sort((a:any,b:any)=>Number(!!b.verified_at)-Number(!!a.verified_at)));
      Alert.alert("리뷰 등록 완료","학원 리뷰가 등록되었습니다.");
    }catch(error:any){Alert.alert("리뷰 등록 실패",error?.message||"잠시 후 다시 시도해 주세요.");}
    finally{setReviewSubmitting(false);}
  };
  const startStudioReviewSubmission=async()=>{
    const client=supabase;
    if(!client){Alert.alert("리뷰","로그인이 필요한 기능입니다.");return;}
    const {data:{session}}=await client.auth.getSession();
    if(!session){Alert.alert("로그인 필요","리뷰 작성은 로그인 후 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);return;}
    const {data:acceptance,error}=await client.from("service_terms_acceptances").select("terms_version").eq("user_id",session.user.id).eq("terms_version","2026-11-26-ads-1").maybeSingle();
    if(error){Alert.alert("약관 확인 실패","서비스 이용약관 동의 정보를 확인할 수 없습니다. Supabase에 서비스 약관 SQL을 먼저 적용해 주세요.");return;}
    if(acceptance){await saveStudioReview();return;}
    Alert.alert("서비스 이용약관 동의","리뷰를 등록하거나 수정하려면 서비스 이용약관에 동의해야 합니다.",[
      {text:"취소",style:"cancel"},
      {text:"약관 보기",onPress:()=>router.push("/terms")},
      {text:"동의하고 리뷰 등록",onPress:async()=>{
        const {error:acceptError}=await client.from("service_terms_acceptances").insert({user_id:session.user.id,terms_version:"2026-11-26-ads-1"});
        if(acceptError&&acceptError.code!=="23505"){Alert.alert("동의 처리 실패",acceptError.message);return;}
        await saveStudioReview();
      }}
    ]);
  };
  const submitReviewReport=async(reviewId:string,reason:string)=>{if(!supabase){Alert.alert("로그인 필요","로그인 후 신고할 수 있습니다.");return;}const {data:{session}}=await supabase.auth.getSession();if(!session){Alert.alert("로그인 필요","로그인 후 신고할 수 있습니다.");return;}const {error}=await supabase.rpc("submit_studio_review_report",{p_review_id:reviewId,p_reason:reason,p_details:""});if(error)Alert.alert("신고 실패",error.message);else Alert.alert("신고 접수","신고가 접수되었습니다. 반복 신고가 확인되면 관리자 검토 전까지 리뷰가 숨김 처리됩니다.");};

  useEffect(()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId||detailTab!=="notices")return;
    let active=true;
    studioOwnerNoticesOffset.current=0;
    studioOwnerNoticesLoadingRef.current=false;
    setStudioOwnerNotices([]);
    setStudioOwnerNoticesHasMore(false);
    setStudioOwnerNoticesLoading(true);
    void (async()=>{
      try{
        const {data,error}=await client.from("studio_owner_notices").select("id,title,body,created_at,created_by")
          .eq("studio_id",studioId).eq("is_active",true).order("created_at",{ascending:false}).range(0,9);
        if(error)throw error;
        if(active){
          const rows=data||[];
          const ids=[...new Set(rows.map((row:any)=>row.created_by).filter(Boolean))];
          const profiles=ids.length?await client.rpc("get_public_member_profiles",{p_user_ids:ids}):{data:[],error:null};
          const profileMap=new Map<string,any>((profiles.data||[]).map((profile:any)=>[profile.user_id,profile]));
          setStudioOwnerNotices(rows.map((row:any)=>({...row,author_display_name:profileMap.get(row.created_by)?.display_name||null,author_avatar_url:profileMap.get(row.created_by)?.avatar_url||null})));
          studioOwnerNoticesOffset.current=rows.length;
          setStudioOwnerNoticesHasMore(rows.length===10);
        }
      }catch{if(active){setStudioOwnerNotices([]);setStudioOwnerNoticesHasMore(false);}}
      finally{if(active)setStudioOwnerNoticesLoading(false);}
    })();
    return()=>{active=false;};
  },[detailStudio?.id,detailTab]);

  const loadMoreStudioOwnerNotices=async()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId||detailTab!=="notices"||studioOwnerNoticesLoadingRef.current||!studioOwnerNoticesHasMore)return;
    studioOwnerNoticesLoadingRef.current=true;
    setStudioOwnerNoticesLoading(true);
    const from=studioOwnerNoticesOffset.current;
    try{
      const {data,error}=await client.from("studio_owner_notices").select("id,title,body,created_at,created_by")
        .eq("studio_id",studioId).eq("is_active",true).order("created_at",{ascending:false}).range(from,from+9);
      if(error)throw error;
      const rows=data||[];
      const ids=[...new Set(rows.map((row:any)=>row.created_by).filter(Boolean))];
      const profiles=ids.length?await client.rpc("get_public_member_profiles",{p_user_ids:ids}):{data:[],error:null};
      const profileMap=new Map<string,any>((profiles.data||[]).map((profile:any)=>[profile.user_id,profile]));
      setStudioOwnerNotices(current=>[...current,...rows.map((row:any)=>({...row,author_display_name:profileMap.get(row.created_by)?.display_name||null,author_avatar_url:profileMap.get(row.created_by)?.avatar_url||null}))]);
      studioOwnerNoticesOffset.current=from+rows.length;
      setStudioOwnerNoticesHasMore(rows.length===10);
    }catch(error){console.warn("Older studio notices could not be loaded:",error);}
    finally{studioOwnerNoticesLoadingRef.current=false;setStudioOwnerNoticesLoading(false);}
  };
  const [compareOpen,setCompareOpen]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<string[]>([]);
  const [favoriteStudios,setFavoriteStudios]=useState<Studio[]>([]);
  const [favoritesReady,setFavoritesReady]=useState(false);
  const guestFavoritesRef=useRef<{ids:string[];studios:Studio[]}>({ids:[],studios:[]});
  const [compareIds,setCompareIds]=useState<string[]>([]);
  const [compareCache,setCompareCache]=useState<Studio[]>([]);
  const [compareReady,setCompareReady]=useState(false);
  const [compareClassData,setCompareClassData]=useState<Record<string,StudioClass[]>>({});
  const [compareCouponStates,setCompareCouponStates]=useState<Record<string,"available"|"none"|"unverified">>({});
  const [comparePriceData,setComparePriceData]=useState<Record<string,StudioPublicPrice[]>>({});
  const [compareScheduleData,setCompareScheduleData]=useState<Record<string,StudioPublicSchedule[]>>({});
  const [compareClassLoading,setCompareClassLoading]=useState(false);
  const [compareMaterialError,setCompareMaterialError]=useState<string|null>(null);
  useFocusEffect(useCallback(()=>{
    const subscription=BackHandler.addEventListener("hardwareBackPress",()=>{
      if(mapSettingsOpen){setMapSettingsOpen(false);setPendingDirectionsStudio(null);return true;}
      if(menuOpen){setMenuOpen(false);return true;}
      if(compareOpen){setCompareOpen(false);return true;}
      if(regionPickerOpen){if(expandedCity){setExpandedCity(null);return true;}if(expandedProvince){setExpandedProvince(null);return true;}setRegionPickerOpen(false);return true;}
      if(filterOpen){setFilterOpen(false);return true;}
      if(detailStudio){detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);return true;}
      if(view!=="map"){setView("map");return true;}
      return false;
    });
    return()=>subscription.remove();
  },[mapSettingsOpen,menuOpen,compareOpen,regionPickerOpen,expandedProvince,expandedCity,filterOpen,detailStudio,view]));
  useEffect(()=>{
    if(!compareOpen||compareIds.length===0){setCompareMaterialError(null);return;}
    let active=true;
    setCompareMaterialError(null);
    setCompareClassLoading(true);
    Promise.all(compareIds.map(async id=>{
      const [classes,prices,coupons]=await Promise.all([
        fetchClassesForStudio(id),fetchStudioPublicPrices(id),
        fetchCouponsForStudio(id).then(rows=>({status:rows.length?"available" as const:"none" as const})).catch(()=>({status:"unverified" as const}))
      ]);
      return [id,{classes,prices,couponStatus:coupons.status}] as const;
    })).then(entries=>{
      if(!active)return;
      const records=Object.fromEntries(entries);
      setCompareClassData(Object.fromEntries(Object.entries(records).map(([id,value])=>[id,value.classes])));
      setComparePriceData(Object.fromEntries(Object.entries(records).map(([id,value])=>[id,value.prices])));
      setCompareCouponStates(Object.fromEntries(Object.entries(records).map(([id,value])=>[id,value.couponStatus])));
      setCompareScheduleData({});
    }).catch(error=>{
      if(active){
        console.warn("Comparison materials unavailable:",error);
        setCompareMaterialError("가격표 또는 수업 정보를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 비교 창을 다시 열어 주세요.");
      }
    })
      .finally(()=>{if(active)setCompareClassLoading(false);});
    return()=>{active=false;};
  },[compareOpen,compareIds]);
  const [adult,setAdult]=useState(false);
  const [kids,setKids]=useState(false);
  const [coupon,setCoupon]=useState(false);
  const [level,setLevel]=useState<string|null>(null);
  const [dayFilter,setDayFilter]=useState<string|null>(null);
  const [timeFilter,setTimeFilter]=useState<string|null>(null);

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
    if(!client||!studioId||detailTab!=="photos")return;
    let active=true;
    setStudioGalleryImages([]);setFailedGalleryImageIds([]);setStudioGalleryLoading(true);
    client.from("studio_gallery_images").select("id,image_path,created_at").eq("studio_id",studioId).eq("is_active",true).order("created_at",{ascending:false}).limit(60).then(({data,error})=>{
      if(!active)return;
      if(error){console.warn("Studio gallery unavailable:",error.message);setStudioGalleryImages([]);}
      else setStudioGalleryImages((data||[]).map((item:any)=>({...item,image_url:client.storage.from("studio-public-materials").getPublicUrl(item.image_path).data.publicUrl})));
      setStudioGalleryLoading(false);
    });
    return()=>{active=false;};
  },[detailStudio?.id,detailTab]);

  useEffect(()=>{
    const client=supabase;
    const studioId=detailStudio?.id;
    if(!client||!studioId||detailTab!=="reviews")return;
    let active=true;
    setReviewVerified(false);
    setReviewsLoading(true);
    (async()=>{
      try{
        const {data:authData}=await client.auth.getSession();
        const userId=authData.session?.user.id||null;
        if(active)setReviewUserId(userId);
        let blockedIds:string[]=[];
        if(userId){
          const {data:blocks,error:blockError}=await client.from("community_user_blocks").select("blocked_user_id").eq("blocker_id",userId);
          if(blockError)throw blockError;
          blockedIds=(blocks||[]).map((row:any)=>String(row.blocked_user_id));
          const {data:verification,error:verificationError}=await client.from("studio_review_verifications").select("verified_at").eq("studio_id",studioId).eq("user_id",userId).maybeSingle();
          if(active)setReviewVerified(!verificationError&&!!verification?.verified_at);
        }else if(active)setReviewVerified(false);
        const {data,error}=await client.from("studio_reviews")
          .select("id,studio_id,user_id,rating,content,created_at,updated_at,verified_at")
          .eq("studio_id",studioId).order("created_at",{ascending:false}).limit(100);
        if(!active)return;
        if(error)throw error;
        const rows=(data||[]).filter((row:any)=>!blockedIds.includes(String(row.user_id)));
        setStudioReviews(rows.sort((a:any,b:any)=>Number(!!b.verified_at)-Number(!!a.verified_at)));
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

  const hasClassLevelFilters=!!(adult||kids||classTypeFilter||level||dayFilter||timeFilter||durationFilter!==null);
  useEffect(()=>{
    if(!supabase||!hasClassLevelFilters){setClassFilterIds([]);setClassFilterLoading(false);return;}
    let active=true;
    const timer=setTimeout(()=>{
      setClassFilterLoading(true);
      searchStudiosByClassFilters({
        audiences:[adult?"adult":null,kids?"kids":null].filter((value):value is "adult"|"kids"=>value!==null),
        classType:classTypeFilter,level,weekdayGroup:dayFilter as "평일"|"주말"|null,
        timeOfDay:timeFilter as "오전"|"오후"|"저녁"|null,
        durationMinutes:durationFilter,
      }).then(ids=>{if(active)setClassFilterIds(ids);})
        .catch(error=>{if(active){setClassFilterIds([]);console.warn("Class filter search failed:",error);}})
        .finally(()=>{if(active)setClassFilterLoading(false);});
    },250);
    return()=>{active=false;clearTimeout(timer);};
  },[adult,kids,classTypeFilter,level,dayFilter,timeFilter,durationFilter,hasClassLevelFilters]);

  // Class-name keyword lookup runs only after explicit search submission.
  // Typing must stay local so each keystroke cannot trigger a database request.

  const globalSearchIdSet=useMemo(()=>new Set(globalSearchStudios.map(studio=>studio.id)),[globalSearchStudios]);
  const normalizedSearch=search.trim().toLowerCase();
  const classSearchIdSet=useMemo(()=>new Set(classSearchIds),[classSearchIds]);
  const classFilterIdSet=useMemo(()=>new Set(classFilterIds),[classFilterIds]);
  const mergedStudios=useMemo(()=>[...new Map([...studios,...globalSearchStudios].map(studio=>[studio.id,studio])).values()],[studios,globalSearchStudios]);
  const results=useMemo(()=>mergedStudios.filter(s=>{
    if(normalizedSearch && !globalSearchIdSet.has(s.id) && !s.name.toLowerCase().includes(normalizedSearch) && !s.area.toLowerCase().includes(normalizedSearch) && !s.tags.some(t=>t.toLowerCase().includes(normalizedSearch)) && !classSearchIdSet.has(s.id)) return false;
    if((adult||kids)&&!((adult&&s.adult)||(kids&&s.kids)))return false;
    if(coupon&&!s.coupon)return false;
    if(hasClassLevelFilters&&!classFilterIdSet.has(s.id))return false;
    if(level&&!s.level.includes(level))return false;
    if(dayFilter&&!s.days.includes(dayFilter))return false;
    if(timeFilter&&!s.time.includes(timeFilter))return false;

    if(durationFilter!==null&&!(s.classDurations?.length?s.classDurations.includes(durationFilter):s.duration===durationFilter))return false;
    if(maxDistance!==null&&distanceKm(searchedRegion.latitude,searchedRegion.longitude,s.lat,s.lng)>maxDistance)return false;
    if(areaLocked){
      const latSpan=searchedRegion.latitudeDelta/2;
      const lngSpan=searchedRegion.longitudeDelta/2;
      if(Math.abs(s.lat-searchedRegion.latitude)>latSpan||Math.abs(s.lng-searchedRegion.longitude)>lngSpan)return false;
    }
    return true;
  }),[mergedStudios,globalSearchIdSet,normalizedSearch,classSearchIdSet,adult,kids,coupon,level,dayFilter,timeFilter,durationFilter,hasClassLevelFilters,classFilterIdSet,maxDistance,areaLocked,searchedRegion]);

  const mapMarkers=useMemo(()=>results.map(studio=>({id:studio.id,name:studio.name,area:studio.area,latitude:studio.lat,longitude:studio.lng})),[results]);
  const searchedStudioIds=useMemo(()=>searchMatches.map(item=>item.id),[searchMatches]);
  const handleMapRegionChange=useCallback((next:Region)=>{areaSearchRequestId.current++;searchSubmitRequestId.current++;setSearchSubmitting(false);setRegion(next);setMapMoved(true);},[]);
  const handleMapMarkerPress=useCallback((id:string)=>{const studio=results.find(item=>item.id===id);if(studio)setSelected(studio);},[results]);
  const allListAreas=useMemo(()=>[...new Set([...directoryAreas,...studios.map(studio=>studio.area)].filter(area=>area&&area!=="지역 정보 없음").map(canonicalArea))].sort((a,b)=>a.localeCompare(b,"ko")),[directoryAreas,studios]);
  useEffect(()=>{let active=true;fetchStudios().then(rows=>{if(active){setDirectoryAreas([...new Set(rows.map(row=>row.district||"").filter(Boolean))]);setDirectoryStudios(rows.map(mapStudioRecord));}}).catch(error=>console.warn("전체 지역 목록 조회 실패:",error));return()=>{active=false;};},[]);
  const listDistricts=useMemo(()=>allListAreas.filter(area=>{const parsed=parseArea(area);return PROVINCES.includes(parsed.province)&&(regionProvince==="전체"||parsed.province===regionProvince)&&(regionCity==="전체"||parsed.city===regionCity);}),[allListAreas,regionProvince,regionCity]);
  const regionGroups=useMemo(()=>{
    const groups:{province:string;cities:{city:string;areas:string[]}[]}[]=[];
    const byProvince=new Map<string,{province:string;cities:{city:string;areas:string[]}[]}>();
    for(const area of listDistricts){
      const parsed=parseArea(area);
      let provinceGroup=byProvince.get(parsed.province);
      if(!provinceGroup){provinceGroup={province:parsed.province,cities:[]};byProvince.set(parsed.province,provinceGroup);groups.push(provinceGroup);}
      const cityGroup=provinceGroup.cities.find(item=>item.city===parsed.city);
      if(cityGroup)cityGroup.areas.push(area);
      else provinceGroup.cities.push({city:parsed.city,areas:[area]});
    }
    const provinceOrder=PROVINCES;
    groups.sort((a,b)=>provinceOrder.indexOf(a.province)-provinceOrder.indexOf(b.province));
    for(const group of groups)group.cities.sort((a,b)=>a.city.localeCompare(b.city,"ko"));
    return groups;
  },[listDistricts]);
  const handleRegionPickerBack=()=>{
    if(expandedCity){
      if(expandedCity==="__districts__"){
        setExpandedCity(null);setExpandedProvince(null);setRegionProvince("전체");setRegionCity("전체");
      }else{setExpandedCity(null);setRegionCity("전체");}
      return;
    }
    if(expandedProvince){setExpandedProvince(null);setRegionProvince("전체");setRegionCity("전체");return;}
    setRegionPickerOpen(false);
  };
  const directoryResults=useMemo(()=>[...new Map([...directoryStudios,...globalSearchStudios].map(studio=>[studio.id,studio])).values()].filter(s=>{
    if(normalizedSearch&&!globalSearchIdSet.has(s.id)&&!s.name.toLowerCase().includes(normalizedSearch)&&!s.area.toLowerCase().includes(normalizedSearch)&&!s.tags.some(t=>t.toLowerCase().includes(normalizedSearch))&&!classSearchIdSet.has(s.id))return false;
    if((adult||kids)&&!((adult&&s.adult)||(kids&&s.kids)))return false;
    if(coupon&&!s.coupon)return false;
    if(hasClassLevelFilters&&!classFilterIdSet.has(s.id))return false;
    if(level&&!s.level.includes(level))return false;
    if(dayFilter&&!s.days.includes(dayFilter))return false;
    if(timeFilter&&!s.time.includes(timeFilter))return false;
    if(durationFilter!==null&&!(s.classDurations?.length?s.classDurations.includes(durationFilter):s.duration===durationFilter))return false;
    if(maxDistance!==null&&distanceKm(searchedRegion.latitude,searchedRegion.longitude,s.lat,s.lng)>maxDistance)return false;
    return true;
  }),[directoryStudios,globalSearchStudios,normalizedSearch,globalSearchIdSet,classSearchIdSet,adult,kids,coupon,hasClassLevelFilters,classFilterIdSet,level,dayFilter,timeFilter,durationFilter,maxDistance,searchedRegion]);
  const listRows=useMemo(()=>{
    const rows=view==="favorites"?favoriteStudios:directoryResults.filter(studio=>selectedListRegion!=="전체"?canonicalArea(studio.area)===selectedListRegion:(regionProvince==="전체"||parseArea(studio.area).province===regionProvince)&&(regionCity==="전체"||parseArea(studio.area).city===regionCity));
    return [...rows].sort((a,b)=>distanceKm(searchedRegion.latitude,searchedRegion.longitude,a.lat,a.lng)-distanceKm(searchedRegion.latitude,searchedRegion.longitude,b.lat,b.lng));
  },[view,favoriteStudios,directoryResults,searchedRegion,selectedListRegion,regionProvince,regionCity]);
   const visibleListRows=useMemo(()=>listRows.slice(0,visibleListCount),[listRows,visibleListCount]);
   useEffect(()=>{setVisibleListCount(25);},[view,selectedListRegion,regionProvince,regionCity,search,adult,kids,coupon,hasClassLevelFilters,level,dayFilter,timeFilter,durationFilter,maxDistance]);
   const loadMoreListRows=useCallback(()=>{setVisibleListCount(current=>Math.min(current+25,listRows.length));},[listRows.length]);
  useEffect(()=>{
    if(view!=="list"||!supabase)return;
    let active=true;setRankLoading(true);
    Promise.all([
      supabase.rpc("get_studio_popular_views_rank",{p_region:selectedListRegion}),
      supabase.rpc("get_studio_favorite_rank",{p_region:selectedListRegion})
    ]).then(([viewsRes,favoritesRes])=>{
      if(!active)return;
      setPopularViewRank(viewsRes.error?[]:(viewsRes.data||[]).filter((r:any)=>selectedListRegion!=="전체"||((regionProvince==="전체"||parseArea(directoryStudios.find(studio=>studio.id===r.studio_id)?.area||"").province===regionProvince)&&(regionCity==="전체"||parseArea(directoryStudios.find(studio=>studio.id===r.studio_id)?.area||"").city===regionCity))));
      setFavoriteRank(favoritesRes.error?[]:(favoritesRes.data||[]).filter((r:any)=>selectedListRegion!=="전체"?canonicalArea(directoryStudios.find(studio=>studio.id===r.studio_id)?.area||"")===selectedListRegion:((regionProvince==="전체"||parseArea(directoryStudios.find(studio=>studio.id===r.studio_id)?.area||"").province===regionProvince)&&(regionCity==="전체"||parseArea(directoryStudios.find(studio=>studio.id===r.studio_id)?.area||"").city===regionCity))));
    }).finally(()=>{if(active)setRankLoading(false);});
    return()=>{active=false;};
  },[view,selectedListRegion,regionProvince,regionCity,studios,directoryStudios]);
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
  const loadRecentSearches=useCallback(async()=>{
    try{
      const current=await AsyncStorage.getItem(RECENT_SEARCH_KEY);
      const legacy=current===null?await AsyncStorage.getItem("recent_searches"):null;
      const parsed=JSON.parse(current??legacy??"[]");
      const values=Array.isArray(parsed)?parsed.filter((item:any)=>typeof item==="string"&&item.trim()).map((item:string)=>item.trim()):[];
      const unique=[...new Set(values)].slice(0,MAX_RECENT);
      setRecentSearches(unique);
      if(current===null&&unique.length)await AsyncStorage.setItem(RECENT_SEARCH_KEY,JSON.stringify(unique));
    }catch{setRecentSearches([]);}
  },[]);
  const saveRecentSearch=useCallback(async(keyword:string)=>{
    const normalized=keyword.trim();
    if(!normalized)return;
    const prev=await AsyncStorage.getItem(RECENT_SEARCH_KEY);
    const parsed=JSON.parse(prev||"[]");
    const values=Array.isArray(parsed)?parsed.filter((item:any)=>typeof item==="string"):[];
    const next=[normalized,...values.filter((item:string)=>item!==normalized)].slice(0,MAX_RECENT);
    await AsyncStorage.setItem(RECENT_SEARCH_KEY,JSON.stringify(next));
    setRecentSearches(next);
  },[]);
  const deleteRecentSearch=async(keyword:string)=>{
    const next=recentSearches.filter(item=>item!==keyword);
    setRecentSearches(next);
    await AsyncStorage.setItem(RECENT_SEARCH_KEY,JSON.stringify(next)).catch(()=>{});
  };
  const clearAllRecent=()=>{
    Alert.alert("최근 검색어 전체 삭제","저장된 검색어를 모두 삭제할까요?",[
      {text:"취소",style:"cancel"},
      {text:"전체 삭제",style:"destructive",onPress:()=>{
        setRecentSearches([]);
        void AsyncStorage.removeItem(RECENT_SEARCH_KEY);
        void AsyncStorage.removeItem("recent_searches");
      }}
    ]);
  };
  const openSearchOverlay=()=>{
    setSearchFocused(true);
    void loadRecentSearches();
    setTimeout(()=>searchInputRef.current?.focus(),100);
  };
  const closeSearchOverlay=()=>{
    Keyboard.dismiss();
    setSearchFocused(false);
  };
  useEffect(()=>{
    if(!searchFocused)return;
    const subscription=BackHandler.addEventListener("hardwareBackPress",()=>{closeSearchOverlay();return true;});
    return()=>subscription.remove();
  },[searchFocused]);
  const submitSearch=async(queryOverride?:string)=>{
    if(searchSubmitting)return;
    const requestId=++searchSubmitRequestId.current;
    setSearchSubmitting(true);
    Keyboard.dismiss();
    const query=(queryOverride??search).trim();
    if(queryOverride!==undefined)setSearch(query);
    if(!query){setAreaLocked(false);setSelected(null);setGlobalSearchStudios([]);setSearchSubmitting(false);return;}
    try{await saveRecentSearch(query);}catch(error){console.warn("Recent search save failed:",error);}

    const q=query.toLowerCase();
    const regionKey=Object.keys(REGIONAL_SEARCH).sort((a,b)=>b.length-a.length).find(key=>q.includes(key));
    let remoteRows:any[]=[];
    let kakaoSearchFailure:any|null=null;
    if(supabase&&query.length>=2){
      // Use Kakao only when the database has no confident name/address match.
      // This preserves discovery for unknown academies while avoiding duplicate provider calls.
      const dbRows=await searchStudiosByName(query).catch(error=>{
        console.warn("Database studio search failed:",error);
        return [] as any[];
      });
      const normalizedQuery=query.toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_/-]/g,"");
      const hasConfidentDbMatch=dbRows.some((row:any)=>{
        const name=String(row?.name||"").toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_/-]/g,"");
        const address=String(row?.address||"").toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_/-]/g,"");
        return name.length>=2&&(name.includes(normalizedQuery)||normalizedQuery.includes(name))||
          address.length>=3&&address.includes(normalizedQuery);
      });
      const kakaoResult=hasConfidentDbMatch
        ? {rows:[] as any[],error:null as string|null}
        : await searchStudiosByKakao(query).then(rows=>({rows,error:null as string|null})).catch(error=>{
            console.warn("Kakao studio search failed:",error);
            return {rows:[] as any[],error};
          });
      kakaoSearchFailure=kakaoResult.error;
      const byId=new Map<string,any>();
      [...dbRows,...kakaoResult.rows].forEach(row=>{if(row?.id)byId.set(String(row.id),row);});
      remoteRows=[...byId.values()];
      if(requestId!==searchSubmitRequestId.current)return;
    }
    const mapped:Studio[]=remoteRows.map(mapStudioRecord);
    setGlobalSearchStudios(mapped);
    let matchingClassIds=classSearchIds;
    if(!mapped.length&&supabase&&query.length>=2){try{matchingClassIds=await searchStudioIdsByClassName(query);if(requestId!==searchSubmitRequestId.current)return;setClassSearchIds(matchingClassIds);}catch{}}
    if(requestId!==searchSubmitRequestId.current)return;
    const matching=[...new Map([...mapped,...studios.filter(studio=>studio.name.toLowerCase().includes(q)||String(studio.address||"").toLowerCase().includes(q)||studio.area.toLowerCase().includes(q))].filter(studio=>!isExcludedStudioSearchResult(studio.name)).map(studio=>[studio.id,studio])).values()];
    if(!matching.length&&kakaoSearchFailure&&!regionKey){
      const userMessage=getKakaoSearchErrorMessage(kakaoSearchFailure);
      Alert.alert(userMessage.title,userMessage.message);
      setSearchSubmitting(false);
      return;
    }
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
  const submitSearchRef=useRef(submitSearch);submitSearchRef.current=submitSearch;
  useFocusEffect(useCallback(()=>{
    let active=true;
    void AsyncStorage.getItem("balletmate.pending_search_query").then(async keyword=>{
      if(!active||!keyword?.trim())return;
      await AsyncStorage.removeItem("balletmate.pending_search_query");
      setSearch(keyword.trim());
      setSearchSubmitting(false);
      setTimeout(()=>{if(active)void submitSearchRef.current(keyword.trim());},80);
    }).catch(()=>{});
    return()=>{active=false;};
  },[]));
  const locate=async()=>{
    setLocationLoading(true);
    try {
      const permission=await Location.requestForegroundPermissionsAsync();
      if(permission.status!=="granted"){
        setLocationGranted(false);
        if(!permission.canAskAgain){
          Alert.alert(
            "위치 권한이 차단되어 있어요",
            "기기 설정에서 발레메이트의 위치 권한을 허용한 뒤 다시 시도해 주세요.",
            [{text:"취소",style:"cancel"},{text:"설정 열기",onPress:()=>{void Linking.openSettings();}}]
          );
        }else{
          Alert.alert("위치 권한 필요","현재 위치로 지도를 이동하려면 위치 권한을 허용해 주세요. 위치 버튼을 다시 눌러 권한을 요청할 수 있습니다.");
        }
        return;
      }
      const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      const r={latitude:p.coords.latitude,longitude:p.coords.longitude,latitudeDelta:0.035,longitudeDelta:0.035};
      setHasMapSearchRequested(true);
      setPendingMapTarget(r);setRegion(r);setSearchedRegion(r);setAreaLocked(false);setLocationGranted(true);setCurrentLocation({latitude:p.coords.latitude,longitude:p.coords.longitude});setMapMoved(false);
      // pendingMapTarget effect sends the single map movement command.
    } catch { Alert.alert("위치 확인 실패","현재 위치를 가져오지 못했습니다. 위치 서비스 설정을 확인하거나 지도를 직접 이동해 이용해주세요."); }
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
    let syncVersion=0;
    let syncingUid:string|null=null;
    const syncForSession=async(session:any)=>{
      const uid=session?.user?.id||null;
      const requestVersion=++syncVersion;
      if(!uid){
        syncingUid=null;
        favoriteSyncUser.current=null;
        setFavoriteIds(guestFavoritesRef.current.ids);
        setFavoriteStudios(guestFavoritesRef.current.studios);
        return;
      }
      if(favoriteSyncUser.current===uid||syncingUid===uid)return;
      syncingUid=uid;
      favoriteSyncUser.current=null;
      const isCurrent=()=>active&&requestVersion===syncVersion;
      try{
        const {data:memberProfile,error:profileError}=await client.from("user_profiles").select("display_name").eq("user_id",uid).maybeSingle();
        if(!isCurrent())return;
        if(profileError)throw profileError;
        if(!String(memberProfile?.display_name||"").trim())return;
        const {data:remote,error}=await client.from("user_favorites").select("studio_id,studio_snapshot").eq("user_id",uid);
        if(!isCurrent())return;
        if(error)throw error;
        const remoteRows=remote||[];
        const remoteStudios=remoteRows.map((r:any)=>r.studio_snapshot).filter((s:any)=>s&&typeof s.id==="string");
        const remoteIds=[...new Set(remoteRows.map((r:any)=>r.studio_id).filter((id:any)=>typeof id==="string"))];
        const remoteIdSet=new Set(remoteIds);
        const localStudios=guestFavoritesRef.current.studios;
        const localIds=guestFavoritesRef.current.ids;
        const mergedIds=[...new Set([...remoteIds,...localIds])];
        const mergedStudios=[...remoteStudios,...localStudios.filter((studio:any)=>!remoteIdSet.has(studio.id))];
        favoriteSyncUser.current=uid;
        setFavoriteStudios(mergedStudios);
        setFavoriteIds(mergedIds);
        const localRows=localStudios.filter((studio:any)=>!remoteIdSet.has(studio.id)).map((studio:any)=>({
          user_id:uid,studio_id:studio.id,studio_snapshot:studio,updated_at:new Date().toISOString(),
        }));
        if(localRows.length){
          const {error:mergeError}=await client.from("user_favorites").upsert(localRows,{onConflict:"user_id,studio_id"});
          if(!isCurrent())return;
          if(mergeError)console.warn("Guest favorite merge skipped:",mergeError);
        }
      }catch(e){
        if(isCurrent()){
          favoriteSyncUser.current=null;
          console.warn("Favorite sync skipped:",e);
        }
      }finally{
        if(syncingUid===uid)syncingUid=null;
      }
    };
    client.auth.getSession().then(({data})=>{if(active)void syncForSession(data.session);});
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{void syncForSession(session);});
    return()=>{active=false;syncVersion++;subscription.unsubscribe();};
  },[favoritesReady]);

  useEffect(()=>{if(!supabaseConfigured||!hasMapSearchRequested)return;let mounted=true;setBackendState("loading");setBackendErrorMessage("");fetchStudios(searchedRegion).then(rows=>{if(!mounted)return;const mapped:Studio[]=rows.map(mapStudioRecord);setStudios(mapped);setBackendState(mapped.length?"connected":"empty");}).catch((error:any)=>{if(mounted){setStudios([]);setBackendState("error");setBackendErrorMessage(getStudioLoadErrorMessage(error));}});return()=>{mounted=false;};},[searchedRegion,hasMapSearchRequested]);
  const searchArea=async()=>{
    const requestId=++areaSearchRequestId.current;
    const target=region;
    setHasMapSearchRequested(true);
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
        const userMessage=getKakaoSearchErrorMessage(error);
        Alert.alert(userMessage.title,userMessage.message);
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
  const activeFilters=(adult?1:0)+(kids?1:0)+(coupon?1:0)+(level?1:0)+(dayFilter?1:0)+(timeFilter?1:0)+(durationFilter!==null?1:0)+(classTypeFilter?1:0)+(maxDistance!==null?1:0);
  const toggleCompare=useCallback((studio:Studio)=>{
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
  },[compareIds]);
  const toggleFavorite=useCallback((studio:Studio)=>{
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
  },[favoriteIds,favoriteStudios]);
  const resetFilters=()=>{setAdult(false);setKids(false);setCoupon(false);setLevel(null);setDayFilter(null);setTimeFilter(null);setDurationFilter(null);setClassTypeFilter(null);setMaxDistance(null);};
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
    setDetailStudio(s);
    setDetailContentError(null);
    setDetailCanonicalError(null);
    setDetailCanonicalLoading(!!supabaseConfigured);
    setStudioClasses([]);
    setStudioPublicPrices([]);
    setStudioPublicSchedules([]);
    setStudioOwnerNotices([]);
    setStudioCoupons([]);
    setCouponLoadState(supabaseConfigured?"loading":"unverified");
    if(supabaseConfigured){
      setClassesLoading(true);
      retryDetailRequest(()=>fetchStudioById(s.id)).then(row=>{
        if(requestId!==detailRequestId.current)return;
        if(row){setDetailStudio(mapStudioRecord(row));setDetailCanonicalError(null);}
        else setDetailCanonicalError("학원 정보를 찾지 못했습니다. 다시 시도해 주세요.");
      }).catch((error:any)=>{
        if(requestId===detailRequestId.current){
          setDetailCanonicalError(error?.message||"학원 정보를 불러오지 못했습니다.");
          console.warn("Canonical studio detail lookup failed:",error);
        }
      }).finally(()=>{if(requestId===detailRequestId.current)setDetailCanonicalLoading(false);});
      retryDetailRequest(()=>fetchClassesForStudio(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioClasses(rows);})
        .catch(error=>{console.warn("Studio classes unavailable:",error);if(requestId===detailRequestId.current)setStudioClasses([]);})
        .finally(()=>{if(requestId===detailRequestId.current)setClassesLoading(false);});
      retryDetailRequest(()=>fetchStudioPublicPrices(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioPublicPrices(rows);})
        .catch(error=>{console.warn("Approved studio prices unavailable:",error);if(requestId===detailRequestId.current){setStudioPublicPrices([]);setDetailContentError("가격표 자료를 불러오지 못했습니다.");}});
      retryDetailRequest(()=>fetchStudioPublicSchedules(s.id)).then(rows=>{if(requestId===detailRequestId.current)setStudioPublicSchedules(rows);})
        .catch(error=>{console.warn("Approved studio schedules unavailable:",error);if(requestId===detailRequestId.current){setStudioPublicSchedules([]);setDetailContentError("시간표 자료를 불러오지 못했습니다.");}});
      retryDetailRequest(()=>fetchCouponsForStudio(s.id)).then(rows=>{if(requestId===detailRequestId.current){setStudioCoupons(rows);setCouponLoadState(rows.length?"available":"none");}})
        .catch(error=>{console.warn("Studio coupons unavailable:",error);if(requestId===detailRequestId.current){setStudioCoupons([]);setCouponLoadState("unverified");}});
    }
  };
  openDetailAction.current=openDetail;
    const cleanScheduleDisplay=(value:string)=>String(value||"").replace(/\s*(오픈\s*예정|개강\s*예정|모집\s*예정|모집\s*중|신설\s*예정)\s*$/g,"").trim();
  const studioCard=useCallback((s:Studio,compact=false)=><Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.name} 학원 상세 보기`} onPress={()=>{setSelected(s);setView("map");const target={latitude:s.lat,longitude:s.lng,latitudeDelta:0.018,longitudeDelta:0.018};setPendingMapTarget(target);setRegion(target);if(!studios.some(x=>x.id===s.id)){setSearchedRegion(target);setAreaLocked(false);}}} style={[styles.studioCard,compact&&styles.compactCard,{backgroundColor:isDark?"#24242A":"#FFFFFF",borderColor:isDark?"#3A3A42":"#E8E6ED"},selected?.id===s.id&&{backgroundColor:isDark?"#2B2B32":"#EAEAEF",borderColor:isDark?"#4A4A53":"#D5D5DC"},searchMatches.some(item=>item.id===s.id)&&{backgroundColor:isDark?"#292930":"#EEEEF1"},compareIds.includes(s.id)&&{backgroundColor:isDark?"#292930":"#EEEEF1"}]}>
    <View style={styles.cardTop}><View style={[styles.studioIcon,compact&&{width:64,height:64},{backgroundColor:isDark?"#18181D":"#E5E5EA"}]}>{s.representativeImageUrl?<Image source={{uri:s.representativeImageUrl}} style={[styles.studioThumb,compact&&{width:64,height:64}]} resizeMode="cover"/>:<MaterialCommunityIcons name="human-female-dance" size={28} color={isDark?"#E7E7EC":"#686875"}/>}</View><View style={{flex:1,minWidth:0}}><View style={{flexDirection:"row",alignItems:"center",gap:7,minWidth:0}}><Text style={[styles.studioName,{flex:1,minWidth:0}]} numberOfLines={2}>{s.name}</Text><View style={{flexDirection:"row",alignItems:"center",gap:4,flexShrink:0}}><Pressable onPress={e=>{e.stopPropagation();toggleFavorite(s);}} hitSlop={4} style={{width:44,height:44,alignItems:"center",justifyContent:"center",borderRadius:12}} accessibilityRole="button" accessibilityLabel={favoriteIds.includes(s.id)?"찜 해제":"찜하기"} accessibilityState={{selected:favoriteIds.includes(s.id)}}><Ionicons name={favoriteIds.includes(s.id)?"heart":"heart-outline"} size={24} color={favoriteIds.includes(s.id)?"#E64B72":COLORS.purple}/></Pressable><Pressable onPress={e=>{e.stopPropagation();toggleCompare(s);}} hitSlop={4} style={{width:44,height:44,alignItems:"center",justifyContent:"center",borderRadius:12}} accessibilityRole="button" accessibilityLabel={compareIds.includes(s.id)?"비교에서 제외":"비교에 추가"} accessibilityState={{selected:compareIds.includes(s.id)}}><Ionicons name={compareIds.includes(s.id)?"checkmark-circle":"swap-horizontal-outline"} size={25} color={compareIds.includes(s.id)?"#15966A":COLORS.purple}/></Pressable></View></View><View style={{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:6,marginTop:3}}><Text style={styles.studioArea}>{s.area} · {s.rating>0?"⭐ "+s.rating.toFixed(1):"평점 미등록"}</Text>{s.coupon&&<View style={styles.couponBadge}><Text style={styles.couponText}>쿠폰</Text></View>}</View></View></View>
    {s.description&&s.description!=="등록된 소개가 없습니다."&&<Text numberOfLines={2} ellipsizeMode="tail" style={{fontSize:11,lineHeight:16,color:isDark?"#B9B9C2":"#66636F",marginTop:8}}>{cleanPublicText(s.description)}</Text>}
    {s.tags.length>0&&<View style={styles.tagsRow}>{s.tags.slice(0,2).map(t=><View key={t} style={[styles.tag,{backgroundColor:isDark?"#34343B":"#E5E5EA"}]}><Text style={[styles.tagText,{color:isDark?"#D5D5DC":"#555560"}]}>{t}</Text></View>)}</View>}
    {(s.duration>0||!!s.time)&&<View style={[styles.cardBottom,{marginTop:s.tags.length?8:6}]}><Text style={styles.metaText}>{[s.duration>0?s.duration+"분":null,s.time||null].filter(Boolean).join(" · ")}</Text></View>}
  </Pressable>,[studios,favoriteIds,compareIds,toggleFavorite,toggleCompare,router,styles,selected,searchMatches,isDark]);
  const renderStudioListItem=useCallback(({item}:{item:Studio})=>studioCard(item),[studioCard]);

  useEffect(()=>{const id=String(routeParams.studioId||"");if(!id||!supabaseConfigured)return;let active=true;fetchStudioById(id).then(row=>{if(active&&row)openDetail(mapStudioRecord(row));}).catch(error=>console.warn("Review destination lookup failed:",error));return()=>{active=false;};},[routeParams.studioId]);
  useEffect(()=>{
    if(Platform.OS!=="android")return;
    let active=true;
    const prompt=async()=>{
      try{
        const key="balletmate.reviewPrompt.lastShown.v1";
        const last=Number(await AsyncStorage.getItem(key)||0);
        if(Date.now()-last<30*24*60*60*1000||Math.random()>0.16)return;
        await new Promise(resolve=>setTimeout(resolve,45000));
        if(!active)return;
        await AsyncStorage.setItem(key,String(Date.now()));
        Alert.alert("Balletmate 이용 경험","발레 생활을 더 편리하게 이용하고 계신가요? Play 스토어에서 솔직한 의견을 들려주세요.",[
          {text:"나중에",style:"cancel"},
          {text:"평가하기",onPress:()=>{void Linking.openURL("https://play.google.com/store/apps/details?id=com.dlehdrb554.balletmate").catch(()=>Alert.alert("스토어 연결","Play 스토어에서 Balletmate를 검색해 주세요."));}}
        ]);
      }catch{}
    };
    void prompt();
    return()=>{active=false;};
  },[]);


  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}>
    <View style={styles.header}>
      <Text style={styles.brand}>balletmate <Text style={styles.brandDot}>✦</Text></Text>
      <View style={styles.headerActions}><Pressable style={[styles.menuButton,{width:44,height:44,backgroundColor:isDark?"#24212C":"#FFFFFF",borderColor:isDark?"#514568":COLORS.line}]} onPress={()=>{setMenuOpen(true);refreshAdminAccess();}} accessibilityRole="button" accessibilityLabel="메뉴 열기"><Ionicons name="menu-outline" size={23} color={isDark?"#FFFFFF":COLORS.ink} /></Pressable><Pressable style={[styles.profileButton,{width:44,height:44,backgroundColor:isDark?"#24212C":"#FFFFFF",borderColor:isDark?"#514568":COLORS.line}]} onPress={()=>router.push("/mypage?open=settings&returnTo=map")} accessibilityRole="button" accessibilityLabel="알림 설정"><Ionicons name="settings-outline" size={21} color={isDark?"#FFFFFF":COLORS.ink} /></Pressable><Pressable style={[styles.profileButton,{width:44,height:44,backgroundColor:isDark?"#24212C":"#FFFFFF",borderColor:isDark?"#514568":COLORS.line}]} onPress={()=>router.push("/mypage")} accessibilityRole="button" accessibilityLabel="마이페이지"><Ionicons name="person-circle-outline" size={23} color={isDark?"#FFFFFF":COLORS.ink} /></Pressable></View>
    </View>
    <View style={styles.searchRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="학원 및 지역 검색" onPress={openSearchOverlay} style={[styles.searchBox,{flexDirection:"row",alignItems:"center"}]}><Ionicons name="search-outline" size={19} color={COLORS.muted}/><Text numberOfLines={1} style={[styles.searchInput,{color:search?COLORS.ink:COLORS.muted,flex:1}]}>{search||"학원명, 지역, 수업명 검색"}</Text><Ionicons name="chevron-forward" size={16} color={COLORS.muted}/></Pressable>
      <Pressable style={[styles.filterButton,{backgroundColor:isDark?"#24212C":"#FFFFFF",borderColor:isDark?"#514568":COLORS.line}]} onPress={()=>setFilterOpen(true)}><Ionicons name="options-outline" size={21} color={isDark?"#FFFFFF":COLORS.ink} />{activeFilters>0&&<View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilters}</Text></View>}</Pressable>
    </View>
    {!!search.trim()&&search.trim().length>=2&&<Text style={styles.searchHint}>{classSearchLoading?"수업명 검색 중…":"학원명·지역·태그·등록 수업명 검색"}</Text>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,flexShrink:0}} contentContainerStyle={[styles.quickFilters,{alignItems:"center"}]}><Chip label="전체" active={!adult&&!kids&&!coupon&&!level} onPress={resetFilters}/><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/><Chip label="쿠폰" active={coupon} onPress={()=>setCoupon(!coupon)}/><Chip label="초급" active={level==="초급"} onPress={()=>setLevel(level==="초급"?null:"초급")}/></ScrollView>
    <View style={styles.content}>
      {view==="map"?<View style={styles.mapWrap}>
        <KakaoMap ref={map} initialRegion={region} markers={mapMarkers} selectedId={selected?.id??null} searchedIds={searchedStudioIds} compareIds={compareIds} currentLocation={locationGranted?currentLocation:null} onRegionChangeComplete={handleMapRegionChange} onMarkerPress={handleMapMarkerPress} darkMode={isDark} />
        {(!hasMapSearchRequested||mapMoved&&isAreaChanged)&&<Pressable style={styles.areaSearch} disabled={backendState==="loading"||searchSubmitting} onPress={searchArea}><View style={{flexDirection:"row",alignItems:"center",gap:6}}><Ionicons name="search-outline" size={15} color={COLORS.ink}/><Text style={styles.areaSearchText}>{searchSubmitting?"검색 중…":hasMapSearchRequested?"이 지역에서 재검색":"현재 지역 학원 검색"}</Text></View></Pressable>}
        <Pressable style={styles.locateButton} onPress={()=>locate()}><Ionicons name={locationLoading?"sync-outline":"locate-outline"} size={22} color={COLORS.purple} /></Pressable>
        <Pressable style={styles.mapCount} onPress={()=>{if(backendState==="error"){Alert.alert("학원 정보",backendErrorMessage);return;}const rows=results;if(rows.length){setSearchMatches(rows);setSearchResultsOpen(true);}}}><Text style={styles.mapCountText}>{search.trim()&&globalSearchStudios.length?"검색 결과 ":"주변 학원 "}<Text style={{color:COLORS.purple,fontWeight:"800"}}>{search.trim()&&globalSearchStudios.length?globalSearchStudios.length:results.length}곳</Text>{searchMatches.length>1?" · 목록 보기":backendState==="loading"?" · 불러오는 중":backendState==="error"?(backendErrorMessage.includes("한도")?" · 검색 한도":" · 연결 오류"):backendState==="empty"?" · 등록된 학원 없음":""}</Text></Pressable>
        {selected&&<View style={styles.selectedCard} {...selectedCardPan.panHandlers}>{studioCard(selected,true)}<Pressable accessibilityRole="button" accessibilityLabel="학원 상세정보 보기" onPress={()=>openDetail(selected)} style={{minHeight:42,marginTop:6,borderRadius:11,backgroundColor:isDark?"#34343B":"#E2E2E7",alignItems:"center",justifyContent:"center",flexDirection:"row",gap:6}}><Text style={{fontSize:12,fontWeight:"900",color:isDark?"#F0F0F4":"#454550"}}>상세정보 보기</Text><Ionicons name="arrow-up" size={15} color={isDark?"#E4D6FF":COLORS.purple}/></Pressable><Pressable style={styles.dismiss} hitSlop={8} onPress={()=>setSelected(null)}><Text style={[styles.dismissText,{fontSize:28}]}>×</Text></Pressable></View>}
      </View> :<><View style={styles.listSortRow}><Text style={styles.listSortLabel}>{view==="favorites"?"찜한 학원":"학원 목록"} · {listRows.length}곳</Text><Text style={styles.listSortChipText}>거리순</Text></View>{view==="list"&&<View style={{paddingHorizontal:12,paddingBottom:9}}>
  <Text style={{fontSize:11,fontWeight:"800",color:COLORS.muted,marginBottom:6}}>지역 선택</Text>
  <View style={{flexDirection:"row",alignItems:"center",gap:7}}><Pressable onPress={()=>{setExpandedProvince(regionProvince==="전체"?null:regionProvince);setExpandedCity(regionCity!=="전체"?regionCity:(METRO_PROVINCES.includes(regionProvince)?"__districts__":null));setRegionPickerOpen(true);}} style={{flex:1,paddingHorizontal:12,paddingVertical:11,borderRadius:10,borderWidth:1,borderColor:COLORS.purple,backgroundColor:isDark?"#24202D":COLORS.white,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text numberOfLines={1} style={{flex:1,fontSize:13,fontWeight:"900",color:isDark?"#F3EFFA":COLORS.ink}}>{selectedListRegion!=="전체"?selectedListRegion:[regionProvince,regionCity].filter(x=>x!=="전체").join(" · ")||"전체 지역"}</Text><Text style={{color:isDark?"#D8C6FF":COLORS.purple,fontWeight:"900",fontSize:12}}>변경 ⌄</Text></Pressable>{(selectedListRegion!=="전체"||regionCity!=="전체"||regionProvince!=="전체")&&<Pressable onPress={()=>{setSelectedListRegion("전체");setRegionCity("전체");setRegionProvince("전체");}} style={{paddingHorizontal:10,paddingVertical:10,borderRadius:10,backgroundColor:isDark?"#292929":"#F2F0F6"}}><Text style={{fontSize:11,fontWeight:"800",color:isDark?"#FFFFFF":COLORS.ink}}>전체</Text></Pressable>}</View>
  <View style={{flexDirection:"row",gap:7,marginTop:10}}>
    {([{key:"views",label:"많이 본 학원"},{key:"favorites",label:"즐겨찾기"}] as const).map(opt=><Pressable key={opt.key} onPress={()=>setRankMode(opt.key)} style={{flex:1,paddingVertical:9,borderRadius:10,backgroundColor:rankMode===opt.key?COLORS.purple:(isDark?"#292929":"#F2F0F6"),alignItems:"center"}}><Text style={{fontSize:11,fontWeight:"900",color:rankMode===opt.key?"#fff":(isDark?"#FFFFFF":COLORS.ink)}}>{opt.label}</Text></Pressable>)}
  </View>
  <View style={{marginTop:10,backgroundColor:isDark?"#1D1D1D":rankMode==="views"?"#F7F4FF":"#F8F7FA",borderRadius:12,padding:12}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{fontSize:13,fontWeight:"900",color:rankMode==="views"?COLORS.purple:COLORS.purple}}>{rankMode==="views"?"많이 본 학원":"즐겨찾기 많은 학원"}</Text>{rankMode==="views"&&<Text style={{fontSize:10,fontWeight:"700",color:COLORS.muted,backgroundColor:isDark?"#242424":"#fff",paddingHorizontal:8,paddingVertical:4,borderRadius:8}}>최근 7일</Text>}</View>
    {rankLoading?<Text style={styles.photoCredit}>순위를 불러오는 중…</Text>:rankItems.length>0?rankItems.slice(0,5).map((r:any)=><Pressable key={r.studio_id} onPress={async()=>{try{const item=studios.find(studio=>studio.id===r.studio_id)||await fetchStudioById(r.studio_id).then(row=>row?mapStudioRecord(row):null);if(item)setSelectedRankStudio(item);else Alert.alert("학원 정보","학원 위치 정보를 불러오지 못했습니다.");}catch{Alert.alert("학원 정보","학원 정보를 불러오지 못했습니다.");}}} style={{marginTop:7,paddingVertical:9,paddingHorizontal:9,borderRadius:10,backgroundColor:isDark?"#1D1D1D":"#fff",borderWidth:1,borderColor:isDark?"#383838":selectedRankStudio?.id===r.studio_id?COLORS.purple:"#EAE5F1",flexDirection:"row",alignItems:"center",gap:8}}>
      <Ionicons name={rankMode==="views"?"eye-outline":"heart-outline"} size={18} color={COLORS.purple}/>
      <View style={{flex:1,minWidth:0}}><Text numberOfLines={2} ellipsizeMode="tail" style={{fontSize:12,fontWeight:"800",color:COLORS.ink,lineHeight:17}}>{r.studio_name}</Text></View>
      <Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple,flexShrink:0}}>{rankMode==="views"?r.view_count+"회":r.favorite_count+"명"}</Text>
      <Ionicons name="chevron-forward" size={15} color={COLORS.muted}/>
    </Pressable>):<Text style={styles.photoCredit}>{rankMode==="views"?"10회 이하 조회는 데이터가 쌓이면 표시됩니다.":"즐겨찾기가 쌓이면 표시됩니다."}</Text>}
    {selectedRankStudio&&<Pressable onPress={()=>{const item=selectedRankStudio;const next={latitude:item.lat,longitude:item.lng,latitudeDelta:0.009,longitudeDelta:0.009};setGlobalSearchStudios([]);setSelected(item);setAreaLocked(false);setMapMoved(false);setSearchedRegion(next);setRegion(next);setPendingMapTarget(next);setView("map");}} style={{marginTop:11,padding:11,borderRadius:12,backgroundColor:isDark?"#242424":"#EEE7FF",borderWidth:1,borderColor:isDark?"#484848":"#D6C5FF"}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:6,marginBottom:5}}><Ionicons name="location" size={15} color={COLORS.purple}/><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple}}>선택한 학원 · 지도에서 보기</Text></View>
      <Text numberOfLines={2} style={{fontSize:13,fontWeight:"900",color:COLORS.ink,lineHeight:18}}>{selectedRankStudio.name}</Text>
      <Text numberOfLines={2} style={{fontSize:10,color:COLORS.muted,marginTop:4}}>{selectedRankStudio.address||selectedRankStudio.area||"주소 정보 없음"}</Text>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"flex-end",marginTop:7}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.purple}}>지도에서 위치 확인  ›</Text></View>
    </Pressable>}
  </View>
</View>}<FlatList data={visibleListRows} keyExtractor={i=>i.id} renderItem={renderStudioListItem} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" initialNumToRender={25} maxToRenderPerBatch={25} windowSize={7} onEndReached={loadMoreListRows} onEndReachedThreshold={0.45} ListFooterComponent={listRows.length>visibleListRows.length?<Pressable onPress={loadMoreListRows} style={{padding:16,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"800",color:COLORS.purple}}>학원 더 불러오기 · {visibleListRows.length}/{listRows.length}</Text></Pressable>:listRows.length>0?<Text style={{padding:16,textAlign:"center",fontSize:11,color:COLORS.muted}}>모든 학원을 확인했습니다.</Text>:null} ListEmptyComponent={<View style={{alignItems:"center",paddingHorizontal:24,paddingVertical:30,gap:9}}><Ionicons name="search-outline" size={28} color={COLORS.muted}/><Text style={styles.empty}>{view==="favorites"?"찜한 학원이 아직 없어요.":backendState==="error"?"학원 정보를 불러올 수 없습니다.":"조건에 맞는 학원이 없어요."}</Text>{view==="list"&&<>{backendState==="error"?<Text style={{fontSize:11,color:COLORS.muted,textAlign:"center"}}>서버 연결 상태를 확인한 뒤 다시 시도해 주세요.</Text>:<><Text style={{fontSize:11,color:COLORS.muted,textAlign:"center"}}>지역이나 수업 필터 때문에 결과가 없을 수 있어요.</Text><Pressable onPress={resetListFilters} style={{marginTop:4,paddingHorizontal:16,paddingVertical:9,borderRadius:10,backgroundColor:COLORS.pale}}><Text style={{fontSize:12,fontWeight:"900",color:COLORS.purple}}>지역·검색·필터 초기화</Text></Pressable></>}</>}</View>}/></>}
    </View>
    {compareIds.length>0&&<Pressable style={[styles.compareFloating,{bottom:Math.max(72,insets.bottom+72)},selected&&{bottom:Math.max(190,insets.bottom+190)}]} onPress={()=>setCompareOpen(true)}><Text style={styles.compareFloatingText}>비교 목록 · {compareIds.length}/3</Text></Pressable>}
    <Modal visible={searchResultsOpen} transparent animationType="fade" onRequestClose={()=>setSearchResultsOpen(false)}>
      <View style={[styles.modalShade,{paddingBottom:insets.bottom}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={()=>setSearchResultsOpen(false)} />
        <View style={[styles.modal,{maxHeight:"82%",paddingBottom:Math.max(30,insets.bottom+18)}]}>
          <View style={styles.modalHead}>
            <View style={{flex:1,minWidth:0}}>
              <Text style={styles.modalTitle}>검색 결과 {searchMatches.length}곳</Text>
              <Text style={styles.searchResultSub}>학원명과 주소를 확인하고 지점을 선택해 주세요</Text>
            </View>
            <Pressable onPress={()=>setSearchResultsOpen(false)} style={styles.drawerClose}><Ionicons name="close" size={21} color={COLORS.muted}/></Pressable>
          </View>
          <FlatList data={searchMatches} keyExtractor={item=>item.id} style={{marginTop:12}} contentContainerStyle={{paddingBottom:8}} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled"
            renderItem={({item})=><Pressable style={styles.searchResultRow} onPress={()=>{
              // A selected search result should jump directly to that studio, not first to a broad area.
              const next={latitude:item.lat,longitude:item.lng,latitudeDelta:0.009,longitudeDelta:0.009};
              setGlobalSearchStudios(searchMatches);setSearchResultsOpen(false);setSelected(item);setAreaLocked(false);setMapMoved(false);setSearchedRegion(next);setRegion(next);setPendingMapTarget(next);setView("map");
            }}>
              
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
        <View style={[styles.drawerPanel,{paddingBottom:Math.max(16,insets.bottom+12)}]}>
          <View style={styles.drawerHeader}><View><Text style={styles.drawerBrand}>balletmate ✦</Text><Text style={styles.drawerSubtitle}>발레 생활을 더 편리하게</Text></View><Pressable onPress={()=>setMenuOpen(false)} style={styles.drawerClose}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable></View>
          <Text style={styles.drawerSection}>탐색</Text>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("map");setMenuOpen(false);}}><Ionicons name="map-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>지도에서 찾기</Text>{view==="map"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("list");setMenuOpen(false);}}><Ionicons name="list-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>학원 목록</Text>{view==="list"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setView("favorites");setMenuOpen(false);}}><Ionicons name="heart-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>찜한 학원</Text>{view==="favorites"&&<Text style={styles.drawerCurrent}>현재</Text>}</Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);setCompareOpen(true);}}><Ionicons name="swap-horizontal" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>학원 비교</Text><Text style={styles.drawerCount}>{compareIds.length}/3</Text></Pressable>
          <View style={styles.drawerDivider}/>
          <Text style={styles.drawerSection}>커뮤니티 및 계정</Text>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/community");}}><Ionicons name="chatbubbles-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>발레 커뮤니티</Text></Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/mypage");}}><Ionicons name="person-circle-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>마이페이지 / 로그인</Text></Pressable>
          <Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);setPendingDirectionsStudio(null);setMapSettingsOpen(true);}}><Ionicons name="navigate-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>기본 길찾기 앱</Text><Text style={styles.drawerCount}>{mapProvider==="kakao"?"카카오맵":mapProvider==="google"?"구글 지도":"미설정"}</Text></Pressable>
          {isStudioOwner&&<Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/studio-manager");}}><Ionicons name="business-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>학원 관리자</Text></Pressable>}
          {isAdminUser&&<Pressable style={styles.drawerItem} onPress={()=>{setMenuOpen(false);router.push("/admin");}}><Ionicons name="shield-checkmark-outline" size={21} color={COLORS.purple} /><Text style={styles.drawerItemText}>서비스 관리자</Text></Pressable>}
          <View style={styles.drawerFooter}><Text style={styles.drawerFooterText}>Balletmate · 가까운 발레학원 찾기</Text></View>
        </View>
      </View>
    </Modal>
    <Modal visible={mapSettingsOpen} transparent animationType="fade" onRequestClose={()=>{setMapSettingsOpen(false);setPendingDirectionsStudio(null);}}>
      <View style={[styles.modalShade,{paddingBottom:insets.bottom}]}><View style={[styles.modal,{paddingBottom:Math.max(30,insets.bottom+18)}]}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>기본 길찾기 앱</Text><Pressable onPress={()=>{setMapSettingsOpen(false);setPendingDirectionsStudio(null);}}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.filterHint}>선택한 지도 앱을 기본으로 저장합니다. 다음부터는 길찾기를 누르면 바로 이 앱으로 열립니다.</Text>
        <Pressable style={[styles.mapProviderOption,mapProvider==="google"&&styles.mapProviderSelected]} onPress={()=>selectMapProvider("google")}><Ionicons name="map-outline" size={22} color={COLORS.purple}/><View style={{flex:1}}><Text style={styles.mapProviderTitle}>Google 지도</Text><Text style={styles.mapProviderSub}>구글 지도에서 길찾기</Text></View><Text style={styles.mapProviderCheck}>{mapProvider==="google"?"기본":"선택"}</Text></Pressable>
        <Pressable style={[styles.mapProviderOption,mapProvider==="kakao"&&styles.mapProviderSelected]} onPress={()=>selectMapProvider("kakao")}><Ionicons name="navigate-outline" size={22} color={COLORS.purple}/><View style={{flex:1}}><Text style={styles.mapProviderTitle}>카카오맵</Text><Text style={styles.mapProviderSub}>카카오맵 앱 우선, 미설치 시 웹 지도</Text></View><Text style={styles.mapProviderCheck}>{mapProvider==="kakao"?"기본":"선택"}</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={compareOpen} animationType="slide" transparent onRequestClose={()=>setCompareOpen(false)}>
      <View style={[styles.modalShade,{paddingBottom:insets.bottom}]}><View style={[styles.modal,{maxHeight:"88%",paddingBottom:Math.max(30,insets.bottom+18)}]}>
        <View style={[styles.modalHead,{gap:10}]}><Text style={styles.modalTitle}>학원 비교</Text><View style={{flexDirection:"row",alignItems:"center",gap:12}}>{compareIds.length>0&&<Pressable accessibilityRole="button" accessibilityLabel="비교 목록 전체 초기화" onPress={()=>{setCompareIds([]);setCompareCache([]);setCompareClassData({});setComparePriceData({});setCompareScheduleData({});setCompareCouponStates({});}}><Text style={styles.removeCompare}>전체 초기화</Text></Pressable>}<Pressable onPress={()=>setCompareOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View></View>
        <Text style={styles.filterHint}>가격·쿠폰·최대 수업시간을 최대 3곳까지 한 화면에서 비교합니다.</Text>
        {!!compareMaterialError&&<View style={{marginTop:8,marginBottom:4,padding:10,borderRadius:9,backgroundColor:isDark?"#2A1C1C":"#FFF1F0"}}><Text style={{fontSize:11,color:"#A53A35"}}>{compareMaterialError}</Text></View>}
        {compareIds.length===0?<View style={{paddingVertical:34,alignItems:"center",gap:8}}><Ionicons name="swap-horizontal-outline" size={30} color={COLORS.muted}/><Text style={{fontSize:13,fontWeight:"800",color:COLORS.ink}}>비교 목록이 비어 있어요.</Text><Text style={{fontSize:11,color:COLORS.muted}}>학원 카드에서 비교를 추가해 주세요.</Text></View>:compareClassLoading?<ActivityIndicator color={COLORS.purple} style={{margin:24}}/>:
        <View style={{flexDirection:"row",gap:6,marginTop:12,marginBottom:12}}>
          {compareIds.map(id=>{
            const studio=studios.find(x=>x.id===id)||favoriteStudios.find(x=>x.id===id)||compareCache.find(x=>x.id===id);
            if(!studio)return null;
            const prices=comparePriceData[id]||[],classes=compareClassData[id]||[];
            const amounts=prices.map(price=>Number(price.amount_krw||0)).filter(value=>value>0);
            const maxDuration=Math.max(studio.duration||0,...(studio.classDurations||[]),...classes.map(cls=>Number(cls.duration_minutes)||0));
            return <View key={id} style={[styles.compareColumn,{flex:1,width:0,minWidth:0,padding:7}]}>
              <View style={[styles.compareColumnHead,{minHeight:80}]}>
                <Text style={[styles.compareName,{fontSize:12}]} numberOfLines={2}>{studio.name}</Text>
                <Text style={[styles.compareInfo,{fontSize:9}]} numberOfLines={1}>{studio.area}</Text>
                <Pressable hitSlop={6} onPress={()=>{setCompareIds(ids=>ids.filter(x=>x!==id));setCompareCache(list=>list.filter(x=>x.id!==id));}}><Text style={[styles.removeCompare,{fontSize:10}]}>제외</Text></Pressable>
              </View>
              <Text style={styles.compareSectionTitle}>가격</Text>
              {amounts.length?amounts.map((amount,index)=><Text key={index} style={[styles.comparePrice,{fontSize:12}]}>{amount.toLocaleString("ko-KR")}원</Text>):<Text style={styles.compareEmpty}>미등록</Text>}
              <Text style={styles.compareSectionTitle}>쿠폰</Text>
              <Text style={styles.compareInfo}>{compareCouponStates[id]==="available"?"쿠폰 있음":compareCouponStates[id]==="none"?"현재 제공 중인 쿠폰 없음":"쿠폰 확인 불가"}</Text>
              <Text style={styles.compareSectionTitle}>최대 수업시간</Text>
              <Text style={[styles.comparePrice,{fontSize:12}]}>{maxDuration>0?maxDuration+"분":"미등록"}</Text>
            </View>;
          })}
        </View>}
        <Pressable style={styles.applyButton} onPress={()=>setCompareOpen(false)}><Text style={styles.applyText}>확인</Text></Pressable>
      </View></View>
    </Modal>
    <Modal visible={regionPickerOpen} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={handleRegionPickerBack}>
      <View style={[styles.modalShade,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
        <View style={[styles.modal,{height:"86%",maxHeight:"88%",minHeight:0,flexShrink:1,paddingHorizontal:14,paddingBottom:Math.max(24,insets.bottom+24)}]}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>지역 선택</Text>
            <Pressable onPress={handleRegionPickerBack} hitSlop={10} style={{minWidth:64,alignItems:"flex-end"}}>
              <Text style={[styles.dismissText,{fontSize:14,fontWeight:"800",color:COLORS.purple}]}>{expandedCity||expandedProvince?"‹ 뒤로":"닫기"}</Text>
            </Pressable>
          </View>
          <Text style={styles.photoCredit}>지역을 누르면 해당 범위가 적용됩니다. 구·군을 선택하면 더 좁혀집니다.</Text>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" overScrollMode="always" showsVerticalScrollIndicator style={{flex:1,minHeight:0,marginTop:10}} contentContainerStyle={{paddingBottom:insets.bottom+32}} scrollEventThrottle={16}>
            <Pressable onPress={()=>{setRegionProvince("전체");setRegionCity("전체");setSelectedListRegion("전체");setExpandedProvince(null);setExpandedCity(null);setRegionPickerOpen(false);}} style={{paddingVertical:12,paddingHorizontal:12,borderRadius:9,backgroundColor:regionProvince==="전체"&&regionCity==="전체"&&selectedListRegion==="전체"?(isDark?"#292333":"#F2ECFF"):(isDark?"#242424":"#F8F7FA"),marginBottom:8}}>
              <Text style={{fontSize:13,fontWeight:"900",color:COLORS.purple}}>전국 전체</Text>
            </Pressable>
            {regionGroups.map(group=><View key={group.province} style={{marginBottom:10,borderWidth:1,borderColor:COLORS.line,borderRadius:10,overflow:"hidden"}}>
              <Pressable onPress={()=>{
                const isOpen=expandedProvince===group.province;
                setRegionProvince(group.province);setRegionCity("전체");setSelectedListRegion("전체");
                setExpandedProvince(isOpen?null:group.province);
                setExpandedCity(isOpen?null:(group.cities.some(item=>!item.city)?"__districts__":null));
              }} style={{paddingVertical:12,paddingHorizontal:12,backgroundColor:isDark?"#292333":COLORS.pale,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
                <Text style={{fontSize:13,fontWeight:"900",color:isDark?"#E0D2FF":COLORS.purple}}>{group.province} 전체</Text>
                <Text style={{color:isDark?"#E0D2FF":COLORS.purple}}>{expandedProvince===group.province?"−":"＋"}</Text>
              </Pressable>
              {expandedProvince===group.province&&group.cities.map(cityGroup=><View key={group.province+"-"+(cityGroup.city||"region")} style={{borderTopWidth:1,borderTopColor:COLORS.line}}>
                {!!cityGroup.city&&<Pressable onPress={()=>{setRegionProvince(group.province);setRegionCity(cityGroup.city);setSelectedListRegion("전체");setExpandedCity(current=>current===cityGroup.city?null:cityGroup.city);}} style={{paddingVertical:11,paddingHorizontal:16,backgroundColor:isDark?"#202020":COLORS.bg,flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
                  <Text style={{fontSize:12,fontWeight:"800",color:isDark?"#F3EFFA":COLORS.ink}}>{cityGroup.city} 전체</Text>
                  <Text style={{color:COLORS.purple}}>{expandedCity===cityGroup.city?"−":"＋"}</Text>
                </Pressable>}
                {expandedCity===(cityGroup.city||"__districts__")&&<View style={{paddingHorizontal:10,paddingVertical:8,backgroundColor:isDark?"#1D1D1D":COLORS.bg}}>
                  {cityGroup.areas.map(area=><Pressable key={area} onPress={()=>{setRegionProvince(group.province);setRegionCity(cityGroup.city||"전체");setSelectedListRegion(area);setRegionPickerOpen(false);}} style={{width:"100%",paddingVertical:11,paddingHorizontal:12,marginBottom:6,borderRadius:9,backgroundColor:selectedListRegion===area?(isDark?"#3A2C55":COLORS.pale):(isDark?"#292929":COLORS.white),borderWidth:1,borderColor:selectedListRegion===area?COLORS.purple:COLORS.line}}>
                    <Text style={{fontSize:12,fontWeight:selectedListRegion===area?"900":"700",color:selectedListRegion===area?(isDark?"#D8C6FF":COLORS.purple):(isDark?"#F3EFFA":COLORS.ink)}}>{districtOptionLabel(area,cityGroup.city||"전체")}</Text>
                  </Pressable>)}
                </View>}
              </View>)}
            </View>)}
          </ScrollView>
          <Pressable style={[styles.applyButton,{flex:0,minHeight:52,width:"100%",marginTop:8,paddingVertical:12}]} onPress={handleRegionPickerBack}>
            <Text style={styles.applyText}>{expandedCity||expandedProvince?"뒤로가기":"닫기"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
<Modal visible={!!detailStudio} animationType="fade" transparent statusBarTranslucent onRequestClose={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}>
<GestureHandlerRootView style={{flex:1}}><View style={{flex:1}}>
<View style={styles.modalShade}>
<Pressable style={StyleSheet.absoluteFillObject} onPress={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}} accessibilityRole="button" accessibilityLabel="학원 상세정보 닫기"/>
<BottomSheet
  ref={detailSheetRef}
  style={{width:"100%",alignSelf:"center"}}
  index={detailExpanded?1:0}
  snapPoints={["65%","92%"]}
  enableDynamicSizing={false}
  enablePanDownToClose
  enableContentPanningGesture={false}
  enableHandlePanningGesture
  overDragResistanceFactor={2.5}
  bottomInset={insets.bottom}
  topInset={Math.max(8,insets.top)}
  backgroundStyle={{backgroundColor:isDark?"#1D1D22":"#F0F0F3",borderTopLeftRadius:24,borderTopRightRadius:24}}
  handleIndicatorStyle={{width:64,height:7,backgroundColor:isDark?"#77717F":"#A8A3B0"}}
  onChange={index=>{if(index<0){detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);return;}setDetailExpanded(index===1);}}
  keyboardBehavior="interactive"
  android_keyboardInputMode="adjustResize"
>
<View style={[styles.dragHeader,{paddingTop:4,paddingHorizontal:12}]}><View style={styles.modalHead}><Text style={styles.modalTitle}>학원 상세 정보</Text><View style={{flexDirection:"row",alignItems:"center"}}><Pressable hitSlop={4} accessibilityRole="button" accessibilityLabel={detailExpanded?"상세정보 축소":"상세정보 확장"} style={{width:44,height:44,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:isDark?"#292633":"#F2EEF8"}} onPress={()=>detailSheetRef.current?.snapToIndex(detailExpanded?0:1)}><Ionicons name={detailExpanded?"chevron-down":"chevron-up"} size={22} color={isDark?"#E7E1F0":COLORS.purple}/></Pressable><Pressable hitSlop={4} accessibilityRole="button" accessibilityLabel="학원 상세정보 닫기" style={{width:44,height:44,marginLeft:6,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:isDark?"#292633":"#F2EEF8"}} onPress={()=>{detailRequestId.current++;setDetailStudio(null);setClassesLoading(false);setDetailExpanded(false);}}><Ionicons name="close" size={24} color={isDark?"#E7E1F0":COLORS.ink}/></Pressable></View></View><Text style={styles.dragHint}>내용을 위로 밀면 확장되고 · 좌우로 밀어 탭 이동</Text></View>
<View style={{flexDirection:"row",gap:4,marginTop:8,marginBottom:4,marginHorizontal:12}}>{([{id:"home",label:"홈"},{id:"notices",label:"소식"},{id:"classes",label:"수업정보"},{id:"reviews",label:"리뷰"},{id:"photos",label:"사진"}] as const).map(tab=><Pressable key={tab.id} onPress={()=>setDetailTab(tab.id)} accessibilityRole="tab" accessibilityState={{selected:detailTab===tab.id}} style={{flex:1,minWidth:0,minHeight:48,paddingHorizontal:2,paddingVertical:8,borderRadius:10,backgroundColor:detailTab===tab.id?(isDark?"#3A2D50":COLORS.pale):(isDark?"#252525":COLORS.bg),alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:detailTab===tab.id?COLORS.purple:COLORS.line}}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{fontSize:12,fontWeight:"800",color:detailTab===tab.id?(isDark?"#D8C6FF":COLORS.purple):(isDark?"#D0D0D0":COLORS.muted)}}>{tab.label}</Text></Pressable>)}</View>
{!!detailContentError&&<View style={{marginHorizontal:12,marginBottom:8,padding:9,borderRadius:9,backgroundColor:isDark?"#2A2418":"#FFF8E8"}}><Text style={{fontSize:11,color:"#8B641B"}}>{detailContentError}</Text></View>}{detailCanonicalLoading&&<View style={{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,paddingVertical:8}}><ActivityIndicator size="small" color={COLORS.purple}/><Text style={styles.photoCredit}>학원 정보 동기화 중…</Text></View>}
{!!detailCanonicalError&&<View style={{marginHorizontal:12,marginBottom:8,padding:10,borderRadius:10,backgroundColor:isDark?"#2A1C1C":"#FFF1F0",flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{flex:1,fontSize:12,color:"#A53A35"}}>일부 상세 정보 갱신 실패</Text><Pressable disabled={detailCanonicalLoading} onPress={()=>retryCanonicalDetail(detailStudio!.id,detailRequestId.current)} style={{paddingHorizontal:10,paddingVertical:6,backgroundColor:"#FCE1DE",borderRadius:8}}><Text style={{fontSize:12,fontWeight:"800",color:"#A53A35"}}>재시도</Text></Pressable></View>}
<GestureDetector gesture={detailHorizontalGesture}><View collapsable={false} style={{flex:1,minHeight:0,width:"100%",alignSelf:"stretch"}}>{detailStudio&&<>
 {detailTab==="home"&&<BottomSheetScrollView ref={detailScrollRef} onScroll={handleDetailScroll}  nestedScrollEnabled={Platform.OS==="android"} style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:Math.max(72,insets.bottom+72)}}>
   <Pressable onPress={()=>setDetailTab("photos")} style={{height:detailStudio.representativeImageUrl&&failedRepresentativeImageUrl!==detailStudio.representativeImageUrl?164:76,marginHorizontal:12,marginTop:6,borderRadius:14,overflow:"hidden",backgroundColor:isDark?"#292633":"#EAE7F0",alignItems:"center",justifyContent:"center"}}>
     {detailStudio.representativeImageUrl&&failedRepresentativeImageUrl!==detailStudio.representativeImageUrl?<Image source={{uri:detailStudio.representativeImageUrl}} style={{width:"100%",height:"100%",position:"absolute"}} resizeMode="cover" onError={()=>setFailedRepresentativeImageUrl(detailStudio.representativeImageUrl??null)}/>:<View style={{flexDirection:"row",alignItems:"center",gap:10}}><Ionicons name="images-outline" size={25} color={isDark?"#B7A7D5":COLORS.purple}/><Text style={{fontSize:12,color:isDark?"#C7C1D3":COLORS.muted}}>학원 사진이 아직 등록되지 않았어요</Text></View>}
     <View style={{position:"absolute",right:10,bottom:10,backgroundColor:"rgba(20,16,32,0.76)",paddingHorizontal:10,paddingVertical:7,borderRadius:18,flexDirection:"row",alignItems:"center",gap:5}}><Ionicons name="images-outline" size={13} color="#FFFFFF"/><Text style={{fontSize:10,color:"#FFFFFF",fontWeight:"800"}}>사진 보기</Text></View>
   </Pressable>
   <View style={{marginHorizontal:12,marginTop:10,padding:13,borderRadius:14,backgroundColor:isDark?"#29292F":"#FFFFFF",borderWidth:1,borderColor:isDark?"#3B3B44":"#E5E2EB"}}>
     <View style={{flexDirection:"row",alignItems:"center",gap:8}}>
       <View style={{flex:1,minWidth:0}}><Text numberOfLines={2} style={{fontSize:18,lineHeight:24,fontWeight:"900",color:isDark?"#F4F0FA":COLORS.ink}}>{detailStudio.name}</Text><Text numberOfLines={2} style={{fontSize:11,lineHeight:16,color:isDark?"#B9B9C2":COLORS.muted,marginTop:3}}>{detailStudio.address||detailStudio.area}</Text></View>
       <View style={{flexDirection:"row",alignItems:"center",gap:2}}>
         <Pressable onPress={()=>toggleFavorite(detailStudio)} hitSlop={5} style={{width:40,height:42,alignItems:"center",justifyContent:"center"}} accessibilityRole="button" accessibilityLabel={favoriteIds.includes(detailStudio.id)?"찜 해제":"찜하기"}><Ionicons name={favoriteIds.includes(detailStudio.id)?"heart":"heart-outline"} size={22} color={favoriteIds.includes(detailStudio.id)?"#E64B72":COLORS.purple}/></Pressable>
         <Pressable onPress={()=>toggleCompare(detailStudio)} hitSlop={5} style={{width:40,height:42,alignItems:"center",justifyContent:"center"}} accessibilityRole="button" accessibilityLabel="학원 비교"><Ionicons name={compareIds.includes(detailStudio.id)?"checkmark-circle":"swap-horizontal-outline"} size={22} color={compareIds.includes(detailStudio.id)?"#15966A":COLORS.purple}/></Pressable>
       </View>
     </View>
     <View style={{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:6,marginTop:8}}>
       <Text style={{fontSize:11,fontWeight:"800",color:isDark?"#E6D9FF":COLORS.purple}}>{detailStudio.rating>0?"★ "+detailStudio.rating.toFixed(1):"평점 미등록"}</Text>
       {!!detailStudio.area&&<Text style={{fontSize:11,color:isDark?"#B9B9C2":COLORS.muted}}>· {detailStudio.area}</Text>}
       {detailStudio.coupon&&<View style={{paddingHorizontal:8,paddingVertical:4,borderRadius:8,backgroundColor:isDark?"#49391F":"#FFF1D9"}}><Text style={{fontSize:10,fontWeight:"800",color:isDark?"#F4D59C":"#A96A13"}}>쿠폰 제공</Text></View>}
       {detailStudio.adult&&<Text style={{fontSize:10,color:isDark?"#D0D0D8":"#66636F"}}>성인반</Text>}
       {detailStudio.kids&&<Text style={{fontSize:10,color:isDark?"#D0D0D8":"#66636F"}}>키즈반</Text>}
     </View>
   </View>
   <View style={{marginHorizontal:12,marginTop:12,padding:14,borderRadius:14,backgroundColor:isDark?"#29292F":"#E9E9ED",borderWidth:1,borderColor:isDark?"#3B3B44":"#DEDEE4"}}>
     <View style={{flexDirection:"row",alignItems:"center",gap:7,marginBottom:couponLoadState==="available"?8:0}}><Ionicons name="ticket-outline" size={19} color={isDark?"#F2F2F5":"#454550"}/><Text style={{fontSize:14,fontWeight:"900",color:isDark?"#F2F2F5":"#34343D"}}>쿠폰 혜택</Text></View>
     {couponLoadState==="available"&&studioCoupons.slice(0,2).map(coupon=><View key={"top-coupon-"+coupon.id} style={{paddingVertical:8,borderTopWidth:1,borderTopColor:isDark?"#45454D":"#D7D7DE"}}><Text style={{fontSize:13,fontWeight:"800",color:isDark?"#F2F2F5":"#34343D"}}>{coupon.title}</Text>{!!coupon.discount_text&&<Text style={{fontSize:12,fontWeight:"800",color:isDark?"#D8D8E0":"#555560",marginTop:3}}>{coupon.discount_text}</Text>}{!!coupon.description&&<Text style={{fontSize:11,color:isDark?"#C1C1CA":"#666671",marginTop:3}}>{coupon.description}</Text>}</View>)}
     {couponLoadState==="available"&&studioCoupons.length>2&&<Text style={{fontSize:11,color:isDark?"#C1C1CA":"#666671",marginTop:5}}>외 {studioCoupons.length-2}개 쿠폰</Text>}
     {couponLoadState==="loading"&&<Text style={{fontSize:12,color:isDark?"#C1C1CA":"#666671"}}>쿠폰 정보를 확인하고 있습니다.</Text>}
     {couponLoadState==="none"&&<Text style={{fontSize:12,color:isDark?"#C1C1CA":"#666671"}}>현재 제공 중인 쿠폰이 확인되지 않았습니다.</Text>}
     {couponLoadState==="unverified"&&<Text style={{fontSize:12,color:isDark?"#C1C1CA":"#666671"}}>쿠폰 등록 여부를 확인할 수 없습니다. 학원에 문의해 주세요.</Text>}
     {couponLoadState==="idle"&&<Text style={{fontSize:12,color:isDark?"#C1C1CA":"#666671"}}>쿠폰 정보를 아직 확인하지 않았습니다.</Text>}
   </View>
   {(()=>{const durations=Array.from(new Set([...studioClasses.map(item=>Number(item.duration_minutes||0)),...(detailStudio.classDurations||[]).map(Number),Number(detailStudio.duration||0)].filter(value=>value>0))).sort((a,b)=>a-b);const classPrices=studioClasses.map(item=>Number(item.price||0)).filter(value=>value>0);const publicPrices=studioPublicPrices.map(item=>Number(item.amount_krw||0)).filter(value=>value>0);const amounts=classPrices.length?classPrices:publicPrices;const priceLabel=amounts.length?(amounts.length===1?"₩"+amounts[0].toLocaleString("ko-KR"):"₩"+Math.min(...amounts).toLocaleString("ko-KR")+" ~ ₩"+Math.max(...amounts).toLocaleString("ko-KR")):"가격표 확인 필요";const pricePeriod=classPrices.length?"수업 등록 가격":(studioPublicPrices.find(item=>Number(item.amount_krw||0)>0)?.price_period||"등록된 가격표");return <View style={{marginHorizontal:12,marginTop:14}}>
     <Text style={{fontSize:15,fontWeight:"900",color:isDark?"#F4F0FA":COLORS.ink,marginBottom:9}}>등록 전 핵심 정보</Text>
     <View style={{flexDirection:"row",gap:8}}>
       <Pressable onPress={()=>{setDetailInfoTab("schedule");setDetailTab("classes");}} style={{flex:1,minHeight:94,padding:11,borderRadius:13,backgroundColor:isDark?"#29292F":"#E9E9ED",borderWidth:1,borderColor:isDark?"#3B3B44":"#DEDEE4"}}><Ionicons name="time-outline" size={19} color={isDark?"#E2E2E8":"#555560"}/><Text style={{fontSize:11,color:isDark?"#C1C1CA":"#666671",marginTop:6}}>수업 시간</Text><Text numberOfLines={1} style={{fontSize:17,fontWeight:"900",color:isDark?"#F2F2F5":"#34343D",marginTop:2}}>{durations.length?durations.map(value=>value+"분").join(" · "):"정보 미등록"}</Text></Pressable>
       <Pressable onPress={()=>{setDetailInfoTab("price");setDetailTab("classes");}} style={{flex:1,minHeight:94,padding:11,borderRadius:13,backgroundColor:isDark?"#29292F":"#E9E9ED",borderWidth:1,borderColor:isDark?"#3B3B44":"#DEDEE4"}}><Ionicons name="wallet-outline" size={19} color={isDark?"#E2E2E8":"#555560"}/><Text style={{fontSize:11,color:isDark?"#C1C1CA":"#666671",marginTop:6}}>수업 가격</Text><Text numberOfLines={1} adjustsFontSizeToFit style={{fontSize:16,fontWeight:"900",color:isDark?"#F2F2F5":"#34343D",marginTop:2}}>{amounts.length?priceLabel:"정보 미등록"}</Text><Text numberOfLines={1} style={{fontSize:10,color:isDark?"#C1C1CA":"#666671",marginTop:2}}>{amounts.length?pricePeriod:"학원 문의 필요"}</Text></Pressable>
     </View>
     <View style={{flexDirection:"row",gap:8,marginTop:8}}>
       <Pressable onPress={()=>setDetailTab("photos")} style={{flex:1,minHeight:44,padding:11,borderRadius:12,backgroundColor:isDark?"#29292F":"#E9E9ED",flexDirection:"row",alignItems:"center",gap:7}}><Ionicons name="images-outline" size={18} color={isDark?"#E2E2E8":"#555560"}/><Text style={{fontSize:12,fontWeight:"800",color:isDark?"#F2F2F5":"#34343D"}}>학원 사진 보기</Text></Pressable>
       <Pressable onPress={()=>{setDetailInfoTab("schedule");setDetailTab("classes");}} style={{flex:1,minHeight:44,padding:11,borderRadius:12,backgroundColor:isDark?"#29292F":"#E9E9ED",flexDirection:"row",alignItems:"center",gap:7}}><Ionicons name="calendar-outline" size={18} color={isDark?"#E2E2E8":"#555560"}/><Text style={{fontSize:12,fontWeight:"800",color:isDark?"#F2F2F5":"#34343D"}}>시간표 확인</Text></Pressable>
     </View>
   </View>})()}
   <View style={{marginHorizontal:12,marginTop:16}}>
     {detailStudio.address&&<View style={styles.infoRow}><Text style={styles.infoLabel}>주소</Text><Text style={styles.infoValue}>{detailStudio.address}</Text></View>}
     {(detailStudio.address||detailStudio.lat)&&<Pressable style={styles.detailBtn} onPress={()=>requestDirections(detailStudio)}><Text style={styles.detailBtnText}>길찾기 열기 · {mapProvider==="kakao"?"카카오맵":mapProvider==="google"?"구글 지도":"앱 선택"}</Text></Pressable>}
     <View style={styles.infoRow}><Text style={styles.infoLabel}>수업 대상</Text><Text style={styles.infoValue}>{[detailStudio.adult?"성인":null,detailStudio.kids?"키즈":null].filter(Boolean).join(" · ")||"미등록"}</Text></View>
     <View style={styles.infoRow}><Text style={styles.infoLabel}>수준</Text><Text style={styles.infoValue}>{detailStudio.level.join(" · ")||"미등록"}</Text></View>
     <View style={styles.infoRow}><Text style={styles.infoLabel}>전화</Text><Text style={styles.infoValue}>{detailStudio.phone||"미등록"}</Text></View>
     {detailStudio.phone&&<Pressable style={styles.detailBtn} onPress={()=>Linking.openURL("tel:"+detailStudio.phone).catch(()=>Alert.alert("전화 연결","전화 앱을 열 수 없습니다."))}><Text style={styles.detailBtnText}>전화 문의 · {detailStudio.phone}</Text></Pressable>}
     <Text style={styles.detailDisclaimer}>가격과 시간표는 학원 또는 관리자에게 확인된 등록 정보만 표시합니다. 최신 여부를 확인해 주세요.</Text>
     <Pressable style={styles.detailBtn} onPress={async()=>{if(!supabase){Alert.alert("제보","로그인이 필요한 기능입니다.");return;}const {data}=await supabase.auth.getSession();if(!data.session){Alert.alert("로그인 필요","학원 정보 제보는 로그인 후 이용할 수 있어요.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);return;}setReportCategory("기타");setReportDescription("");setReportOpen(true);}}><Text style={styles.detailBtnText}>학원 정보 오류 제보</Text></Pressable>
   </View>
 </BottomSheetScrollView>}
{detailTab==="classes"&&<BottomSheetScrollView ref={detailScrollRef} onScroll={handleDetailScroll}  nestedScrollEnabled={Platform.OS==="android"} style={{flex:1}} contentContainerStyle={{paddingBottom:Math.max(72,insets.bottom+72)}}>
 <View style={{marginHorizontal:12,marginTop:8}}>
  <Text style={styles.sectionTitle}>수업 정보</Text>
  <View style={{flexDirection:"row",gap:8,marginBottom:10}}>{([{id:"price",label:"가격 정보"},{id:"schedule",label:"시간표"}] as const).map(tab=><Pressable key={tab.id} onPress={()=>setDetailInfoTab(tab.id)} style={{flex:1,paddingVertical:11,borderRadius:10,borderWidth:1,borderColor:detailInfoTab===tab.id?COLORS.purple:COLORS.line,backgroundColor:isDark?"#242424":detailInfoTab===tab.id?COLORS.pale:"#FFFFFF",alignItems:"center"}}><Text style={{fontSize:13,fontWeight:"800",color:detailInfoTab===tab.id?COLORS.purple:COLORS.muted}}>{tab.label}</Text></Pressable>)}</View>
  {detailInfoTab==="price"&&<View>
   {studioClasses.filter(item=>Number(item.price||0)>0).map(item=><View key={"class-price-"+item.id} style={styles.classBlock}><Text style={styles.classTitle}>{item.title}</Text><Text style={{fontSize:15,fontWeight:"900",color:COLORS.purple,marginTop:5}}>₩{Number(item.price).toLocaleString("ko-KR")}</Text><Text style={styles.classMeta}>{[item.duration_minutes?item.duration_minutes+"분":null,item.audience==="adult"?"성인":item.audience==="kids"?"키즈":null,item.level].filter(Boolean).join(" · ")}</Text></View>)}
   {studioPublicPrices.map(item=><View key={"public-price-"+item.id} style={styles.classBlock}>{item.amount_krw!==null&&<Text style={styles.classTitle}>{item.price_period||"등록 가격"} · ₩{Number(item.amount_krw).toLocaleString("ko-KR")}</Text>}<Image source={{uri:item.image_url}} style={{width:"100%",height:230,borderRadius:10,backgroundColor:"#FFFFFF",marginTop:6}} resizeMode="contain"/></View>)}
   {!studioClasses.some(item=>Number(item.price||0)>0)&&!studioPublicPrices.length&&<Text style={styles.filterHint}>가격 정보가 아직 등록되지 않았습니다. 정확한 금액은 학원에 문의해 주세요.</Text>}
  </View>}
  {detailInfoTab==="schedule"&&<View>
   {studioClasses.map(item=><View key={"class-schedule-"+item.id} style={styles.classBlock}><Text style={styles.classTitle}>{item.title}</Text><Text style={styles.classMeta}>{[item.duration_minutes?item.duration_minutes+"분":null,item.audience==="adult"?"성인":item.audience==="kids"?"키즈":null,item.level,item.class_type].filter(Boolean).join(" · ")||"수업 세부 정보"}</Text>{item.class_sessions.map((session,index)=><Text key={item.id+"-session-"+index} style={styles.sessionText}>{session.start_time}{session.end_time?" ~ "+session.end_time:""}{session.note?" · "+session.note:""}</Text>)}</View>)}
   {studioPublicSchedules.map(item=><View key={"public-schedule-"+item.id} style={styles.classBlock}>{!!item.schedule_text&&<Text style={styles.classTitle}>{item.schedule_text}</Text>}<Image source={{uri:item.image_url}} style={{width:"100%",height:230,borderRadius:10,backgroundColor:"#FFFFFF",marginTop:6}} resizeMode="contain"/></View>)}
   {!studioClasses.length&&!studioPublicSchedules.length&&<Text style={styles.filterHint}>시간표가 아직 등록되지 않았습니다. 수업 요일과 시간은 학원에 문의해 주세요.</Text>}
  </View>}
  <View style={{marginTop:16}}><Text style={styles.sectionTitle}>수업 대상 및 수준</Text>
   <View style={styles.infoRow}><Text style={styles.infoLabel}>수업 대상</Text><Text style={styles.infoValue}>{[detailStudio.adult?"성인":null,detailStudio.kids?"키즈":null].filter(Boolean).join(" · ")||"미등록"}</Text></View>
   <View style={styles.infoRow}><Text style={styles.infoLabel}>수준</Text><Text style={styles.infoValue}>{detailStudio.level.join(" · ")||"미등록"}</Text></View>
   <Text style={styles.detailDisclaimer}>가격과 시간표는 학원 또는 관리자에게 확인된 등록 정보만 표시합니다. 최신 여부를 확인해 주세요.</Text>
  </View>
 </View>
</BottomSheetScrollView>}
{detailTab==="notices"&&<BottomSheetScrollView ref={detailScrollRef} nestedScrollEnabled={Platform.OS==="android"} onScroll={(event)=>{handleDetailScroll(event);const {layoutMeasurement,contentOffset,contentSize}=event.nativeEvent;if(contentSize.height-layoutMeasurement.height-contentOffset.y<220)void loadMoreStudioOwnerNotices();}}  style={{flex:1}} contentContainerStyle={{paddingBottom:Math.max(72,insets.bottom+72)}}><Text style={[styles.sectionTitle,{marginHorizontal:14}]}>학원 안내</Text>{String(detailStudio.description||"").trim().length>0&&<><Text style={[styles.sectionTitle,{marginHorizontal:14}]}>학원 소개</Text><Text style={styles.detailDescription}>{cleanPublicText(detailStudio.description)}</Text></>}
          {!!detailStudio.websiteUrl&&!/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.websiteUrl)&&<View style={styles.infoRow}><Text style={styles.infoLabel}>공식 홈페이지</Text><Pressable onPress={()=>Linking.openURL(detailStudio.websiteUrl!).catch(()=>Alert.alert("홈페이지 연결","사이트를 열 수 없습니다."))}><Text style={styles.photoSourceLink}>홈페이지 방문 ›</Text></Pressable></View>}
          {!!(detailStudio.websiteUrl&&/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.websiteUrl)?detailStudio.websiteUrl:detailStudio.sourceUrl&&/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.sourceUrl)?detailStudio.sourceUrl:null)&&<View style={styles.infoRow}><Text style={styles.infoLabel}>공식 블로그</Text><Pressable style={{flex:1,alignItems:"flex-end",justifyContent:"center",minHeight:38,paddingVertical:6}} onPress={()=>Linking.openURL((detailStudio.websiteUrl&&/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.websiteUrl)?detailStudio.websiteUrl:detailStudio.sourceUrl!)!).catch(()=>Alert.alert("블로그 연결","블로그를 열 수 없습니다."))}><Text style={[styles.photoSourceLink,{textAlign:"right",lineHeight:18}]} numberOfLines={2}>{detailStudio.websiteUrl&&/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.websiteUrl)?detailStudio.websiteUrl:detailStudio.sourceUrl}</Text></Pressable></View>}
          {!detailStudio.websiteUrl&&!(detailStudio.sourceUrl&&/(blog\.naver\.com|m\.blog\.naver\.com|blog\.daum\.net|tistory\.com)/i.test(detailStudio.sourceUrl))&&<View style={styles.infoRow}><Text style={styles.infoLabel}>공식 홈페이지·블로그</Text><Text style={{fontSize:12,color:COLORS.muted,flex:1}}>없음 · 학원에서 등록하면 표시됩니다.</Text></View>}

          <Text style={styles.sectionTitle}>공지사항</Text><View style={{marginHorizontal:14,marginTop:10,padding:16,borderRadius:12,backgroundColor:isDark?"#1E1E2E":"#F0EEFF",borderWidth:1,borderColor:isDark?"#4A3F7A":"#C4B5FD"}}><Text style={{fontSize:13,fontWeight:"900",color:isDark?"#E2D9FF":"#3B1FA3"}}>공지사항</Text>{studioOwnerNotices.length?studioOwnerNotices.map(item=><View key={"owner-notice-"+String(item?.id??"notice")} style={{borderTopWidth:1,borderTopColor:isDark?"#4A3F7A":"#C4B5FD",paddingTop:10,marginTop:9}}><View style={{flexDirection:"row",alignItems:"center",gap:7,marginBottom:7}}><View style={{width:34,height:34,borderRadius:17,backgroundColor:"#EEE9FF",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>{item.author_avatar_url?<Image source={{uri:item.author_avatar_url}} style={{width:34,height:34,borderRadius:17}}/>:<Ionicons name="person" size={17} color={COLORS.purple}/>}</View><View style={{flex:1}}><Text style={{fontSize:11,fontWeight:"900",color:COLORS.ink}}>{item.author_display_name||detailStudio.name}</Text><Text style={{fontSize:9,color:COLORS.muted}}>{detailStudio.name} · 학원 관리자</Text></View><Text style={{fontSize:10,color:COLORS.muted}}>{item?.created_at&&Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleDateString("ko-KR"):"날짜 미확인"}</Text></View><Text style={{fontSize:13,fontWeight:"800",color:isDark?"#E2D9FF":"#3B1FA3"}}>{cleanPublicText(item?.title)||"공지"}</Text><Text style={{fontSize:12,lineHeight:18,color:isDark?"#B8ADDD":"#5B4FCF",marginTop:4}}>{cleanPublicText(item?.body)||"내용이 없습니다."}</Text><Text style={{fontSize:10,color:COLORS.muted,marginTop:5}}>{item?.created_at&&Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleDateString("ko-KR"):"날짜 미확인"}</Text></View>):studioOwnerNoticesLoading?<ActivityIndicator color={COLORS.purple} style={{marginTop:12}}/>:<Text style={{fontSize:11,color:"#81798D",marginTop:7}}>등록된 공지사항이 없습니다.</Text>}{studioOwnerNoticesLoading&&studioOwnerNotices.length>0&&<ActivityIndicator color={COLORS.purple} style={{marginTop:12}}/>}{!studioOwnerNoticesLoading&&!studioOwnerNoticesHasMore&&studioOwnerNotices.length>0&&<Text style={{fontSize:10,color:COLORS.muted,textAlign:"center",marginTop:14}}>모든 공지를 확인했습니다.</Text>}</View></BottomSheetScrollView>}{detailTab==="photos"&&<BottomSheetScrollView ref={detailScrollRef} onScroll={handleDetailScroll}  nestedScrollEnabled={Platform.OS==="android"} style={{flex:1}} contentContainerStyle={{paddingBottom:Math.max(72,insets.bottom+72)}}>{studioGalleryLoading?<ActivityIndicator color={COLORS.purple} style={{margin:24}}/>:studioGalleryImages.length?<View style={{flexDirection:"row",flexWrap:"wrap",paddingHorizontal:12,gap:8}}>{studioGalleryImages.map((item:any)=>failedGalleryImageIds.includes(String(item.id))?<View key={String(item.id)} style={{width:"47%",height:170,borderRadius:10,backgroundColor:isDark?"#292633":"#F2F0F6",alignItems:"center",justifyContent:"center",padding:8}}><Text style={{fontSize:11,color:isDark?"#C7C1D3":"#777180",textAlign:"center"}}>사진을 불러오지 못했습니다.</Text></View>:<Image key={String(item.id)} source={{uri:item.image_url}} style={{width:"47%",height:170,borderRadius:10,backgroundColor:"#F2F0F6"}} resizeMode="cover" onError={()=>setFailedGalleryImageIds(current=>current.includes(String(item.id))?current:[...current,String(item.id)])}/>)}</View>:<Text style={[styles.filterHint,{marginHorizontal:14}]}>등록된 학원 사진이 없습니다.</Text>}</BottomSheetScrollView>}
{detailTab==="reviews"&&<BottomSheetScrollView ref={detailScrollRef} onScroll={handleDetailScroll}  nestedScrollEnabled={Platform.OS==="android"} style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:Math.max(112,insets.bottom+112)}}>
<View style={[styles.classBlock,{marginHorizontal:12}]}><Text style={styles.classTitle}>이 학원에 대한 리뷰</Text><Text style={styles.photoCredit}>{studioReviews.length?"평균 별점 "+(studioReviews.reduce((sum,row)=>sum+Number(row.rating),0)/studioReviews.length).toFixed(1)+" · 리뷰 "+studioReviews.length+"개":"첫 리뷰를 남겨주세요."}</Text>
<Text style={styles.classMeta}>{reviewVerified?"수강 인증 완료 · 인증 배지가 표시됩니다.":"일반 리뷰 · 로그인 회원은 누구나 작성할 수 있습니다."} · 내 별점</Text><View style={{flexDirection:"row",gap:8,marginVertical:8}}>{[1,2,3,4,5].map(value=><Pressable key={value} onPress={()=>setReviewRating(value)}><Text style={{fontSize:28,color:value<=reviewRating?"#F2B544":"#D8D4E1"}}>★</Text></Pressable>)}</View><TextInput value={reviewText} onChangeText={setReviewText} placeholder="수업 분위기, 강사님, 시설 등에 대한 경험을 작성해 주세요." placeholderTextColor="#625E70" multiline maxLength={1000} textAlignVertical="top" style={styles.reportInput}/>{reviewText.trim().length>0&&reviewText.trim().length<5&&<Text style={{fontSize:11,color:"#B66B77",marginTop:-9,marginBottom:10}}>리뷰는 5자 이상 입력해 주세요. ({reviewText.trim().length}/5자)</Text>}<Pressable disabled={reviewSubmitting||reviewText.trim().length<5} style={[styles.applyButton,{minHeight:50,paddingVertical:15,marginBottom:14,opacity:reviewSubmitting||reviewText.trim().length<5?0.5:1}]} onPress={()=>{void startStudioReviewSubmission();}}><Text style={styles.applyText}>{reviewSubmitting?"등록 중…":"리뷰 등록 / 수정"}</Text></Pressable></View>
<Pressable onPress={()=>setVerifiedReviewsOnly(v=>!v)} style={{marginHorizontal:14,marginTop:8,marginBottom:12,minHeight:46,paddingVertical:12,borderRadius:10,backgroundColor:verifiedReviewsOnly?COLORS.pale:"#F8F7FA",alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"800",color:COLORS.purple}}>{verifiedReviewsOnly?"전체 리뷰 보기":"인증 후기만 보기"}</Text></Pressable>{reviewsLoading?<ActivityIndicator color={COLORS.purple} style={{margin:20}}/>:((verifiedReviewsOnly?studioReviews.filter((item:any)=>!!item.verified_at):studioReviews).length?(verifiedReviewsOnly?studioReviews.filter((item:any)=>!!item.verified_at):studioReviews).map((item:any)=><View key={String(item.id)} style={[styles.classBlock,{marginHorizontal:12}]}><Text style={styles.classTitle}>{"★".repeat(Number(item.rating))}{"☆".repeat(5-Number(item.rating))}</Text><Text style={styles.photoCredit}>{item.user_id===reviewUserId?"내 리뷰":"방문자 리뷰"} · {item.verified_at?"수강 인증":"일반 리뷰"} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</Text><Text style={styles.sessionText}>{item.content}</Text>{item.user_id!==reviewUserId&&<Pressable onPress={()=>Alert.alert("리뷰 신고","신고 사유를 선택해 주세요.",[{text:"광고/홍보",onPress:()=>submitReviewReport(item.id,"광고/홍보")},{text:"욕설/비방",onPress:()=>submitReviewReport(item.id,"욕설/비방")},{text:"허위 정보",onPress:()=>submitReviewReport(item.id,"허위 정보")},{text:"도배/스팸",onPress:()=>submitReviewReport(item.id,"도배/스팸")},{text:"기타",onPress:()=>submitReviewReport(item.id,"기타")},{text:"취소",style:"cancel"}])} style={{alignSelf:"flex-end",paddingVertical:8}}><Text style={{fontSize:11,color:COLORS.muted}}>신고</Text></Pressable>}</View>):<Text style={styles.filterHint}>아직 등록된 리뷰가 없습니다.</Text>)}</BottomSheetScrollView>}
</>}</View></GestureDetector>
{detailShowTop&&<Pressable onPress={()=>detailScrollRef.current?.scrollTo({y:0,animated:true})} accessibilityRole="button" accessibilityLabel="학원 상세정보 맨 위로 이동" style={{position:"absolute",right:18,bottom:Math.max(22,insets.bottom+12),width:46,height:46,borderRadius:23,backgroundColor:isDark?"#3A2D50":"#FFFFFF",borderWidth:1,borderColor:isDark?"#66518B":"#DED7EB",alignItems:"center",justifyContent:"center",elevation:5,shadowColor:"#000000",shadowOpacity:0.16,shadowRadius:8,shadowOffset:{width:0,height:3},zIndex:30}}><Ionicons name="arrow-up" size={21} color={isDark?"#E0D5F7":COLORS.purple}/></Pressable>}
</BottomSheet></View></View></GestureHandlerRootView></Modal><Modal visible={reportOpen} transparent animationType="slide" onRequestClose={()=>setReportOpen(false)}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"} keyboardVerticalOffset={0}><View style={[styles.modalShade,{paddingBottom:insets.bottom}]}><View style={[styles.modal,{maxHeight:"88%",paddingBottom:Math.max(30,insets.bottom+18)}]}>
        <View style={styles.modalHead}><Text style={styles.modalTitle}>학원 정보 제보</Text><Pressable onPress={()=>setReportOpen(false)}><Text style={styles.dismissText}>×</Text></Pressable></View>
        <Text style={styles.sectionTitle}>제보 유형</Text><View style={styles.filterChoices}>{["폐업/이전","주소 오류","전화/홈페이지 오류","가격/시간표 오류","기타"].map(v=><Chip key={v} label={v} active={reportCategory===v} onPress={()=>setReportCategory(v)}/>)}</View>
        <Text style={styles.sectionTitle}>상세 내용</Text><TextInput value={reportDescription} onChangeText={setReportDescription} placeholder={"잘못된 정보와 확인한 내용을 적어주세요. (5~1000자)"} multiline maxLength={1000} textAlignVertical="top" style={styles.reportInput}/>
        <Pressable disabled={reportSubmitting||reportDescription.trim().length<5} style={[styles.applyButton,{opacity:reportSubmitting||reportDescription.trim().length<5?0.5:1}]} onPress={async()=>{const client=supabase;const target=detailStudio;if(!client||!target)return;setReportSubmitting(true);try{const {data:{session}}=await client.auth.getSession();if(!session){Alert.alert("로그인 필요","다시 로그인해 주세요.");setReportOpen(false);return;}const {error}=await client.from("studio_user_reports").insert({studio_id:target.id,reporter_id:session.user.id,category:reportCategory,description:reportDescription.trim()});if(error)throw error;setReportOpen(false);Alert.alert("제보 접수 완료","제보 내용을 관리자에게 전달했습니다.");}catch(e:any){Alert.alert("제보 실패",e?.message||"잠시 후 다시 시도해 주세요.");}finally{setReportSubmitting(false);}}}><Text style={styles.applyText}>{reportSubmitting?"접수 중…":"제보 보내기"}</Text></Pressable>
      </View></View></KeyboardAvoidingView>
    </Modal>

    <Modal visible={filterOpen} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={()=>setFilterOpen(false)}>
      <View style={[styles.modalShade,{paddingTop:insets.top,paddingBottom:insets.bottom}]}>
        <View style={[styles.modal,{height:"86%",maxHeight:"88%",minHeight:0,flexShrink:1,paddingBottom:Math.max(24,insets.bottom+24)}]}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>검색 필터</Text>
            <Pressable onPress={()=>setFilterOpen(false)} hitSlop={10} style={{width:40,height:40,alignItems:"center",justifyContent:"center"}}>
              <Text style={styles.dismissText}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={{flex:1,minHeight:0}} contentContainerStyle={{paddingBottom:insets.bottom+32}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator>
            <Text style={styles.sectionTitle}>대상</Text><View style={styles.filterChoices}><Chip label="성인" active={adult} onPress={()=>setAdult(!adult)}/><Chip label="키즈" active={kids} onPress={()=>setKids(!kids)}/></View>
            <Text style={styles.sectionTitle}>수준</Text><View style={styles.filterChoices}>{["입문","초급","중급","고급"].map(v=><Chip key={v} label={v} active={level===v} onPress={()=>setLevel(level===v?null:v)}/>)}</View>
            <Text style={styles.sectionTitle}>수업 유형</Text><View style={styles.filterChoices}>{classTypeOptions.length?classTypeOptions.map(v=><Chip key={v} label={v} active={classTypeFilter===v} onPress={()=>setClassTypeFilter(classTypeFilter===v?null:v)}/>):<Text style={styles.filterHint}>등록된 수업 유형 정보가 없습니다.</Text>}</View>
            {classFilterLoading&&<Text style={styles.filterHint}>선택한 수업 조건을 확인하고 있습니다…</Text>}
            <Text style={styles.sectionTitle}>요일</Text><View style={styles.filterChoices}>{["평일","주말"].map(v=><Chip key={v} label={v} active={dayFilter===v} onPress={()=>setDayFilter(dayFilter===v?null:v)}/>)}</View>
            <Text style={styles.sectionTitle}>시간대</Text><View style={styles.filterChoices}>{["오전","오후","저녁"].map(v=><Chip key={v} label={v} active={timeFilter===v} onPress={()=>setTimeFilter(timeFilter===v?null:v)}/>)}</View>
            <Text style={styles.sectionTitle}>수업 길이</Text><View style={styles.filterChoices}>{[45,50,60,75,90].map(v=><Chip key={v} label={v+"분"} active={durationFilter===v} onPress={()=>setDurationFilter(durationFilter===v?null:v)}/>)}</View>
            <Text style={styles.sectionTitle}>거리 (지도 중심 기준)</Text><View style={styles.filterChoices}>{[1,3,5,10].map(v=><Chip key={v} label={v+"km"} active={maxDistance===v} onPress={()=>setMaxDistance(maxDistance===v?null:v)}/>)}</View>
            <Text style={styles.sectionTitle}>혜택</Text><View style={styles.filterChoices}><Chip label="쿠폰/할인" active={coupon} onPress={()=>setCoupon(!coupon)}/></View>
            <Text style={styles.filterHint}>거리 필터는 현재 지도 중심을 기준으로 계산합니다.</Text>
          </ScrollView>
          <View style={[styles.modalActions,{marginTop:10,paddingBottom:Math.max(4,insets.bottom?0:4)}]}>
            <Pressable style={styles.resetButton} onPress={resetFilters}><Text style={styles.resetText}>초기화</Text></Pressable>
            <Pressable style={styles.applyButton} onPress={()=>setFilterOpen(false)}><Text style={styles.applyText}>결과 {results.length}곳 보기</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    {searchFocused&&<View style={[styles.searchOverlay,{backgroundColor:isDark?"#101014":"#FFFFFF",paddingTop:insets.top}]} >
      <View style={[styles.searchOverlayHeader,{borderBottomColor:isDark?"#393342":COLORS.line}]}>
        <Pressable onPress={closeSearchOverlay} hitSlop={10} style={styles.searchOverlayBack}><Ionicons name="arrow-back" size={24} color={isDark?"#F3EFFA":COLORS.ink}/></Pressable>
        <View style={[styles.searchOverlayInputBox,{backgroundColor:isDark?"#24212C":"#F8F6FB",borderColor:isDark?"#514568":COLORS.line}]}>
          <Ionicons name="search-outline" size={18} color={COLORS.muted}/>
          <TextInput ref={searchInputRef} autoFocus value={search} onChangeText={setSearch} onSubmitEditing={()=>{const q=search.trim();if(q){Keyboard.dismiss();setSearchFocused(false);void submitSearch(q);}}} returnKeyType="search" placeholder="학원명, 지역, 수업명 검색" placeholderTextColor={COLORS.muted} style={[styles.searchInput,{color:isDark?"#F3EFFA":COLORS.ink}]} autoCorrect={false} autoCapitalize="none"/>
          {!!search&&<Pressable onPress={()=>setSearch("")} hitSlop={9}><Ionicons name="close-circle" size={19} color={COLORS.muted}/></Pressable>}
        </View>
      </View>
      {!search.trim()&&<View style={styles.recentSearchHeader}>
        <Text style={[styles.recentSearchTitle,{color:isDark?"#F3EFFA":COLORS.ink}]}>최근 검색어</Text>
        {recentSearches.length>0&&<Pressable onPress={clearAllRecent}><Text style={{fontSize:12,fontWeight:"800",color:isDark?"#C7AEFF":COLORS.purple}}>전체 삭제</Text></Pressable>}
      </View>}
      {!search.trim()&&<FlatList data={recentSearches} keyExtractor={item=>item} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:18,paddingBottom:insets.bottom+20}} ItemSeparatorComponent={()=><View style={{height:1,backgroundColor:isDark?"#393342":COLORS.line}}/>} renderItem={({item})=><View style={styles.recentSearchRow}>
        <Pressable onPress={()=>{setSearch(item);Keyboard.dismiss();setSearchFocused(false);void submitSearch(item);}} style={styles.recentSearchItem}><Ionicons name="time-outline" size={17} color={COLORS.muted}/><Text numberOfLines={1} style={[styles.recentSearchText,{color:isDark?"#F3EFFA":COLORS.ink}]}>{item}</Text></Pressable>
        <Pressable onPress={()=>void deleteRecentSearch(item)} hitSlop={10} style={styles.recentSearchDelete}><Ionicons name="close" size={17} color={COLORS.muted}/></Pressable>
      </View>} ListEmptyComponent={<View style={{alignItems:"center",paddingTop:54}}><Ionicons name="time-outline" size={28} color={COLORS.muted}/><Text style={{fontSize:13,color:COLORS.muted,marginTop:10}}>최근 검색어가 없습니다.</Text></View>}/>}
      {!!search.trim()&&<Pressable style={[styles.searchOverlaySubmit,{backgroundColor:isDark?"#24212C":"#F8F6FB"}]} onPress={()=>{const q=search.trim();Keyboard.dismiss();setSearchFocused(false);void submitSearch(q);}}>
        <Ionicons name="search" size={17} color={isDark?"#F3EFFA":COLORS.ink}/><Text style={{fontSize:13,color:isDark?"#F3EFFA":COLORS.ink}}>"{search.trim()}" 검색하기</Text>
      </Pressable>}
    </View>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const createStyles = (dark:boolean) => StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:COLORS.bg},header:{paddingHorizontal:12,paddingTop:2,paddingBottom:3,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},headerActions:{flexDirection:"row",alignItems:"center",gap:8},menuButton:{height:34,width:34,borderRadius:11,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},menuButtonText:{fontSize:19,color:COLORS.ink,fontWeight:"700"},brand:{fontSize:20,fontWeight:"900",letterSpacing:-0.7,color:COLORS.ink},brandDot:{color:COLORS.purple,fontSize:19},subtitle:{fontSize:11,color:COLORS.muted,marginTop:3},profileButton:{height:34,width:34,borderRadius:11,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},
 searchOverlay:{position:"absolute",top:0,left:0,right:0,bottom:0,zIndex:100,elevation:30},searchOverlayHeader:{height:58,flexDirection:"row",alignItems:"center",paddingHorizontal:12,gap:8,borderBottomWidth:1},searchOverlayBack:{width:34,height:44,alignItems:"center",justifyContent:"center"},searchOverlayInputBox:{height:43,flex:1,flexDirection:"row",alignItems:"center",gap:8,borderWidth:1,borderRadius:12,paddingHorizontal:11},recentSearchHeader:{height:56,flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:20},recentSearchTitle:{fontSize:15,fontWeight:"900"},recentSearchRow:{minHeight:52,flexDirection:"row",alignItems:"center"},recentSearchItem:{flex:1,minHeight:52,flexDirection:"row",alignItems:"center",gap:11},recentSearchText:{fontSize:14,flex:1},recentSearchDelete:{width:38,height:46,alignItems:"center",justifyContent:"center"},searchOverlaySubmit:{minHeight:52,marginHorizontal:16,marginTop:10,paddingHorizontal:14,borderRadius:12,flexDirection:"row",alignItems:"center",gap:10}, searchRow:{paddingHorizontal:10,paddingTop:0,flexDirection:"row",gap:6},searchSubmitButton:{width:48,height:48,borderRadius:12,backgroundColor:COLORS.purple,alignItems:"center",justifyContent:"center"},searchHint:{fontSize:10,color:COLORS.muted,paddingHorizontal:20,paddingTop:4},searchBox:{flex:1,flexDirection:"row",alignItems:"center",backgroundColor:"#fff",borderRadius:12,paddingHorizontal:11,height:48,borderWidth:1,borderColor:COLORS.line,gap:8},searchInput:{flex:1,fontSize:14,color:COLORS.ink,height:48,paddingVertical:0,includeFontPadding:false},clear:{fontSize:21,color:COLORS.muted},filterButton:{width:48,height:48,backgroundColor:"#fff",borderRadius:12,alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:COLORS.line},filterCount:{position:"absolute",top:4,right:4,backgroundColor:COLORS.purple,width:16,height:16,borderRadius:8,alignItems:"center",justifyContent:"center"},filterCountText:{fontSize:10,color:"#fff",fontWeight:"700"},
 quickFilters:{flexDirection:"row",paddingHorizontal:10,paddingVertical:4,gap:8},chip:{height:38,borderRadius:19,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff",paddingHorizontal:14,justifyContent:"center"},chipActive:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},chipText:{fontSize:14,color:"#625E70"},chipTextActive:{color:COLORS.purple,fontWeight:"700"},
 content:{flex:1,marginTop:2},mapWrap:{flex:1,overflow:"hidden",borderTopLeftRadius:22,borderTopRightRadius:22},map:{flex:1},pin:{backgroundColor:"#fff",paddingHorizontal:10,paddingVertical:7,borderRadius:18,borderColor:"#DCD6F8",borderWidth:1.5,elevation:3,shadowColor:"#000",shadowOpacity:0.1,shadowRadius:4},pinSelected:{backgroundColor:COLORS.purple,borderColor:COLORS.purple},pinText:{fontSize:11,fontWeight:"800",color:COLORS.purple},pinTextSelected:{color:"#fff"},areaSearch:{position:"absolute",top:14,alignSelf:"center",backgroundColor:"#fff",paddingHorizontal:16,paddingVertical:11,borderRadius:24,elevation:4,shadowColor:"#000",shadowOpacity:0.12,shadowRadius:5},areaSearchText:{color:COLORS.ink,fontSize:13,fontWeight:"700"},locateButton:{position:"absolute",right:14,bottom:76,width:44,height:44,borderRadius:14,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",elevation:3},mapCount:{position:"absolute",left:12,bottom:12,backgroundColor:"#fff",paddingHorizontal:15,paddingVertical:13,borderRadius:13,elevation:2},mapCountText:{fontSize:12,color:COLORS.ink,fontWeight:"700"},selectedCard:{position:"absolute",bottom:10,left:8,right:8,backgroundColor:dark?"#1D1D22":"#F0F0F3",borderRadius:22,padding:10,minHeight:0,elevation:7,shadowColor:"#000",shadowOpacity:0.18,shadowRadius:10},studioCard:{backgroundColor:dark?"#24242A":"#FFFFFF",borderRadius:14,padding:12,marginBottom:9,borderWidth:1,borderColor:dark?"#38383F":"#E8E6ED",elevation:1,shadowColor:"#000",shadowOpacity:dark?0:0.025,shadowRadius:4,shadowOffset:{width:0,height:1}},compactCard:{marginBottom:0,padding:0,borderWidth:0,elevation:0,shadowOpacity:0},cardTop:{flexDirection:"row",alignItems:"center",gap:10},studioIcon:{width:68,height:68,borderRadius:12,backgroundColor:COLORS.pink,alignItems:"center",justifyContent:"center",overflow:"hidden"},studioThumb:{width:68,height:68},studioName:{fontSize:15,fontWeight:"800",color:dark?"#F2F2F5":COLORS.ink},studioArea:{fontSize:12,color:dark?"#B9B9C2":COLORS.muted,marginTop:3},couponBadge:{backgroundColor:"#FFF1D9",borderRadius:8,paddingHorizontal:7,paddingVertical:4},couponText:{fontSize:10,color:"#B87922",fontWeight:"700"},tagsRow:{flexDirection:"row",gap:5,marginTop:7},tag:{backgroundColor:dark?"#34343B":"#E5E5EA",borderRadius:7,paddingHorizontal:8,paddingVertical:5},tagText:{fontSize:10,color:dark?"#D5D5DC":"#555560"},cardBottom:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:7},priceText:{fontSize:14,fontWeight:"800",color:COLORS.ink},priceUnit:{fontSize:11,fontWeight:"400",color:COLORS.muted},metaText:{fontSize:12,color:dark?"#B9B9C2":COLORS.muted,fontWeight:"600"},cardActions:{flexDirection:"row",gap:7,marginTop:9},actionChip:{backgroundColor:"#F7F5FA",borderRadius:10,minHeight:40,paddingHorizontal:14,paddingVertical:9},actionText:{fontSize:10,color:COLORS.purple,fontWeight:"700"},compareFloating:{position:"absolute",bottom:72,alignSelf:"center",backgroundColor:COLORS.purple,paddingHorizontal:18,paddingVertical:12,borderRadius:24,zIndex:20,elevation:10},compareFloatingText:{fontSize:12,fontWeight:"800",color:"#fff"},dragHeader:{paddingBottom:6},dragGestureZone:{height:48,alignItems:"center",justifyContent:"center"},dragHandle:{width:48,height:6,borderRadius:3,backgroundColor:"#D8D4E1",alignSelf:"center"},dragHint:{fontSize:10,color:COLORS.muted,marginTop:5,textAlign:"center"},expandText:{fontSize:12,color:COLORS.purple,fontWeight:"800"},studioPhoto:{width:250,height:158,borderRadius:13,backgroundColor:"#F3F0F5"},photoEmpty:{backgroundColor:"#F8F6FB",padding:14,borderRadius:12},photoSourceLink:{fontSize:12,color:COLORS.purple,fontWeight:"800"},photoCredit:{fontSize:10,color:COLORS.muted,marginTop:5},classBlock:{backgroundColor:"#F8F6FB",borderRadius:12,padding:12,marginBottom:8},classTitle:{fontSize:13,fontWeight:"800",color:COLORS.ink},classMeta:{fontSize:11,color:COLORS.muted,marginTop:4},sessionText:{fontSize:11,color:"#625E70",marginTop:5},compareRow:{borderBottomWidth:1,borderBottomColor:COLORS.line,paddingVertical:13},compareColumn:{width:230,backgroundColor:COLORS.white,borderWidth:1,borderColor:COLORS.line,borderRadius:13,padding:10},compareColumnHead:{minHeight:86,borderBottomWidth:1,borderBottomColor:COLORS.line,paddingBottom:8},compareName:{fontSize:14,fontWeight:"800",color:COLORS.ink},compareInfo:{fontSize:11,color:COLORS.muted,marginTop:4},compareSectionTitle:{fontSize:12,fontWeight:"900",color:COLORS.purple,marginTop:13,marginBottom:7},compareMaterial:{marginBottom:8,backgroundColor:"#F8F6FB",borderRadius:9,padding:6},compareMaterialImage:{width:"100%",height:180,backgroundColor:"#fff",borderRadius:6},compareEmpty:{fontSize:11,color:COLORS.muted,backgroundColor:"#F8F6FB",padding:12,borderRadius:8},compareClass:{padding:8,backgroundColor:"#F8F6FB",borderRadius:8,marginBottom:6},compareClassTitle:{fontSize:12,fontWeight:"800",color:COLORS.ink},comparePrice:{fontSize:14,fontWeight:"900",color:COLORS.purple,marginTop:6},removeCompare:{fontSize:11,color:"#B66B77",marginTop:6},detailDescription:{fontSize:13,color:"#625E70",lineHeight:20},infoRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingVertical:9,borderBottomWidth:1,borderBottomColor:COLORS.line},infoLabel:{fontSize:12,color:COLORS.muted},infoValue:{fontSize:12,color:COLORS.ink,fontWeight:"700"},detailDisclaimer:{fontSize:10,color:"#A29EAC",marginTop:14},reportInput:{minHeight:110,borderWidth:1,borderColor:COLORS.line,borderRadius:13,padding:12,fontSize:13,color:COLORS.ink,marginBottom:15},detailBtn:{backgroundColor:dark?"#352A48":COLORS.pale,alignItems:"center",padding:10,borderRadius:12,marginTop:7},detailBtnText:{fontSize:12,fontWeight:"700",color:dark?"#E0D4FF":COLORS.purple},dismiss:{position:"absolute",top:-9,right:8,width:36,height:36,zIndex:10,elevation:10,borderRadius:18,backgroundColor:"#F0ECF7",alignItems:"center",justifyContent:"center"},dismissText:{fontSize:20,color:COLORS.muted},listSortRow:{flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:12,paddingVertical:8,backgroundColor:COLORS.bg},listSortLabel:{flex:1,fontSize:12,color:COLORS.muted,fontWeight:"700"},listSortChip:{paddingHorizontal:10,paddingVertical:6,borderRadius:14,borderWidth:1,borderColor:COLORS.line,backgroundColor:"#fff"},listSortChipActive:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},listSortChipText:{fontSize:11,color:COLORS.muted,fontWeight:"700"},listSortChipTextActive:{color:COLORS.purple},listContent:{padding:12,paddingBottom:20},empty:{textAlign:"center",padding:30,color:COLORS.muted},
 bottomNav:{height:61,backgroundColor:"#fff",borderTopWidth:1,borderTopColor:COLORS.line,flexDirection:"row",justifyContent:"space-around",alignItems:"center",paddingBottom:3},navItem:{alignItems:"center",justifyContent:"center",gap:2,flex:1},navIcon:{fontSize:20,color:"#9D98AA"},navLabel:{fontSize:10,color:"#9D98AA"},navActive:{color:COLORS.purple,fontWeight:"800"},
 drawerShade:{flex:1,flexDirection:"row",backgroundColor:"rgba(20,16,32,0.55)"},drawerPanel:{width:"84%",maxWidth:340,height:"100%",backgroundColor:"#fff",paddingTop:24,paddingHorizontal:16,paddingBottom:16,elevation:12},drawerHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingBottom:24,borderBottomWidth:1,borderBottomColor:COLORS.line},drawerBrand:{fontSize:22,fontWeight:"900",color:COLORS.ink},drawerSubtitle:{fontSize:11,color:COLORS.muted,marginTop:4},drawerClose:{width:34,height:34,borderRadius:12,backgroundColor:COLORS.bg,alignItems:"center",justifyContent:"center"},drawerCloseText:{fontSize:24,color:COLORS.muted,marginTop:-3},drawerSection:{fontSize:11,color:COLORS.muted,fontWeight:"800",marginTop:24,marginBottom:8,letterSpacing:0.5},drawerItem:{minHeight:52,flexDirection:"row",alignItems:"center",gap:13,borderRadius:13,paddingHorizontal:12},drawerIcon:{width:24,alignItems:"center",justifyContent:"center"},drawerItemText:{flex:1,fontSize:14,fontWeight:"700",color:COLORS.ink},drawerCurrent:{fontSize:10,color:COLORS.purple,fontWeight:"800"},drawerCount:{fontSize:11,color:COLORS.muted,fontWeight:"700"},drawerDivider:{height:1,backgroundColor:COLORS.line,marginTop:14},drawerFooter:{marginTop:"auto",paddingTop:18,borderTopWidth:1,borderTopColor:COLORS.line},drawerFooterText:{fontSize:10,color:COLORS.muted},modalShade:{flex:1,backgroundColor:"rgba(20,16,32,0.55)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:24,borderTopRightRadius:24,padding:22,paddingBottom:30},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},mapProviderOption:{flexDirection:"row",alignItems:"center",gap:12,padding:14,borderWidth:1,borderColor:COLORS.line,borderRadius:14,marginTop:10},mapProviderSelected:{borderColor:COLORS.purple,backgroundColor:COLORS.pale},mapProviderTitle:{fontSize:14,fontWeight:"800",color:COLORS.ink},mapProviderSub:{fontSize:10,color:COLORS.muted,marginTop:3},mapProviderCheck:{fontSize:11,fontWeight:"800",color:COLORS.purple},modalTitle:{fontSize:20,fontWeight:"900",color:COLORS.ink},searchResultSub:{fontSize:11,color:COLORS.muted,marginTop:4},searchResultRow:{flexDirection:"row",alignItems:"center",gap:11,paddingHorizontal:12,paddingVertical:14,marginBottom:8,borderWidth:1,borderColor:COLORS.line,borderRadius:13,backgroundColor:COLORS.white},searchResultNumber:{width:28,height:28,borderRadius:9,backgroundColor:COLORS.pale,alignItems:"center",justifyContent:"center"},searchResultNumberText:{fontSize:12,fontWeight:"900",color:COLORS.purple},searchResultName:{fontSize:14,fontWeight:"800",color:COLORS.ink},searchResultAddress:{fontSize:11,color:COLORS.muted,marginTop:4,lineHeight:16},sectionTitle:{fontSize:14,fontWeight:"800",color:COLORS.ink,marginTop:23,marginBottom:10},filterChoices:{flexDirection:"row",flexWrap:"wrap",gap:8},filterHint:{fontSize:11,color:COLORS.muted,marginTop:20,lineHeight:17},modalActions:{flexDirection:"row",gap:10,marginTop:25},resetButton:{flex:1,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,borderWidth:1,borderColor:COLORS.line},resetText:{fontWeight:"700",color:COLORS.ink},applyButton:{flex:2,alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,backgroundColor:COLORS.purple},applyText:{fontWeight:"800",color:"#fff"}
},dark));